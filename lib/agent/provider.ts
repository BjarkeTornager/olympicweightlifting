import { z } from "zod";
import {
  readModelStream,
  ContentFiltered,
  usageSchema,
  type StreamUsage,
} from "./model-stream";
import { MAX_PROVIDER_TOOL_CALLS } from "./limits";
import { recordModelCall } from "../ai-usage";
import type { SpanAttributes } from "../tracing/attributes";
import type { TraceSpan } from "../tracing/spans";
export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id?: string;
    function: { name: string; arguments: Record<string, unknown> };
  }[];
  // Ends the prefix that stays the same from turn to turn, so the provider
  // caches it there and not only at the end of each whole request.
  cacheBreakpoint?: boolean;
};
export function providerConfig() {
  const provider =
    process.env.AGENT_PROVIDER ?? (process.env.OLLAMA_BASE_URL ? "ollama" : "");
  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY || !process.env.AGENT_MODEL)
      return null;
    return {
      kind: "openrouter" as const,
      label: "OpenRouter",
      base: "https://openrouter.ai/api/v1",
      model: process.env.AGENT_MODEL,
      key: process.env.OPENROUTER_API_KEY,
    };
  }
  if (provider !== "ollama") return null;
  const base = process.env.OLLAMA_BASE_URL?.replace(/\/$/, ""),
    model = process.env.OLLAMA_MODEL;
  if (!base || !model) return null;
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Invalid agent provider configuration.");
  const cloud = url.hostname === "ollama.com";
  if (cloud && (url.protocol !== "https:" || !process.env.OLLAMA_API_KEY))
    return null;
  return {
    kind: "ollama" as const,
    label: cloud ? "Ollama Cloud" : "Private Ollama",
    base,
    model,
    key: process.env.OLLAMA_API_KEY,
  };
}
export type ModelResponse = ModelMessage & {
  truncated?: boolean;
  // The host's content filter replaced the reply with a refusal.
  filtered?: boolean;
  // Which model answered and what the call used, for Coach's turn metrics.
  served?: ModelUsage;
  // The call the content filter blocked before this reply was retried.
  blocked?: ModelUsage & { ms: number };
};
export type ModelUsage = {
  model?: string;
  inputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};
function servedBy(
  model: string | undefined,
  usage: z.infer<typeof usageSchema> | undefined,
): ModelUsage | undefined {
  if (!model && !usage) return undefined;
  return {
    ...(model ? { model } : {}),
    ...(usage
      ? {
          inputTokens: usage.prompt_tokens,
          cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens:
            usage.prompt_tokens_details?.cache_write_tokens ?? 0,
          outputTokens: usage.completion_tokens,
          ...(usage.cost != null ? { costUsd: usage.cost } : {}),
        }
      : {}),
  };
}
// Azure's content filter, which fronts every zero-retention OpenAI model,
// blocks ordinary fitness questions ("how many sets when I'm tired?"). A
// filtered reply is retried once on a model served outside Azure, with the
// same zero-retention, no-collection routing.
export const FILTER_FALLBACK_MODEL = "google/gemini-3.8-flash";
export type ModelOptions = {
  purpose?: "video_review";
  // Room for a long reply, such as a save of many entries, after one was
  // cut off at the ordinary limit.
  longReply?: boolean;
  model?: string;
  // Each call to the provider becomes a chat span under this one.
  span?: TraceSpan;
};

