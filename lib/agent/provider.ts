import { z } from "zod";
import { readModelStream } from "./model-stream";
import { MAX_PROVIDER_TOOL_CALLS } from "./limits";
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
export type ModelResponse = ModelMessage & { truncated?: boolean };
export type ModelOptions = { purpose?: "video_review"; model?: string };

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
  // Phase evidence plus replay cards need more room than a chat reply. Keep
  // the ordinary chat budget unchanged and bound the video-specific allowance.
  const outputLimit =
    options.purpose === "video_review"
      ? 4800
      : tools.some((t) => t.function.name === "show_visual")
        ? 3200
        : 1800;
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
  return {
    ...messageSchema.parse({
      ...m,
      content: m.content ?? "",
      tool_calls: m.tool_calls?.map((t) => ({
        ...t,
        function: {
          name: t.function.name,
          arguments: JSON.parse(t.function.arguments),
        },
      })),
    }),
    ...(response.choices[0].finish_reason === "length"
      ? { truncated: true }
      : {}),
  };
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
  if (onText)
    return parseModelResponse(
      await readModelStream(response, config.kind, onText, signal),
      config.kind,
    );
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
  return parseModelResponse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
    config.kind,
  );
}