function openAiChatModel(model: string) {
  return /^openai\/gpt-(5\.6|6)-/.test(model);
}
const messageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().max(24000).default(""),
  tool_calls: z
    .array(
      z.object({
        id: z.string().max(200).optional(),
        function: z.object({
          name: z.string().max(100),
          arguments: z.record(z.string(), z.unknown()),
        }),
      }),
    )
    .max(MAX_PROVIDER_TOOL_CALLS)
    .optional(),
});
export function modelRequest(
  messages: ModelMessage[],
  tools: ToolDefinition[],
  config: NonNullable<ReturnType<typeof providerConfig>>,
  options: ModelOptions = {},
) {
  // Room for an ordinary reply, which also holds a save of a dozen or so
  // entries or a visual, and is only a cap: Coach's replies stay short.
  // Phase evidence plus replay cards need more room, and so does a save
  // that was cut off once (callModel).
  const outputLimit = options.longReply
    ? 8000
    : options.purpose === "video_review"
      ? 4800
      : 4000;
  const model = options.model ?? config.model;
  if (config.kind === "openrouter")
    return {
      url: `${config.base}/chat/completions`,
      body: {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.images?.length
            ? [
                { type: "text", text: m.content },
                ...m.images.map((data) => ({
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${data}` },
                })),
              ]
            : m.cacheBreakpoint && openAiChatModel(model)
              ? [
                  {
                    type: "text",
                    text: m.content,
                    prompt_cache_breakpoint: { mode: "explicit" },
                  },
                ]
              : m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls
            ? {
                tool_calls: m.tool_calls.map((t) => ({
                  id: t.id,
                  type: "function",
                  function: {
                    name: t.function.name,
                    arguments: JSON.stringify(t.function.arguments),
                  },
                })),
              }
            : {}),
        })),
        // Optional tool fields are validated by Zod. Keep them non-strict on
        // OpenAI Chat Completions models, including routed Luna/Terra/Astra.
        tools: openAiChatModel(model)
          ? tools.map((tool) => ({
              ...tool,
              function: { ...tool.function, strict: false },
            }))
          : tools,
        stream: false,
        // Azure OpenAI advertises max_completion_tokens. Sending max_tokens
        // excludes those endpoints when require_parameters and ZDR are on.
        ...(openAiChatModel(model)
          ? { max_completion_tokens: outputLimit }
          : { max_tokens: outputLimit }),
        provider: {
          require_parameters: true,
          data_collection: "deny",
          zdr: true,
          // Prefer the EU endpoint tested for Luna; other routed models keep ZDR.
          ...(model === "openai/gpt-5.6-luna" ? { order: ["azure/eu"] } : {}),
        },
      },
    };
  return {
    url: `${config.base}/chat`,
    body: {
      model: config.model,
      messages,
      tools,
      stream: false,
      think: false,
      options: {
        temperature: 0.2,
        num_predict: outputLimit,
      },
    },
  };
}
// A tool call whose arguments are not whole JSON: a reply cut off at the
// output limit, which providers do not always report as such. callModel
// asks once more with more room; if that is cut off too, this message is
// shown as it is.
export class ReplyCutShort extends ProviderError {
  constructor() {
    super(
      "Coach's reply was too long to finish, so nothing was saved. Send it again in two parts.",
      502,
    );
  }
}
export function parseModelResponse(
  raw: unknown,
  kind: "ollama" | "openrouter",
): ModelResponse {
  if (kind === "ollama") {
    const response = z
      .object({ message: messageSchema, done_reason: z.string().optional() })
      .parse(raw);
    return {
      ...response.message,
      ...(response.done_reason === "length" ? { truncated: true } : {}),
    };
  }
  const response = z
    .object({
      // Metrics only: a malformed usage frame never fails the reply.
      model: z.string().max(200).optional().catch(undefined),
      usage: usageSchema.optional().catch(undefined),
      choices: z
        .array(
          z.object({
            finish_reason: z.string().nullish(),
            message: z.object({
              role: z.literal("assistant"),
              content: z.string().max(24000).nullish(),
              tool_calls: z
                .array(
                  z.object({
                    id: z.string().min(1).max(200),
                    function: z.object({
                      name: z.string().max(100),
                      arguments: z.string().max(40000),
                    }),
                  }),
                )
                .max(MAX_PROVIDER_TOOL_CALLS)
                .optional(),
            }),
          }),
        )
        .min(1)
        .max(1),
    })
    .parse(raw);
  const m = response.choices[0].message;
  const parsed = (args: string) => {
    try {
      return JSON.parse(args);
    } catch {
      throw new ReplyCutShort();
    }
  };
  return {
    ...messageSchema.parse({
      ...m,
      content: m.content ?? "",
      tool_calls: m.tool_calls?.map((t) => ({
        ...t,
        function: {
          name: t.function.name,
          arguments: parsed(t.function.arguments),
        },
      })),
    }),
    ...(response.choices[0].finish_reason === "length"
      ? { truncated: true }
      : {}),
    ...(response.choices[0].finish_reason === "content_filter"
      ? { filtered: true }
      : {}),
    ...(servedBy(response.model, response.usage)
      ? { served: servedBy(response.model, response.usage) }
      : {}),
  };
}
// What a reply that can't be used still says it served and cost.
const billedSchema = z.object({
  model: z.string().max(200).optional().catch(undefined),
  usage: usageSchema.optional().catch(undefined),
});
// Reads a provider's reply and records the call in the AI cost ledger
// (lib/ai-usage.ts), against the account and feature of the current usage
// context. Every reply read is a call billed, so a retry is recorded too,
// and so is a reply that can't be used.
export async function readModelResponse(
  raw: unknown,
  kind: "ollama" | "openrouter",
  model: string,
): Promise<ModelResponse> {
  let response: ModelResponse;
  try {
    response = parseModelResponse(raw, kind);
  } catch (error) {
    const billed = billedSchema.safeParse(raw);
    await recordModelCall(
      billed.success
        ? servedBy(billed.data.model, billed.data.usage)
        : undefined,
      model,
    );
    throw error;
  }
  await recordModelCall(response.served, model);
  return response;
}
export async function providerResponseError(
  response: Response,
  hasImages = false,
) {
  let monthlyLimit = false;
  if (response.status === 403) {
    // OpenRouter uses 403 for exhausted key budgets as well as permissions.
    // Inspect only a small error envelope; never expose or log provider text.
    const reader = response.body?.getReader();
    if (reader) {
      const timer = setTimeout(() => {
        void reader.cancel().catch(() => {});
      }, 1500);
      timer.unref?.();
      try {
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 8192) break;
          chunks.push(chunk.value);
        }
        if (bytes <= 8192) {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          monthlyLimit =
            typeof data?.error?.message === "string" &&
            /key limit exceeded|monthly limit|spending (?:cap|limit)/i.test(
              data.error.message,
            );
        }
      } catch {
        /* A malformed envelope remains a non-retryable permission error. */
      } finally {
        clearTimeout(timer);
        await reader.cancel().catch(() => {});
      }
    }
  }
  return new ProviderError(
    monthlyLimit
      ? "Coach’s monthly AI allowance has been reached. The app owner can increase the limit, or you can wait for the monthly reset. Your saved data is safe."
      : response.status === 429
        ? "The assistant has reached its provider limit. Try again shortly."
        : response.status === 402
          ? "The assistant’s provider credit or spending cap has been reached. Add OpenRouter credit or wait for the monthly cap to reset; manual logging is still available."
          : response.status === 403
            ? "The assistant provider denied this request. The app owner needs to check the provider key’s permissions. Your saved data is safe."
            : response.status === 400 && hasImages
              ? "The provider could not process this image request. Try a text description or ask the host to check that the configured model supports images and tools. Your uploads are saved in Images."
              : "The assistant provider is unavailable. Try again shortly.",
    monthlyLimit || response.status === 402
      ? 402
      : response.status === 403
        ? 403
        : response.status === 429
          ? 429
          : 503,
  );
}

export async function callModel(
  messages: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  onText?: (delta: string) => void,
  options: ModelOptions = {},
): Promise<ModelResponse> {
  const config = providerConfig();
  const canRetry =
    config?.kind === "openrouter" &&
    (options.model ?? config.model) !== FILTER_FALLBACK_MODEL;
  const started = Date.now();
  let blocked: ModelUsage | undefined;
  // A reply cut off in a tool call, such as a save of many entries, is
  // asked for once more with room for a long reply. Text already shown is
  // not streamed again.
  const attempt = async (
    attemptOptions: ModelOptions,
    fallback?: boolean,
  ): Promise<ModelResponse> => {
    let streamed = false;
    try {
      return await attemptOnce(
        messages,
        tools,
        signal,
        onText &&
          ((delta) => {
            streamed = true;
            onText(delta);
          }),
        attemptOptions,
        fallback,
      );
    } catch (e) {
      if (!(e instanceof ReplyCutShort) || attemptOptions.longReply) throw e;
      console.warn(
        JSON.stringify({
          event: "coach_reply_cut_short",
          model: attemptOptions.model ?? config?.model ?? null,
        }),
      );
      return attemptOnce(
        messages,
        tools,
        signal,
        streamed ? undefined : onText,
        { ...attemptOptions, longReply: true },
        fallback,
      );
    }
  };
  try {
    const response = await attempt(options);
    if (!response.filtered || !canRetry) return response;
    blocked = response.served;
  } catch (e) {
    if (!(e instanceof ContentFiltered) || !canRetry) throw e;
  }
  console.warn(
    JSON.stringify({
      event: "coach_content_filter_fallback",
      from: options.model ?? config?.model ?? null,
      to: FILTER_FALLBACK_MODEL,
    }),
  );
  const ms = Date.now() - started;
  const response = await attempt(
    { ...options, model: FILTER_FALLBACK_MODEL },
    true,
  );
  return {
    ...response,
    blocked: { model: options.model ?? config?.model, ...blocked, ms },
  };
}

// Usage as trace attributes: counts, cost and the model that answered.
export function usageAttributes(served?: ModelUsage): SpanAttributes {
  return {
    "gen_ai.response.model": served?.model,
    "gen_ai.usage.input_tokens": served?.inputTokens,
    "gen_ai.usage.output_tokens": served?.outputTokens,
    "gen_ai.usage.cache_read.input_tokens": served?.cachedTokens,
    "lift.cache_write_tokens": served?.cacheWriteTokens,
    "lift.cost_usd": served?.costUsd,
  };
}

// One call to the provider, traced as one chat span when the caller passed
// a span: model, tokens, cost and timings, never the messages.
async function attemptOnce(
  messages: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  onText: ((delta: string) => void) | undefined,
  options: ModelOptions,
  fallback = false,
) {
  if (!options.span?.recording)
    return requestModel(messages, tools, signal, onText, options);
  const config = providerConfig();
  const started = Date.now();
  let firstToken: number | undefined;
  const span = options.span.child("chat", "chat", {
    "gen_ai.provider.name": config?.kind,
    "gen_ai.request.model":
      config?.kind === "ollama"
        ? config.model
        : (options.model ?? config?.model),
    "lift.streaming": Boolean(onText),
    "lift.image_count": messages.reduce(
      (n, m) => n + (m.images?.length ?? 0),
      0,
    ),
    ...(fallback ? { "lift.fallback": true } : {}),
  });
  try {
    const response = await requestModel(
      messages,
      tools,
      signal,
      onText &&
        ((delta) => {
          firstToken ??= Date.now() - started;
          onText(delta);
        }),
      options,
    );
    span.set({
      ...usageAttributes(response.served),
      "lift.filtered": response.filtered === true,
      "lift.truncated": response.truncated === true,
      "lift.tool_calls_returned": response.tool_calls?.length ?? 0,
      "lift.first_token_ms": firstToken,
    });
    span.content(messages, response);
    return response;
  } catch (e) {
    if (e instanceof ContentFiltered) span.set({ "lift.filtered": true });
    else span.fail(e);
    throw e;
  } finally {
    span.end({ "lift.ms": Date.now() - started });
  }
}

async function requestModel(
  messages: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  onText?: (delta: string) => void,
  options: ModelOptions = {},
): Promise<ModelResponse> {
  const config = providerConfig();
  if (!config)
    throw Error(
      "The training assistant is not connected yet. Your journal and manual logging are ready to use.",
    );
  const request = modelRequest(messages, tools, config, options);
  if (onText) request.body.stream = true;
  const response = await fetch(request.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
    },
    body: JSON.stringify(request.body),
    signal,
    redirect: "error",
  });
  if (!response.ok)
    throw await providerResponseError(
      response,
      messages.some((m) => m.images?.length),
    );
  // From here the call is billed however it ends. A reply blocked by the
  // host's filter, a Stop, the turn's timeout or a reply cut short is
  // recorded too, with the usage seen so far (lib/ai-usage.ts).
  const seen: StreamUsage = {};
  let raw: unknown;
  try {
    raw = onText
      ? await readModelStream(response, config.kind, onText, signal, seen)
      : await readReply(response);
  } catch (error) {
    await recordModelCall(servedBy(seen.model, seen.usage), request.body.model);
    throw error;
  }
  return readModelResponse(raw, config.kind, request.body.model);
}

async function readReply(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("The assistant returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256000) {
      await reader.cancel();
      throw Error("The assistant response was too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
