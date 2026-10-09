import { createParser } from "eventsource-parser";
import { z } from "zod";
import { MAX_PROVIDER_TOOL_CALLS } from "./limits";

// The host's content filter blocked the reply; another model may answer.
export class ContentFiltered extends Error {
  constructor() {
    super("The assistant's host blocked this reply.");
  }
}

// OpenRouter reports usage on every response (the last frame of a stream).
// Counts and cost only: nothing here repeats the conversation.
export const usageSchema = z.object({
  prompt_tokens: z.number().nonnegative().optional(),
  completion_tokens: z.number().nonnegative().optional(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().nonnegative().nullish(),
      cache_write_tokens: z.number().nonnegative().nullish(),
    })
    .nullish(),
  cost: z.number().nonnegative().nullish(),
});
const routerChunk = z.object({
  error: z.unknown().optional(),
  // Metrics only: a malformed usage frame never fails the reply.
  model: z.string().max(200).optional().catch(undefined),
  usage: usageSchema.optional().catch(undefined),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        delta: z
          .object({
            content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  index: z
                    .number()
                    .int()
                    .min(0)
                    .max(MAX_PROVIDER_TOOL_CALLS - 1),
                  id: z.string().max(200).optional(),
                  function: z
                    .object({
                      name: z.string().max(100).optional(),
                      arguments: z.string().max(40000).optional(),
                    })
                    .optional(),
                }),
              )
              .max(MAX_PROVIDER_TOOL_CALLS)
              .optional(),
          })
          .optional(),
      }),
    )
    .max(1)
    .optional(),
});
const ollamaChunk = z.object({
  error: z.unknown().optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  message: z
    .object({
      content: z.string().optional(),
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
    })
    .optional(),
});

// Which model answered and what it used, as far as the stream got. Filled in
// as frames arrive, so a call that fails part way is still recorded in the
// AI cost ledger with whatever usage it reported.
export type StreamUsage = {
  model?: string;
  usage?: z.infer<typeof usageSchema>;
};

// How long the rest of a blocked reply is read for its usage frame.
const BLOCKED_USAGE_WAIT_MS = 2000;

// A read that gives up at a deadline, as if the stream had ended. The read
// left waiting settles when the reader is cancelled.
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  until: number,
) {
  const read = reader.read();
  read.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<{ done: true; value: undefined }>((resolve) => {
        timer = setTimeout(
          () => resolve({ done: true, value: undefined }),
          Math.max(0, until - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Provider framing only. Reasoning, raw errors and credentials never leave
// this adapter; usage leaves only as token counts and cost. Validate assembled messages again before tools execute.
export async function readModelStream(
  response: Response,
  kind: "openrouter" | "ollama",
  onText: (delta: string) => void,
  signal: AbortSignal,
  seen: StreamUsage = {},
  // Told each tool the model starts calling, as its arguments begin.
  onTool?: (name: string) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("The assistant returned an empty response.");
  const decoder = new TextDecoder();
  let size = 0,
    content = "",
    pending = "",
    finished = false,
    terminal = false,
    blocked = false,
    cut = false;
  const calls = new Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  >();
  const announced = new Set<number>();
  const ollamaCalls: NonNullable<
    NonNullable<z.infer<typeof ollamaChunk>["message"]>["tool_calls"]
  > = [];
  const text = (delta?: string | null) => {
    if (!delta) return;
    content += delta;
    if (content.length > 24000)
      throw Error("The assistant response was too large.");
    onText(delta);
  };
  const receive = (data: string) => {
    if (kind === "openrouter" && data === "[DONE]") {
      terminal = true;
      return;
    }
    if (terminal) throw Error("Unexpected data after the response ended.");
    const raw: unknown = JSON.parse(data);
    if (kind === "openrouter") {
      const chunk = routerChunk.parse(raw);
      if (chunk.error) throw Error("The assistant stream was interrupted.");
      seen.model = chunk.model ?? seen.model;
      seen.usage = chunk.usage ?? seen.usage;
      const choice = chunk.choices?.[0];
      // A usage-only frame, or the rest of a blocked reply.
      if (!choice || blocked) return;
      if (choice.finish_reason === "content_filter") {
        blocked = true;
        return;
      }
      // A tool call cut off at the output limit is read as it is, so the
      // caller can ask again with more room.
      if (choice.finish_reason === "length" && calls.size) cut = true;
      else if (
        choice.finish_reason &&
        !["stop", "tool_calls"].includes(choice.finish_reason)
      )
        throw Error("The assistant could not complete its response.");
      if (choice.finish_reason) finished = true;
      text(choice.delta?.content);
      for (const t of choice.delta?.tool_calls ?? []) {
        const call = calls.get(t.index) ?? {
          id: "",
          function: { name: "", arguments: "" },
        };
        if (t.id) call.id = t.id;
        if (t.function?.name) call.function.name += t.function.name;
        if (t.function?.arguments)
          call.function.arguments += t.function.arguments;
        if (
          call.function.arguments.length > 40000 ||
          call.function.name.length > 100
        )
          throw Error("The assistant tool response was too large.");
        calls.set(t.index, call);
        // The name is whole once the arguments start.
        if (
          onTool &&
          call.function.name &&
          t.function?.arguments &&
          !announced.has(t.index)
        ) {
          announced.add(t.index);
          onTool(call.function.name);
        }
      }
    } else {
      const chunk = ollamaChunk.parse(raw);
      if (chunk.error) throw Error("The assistant stream was interrupted.");
      if (
        chunk.done_reason &&
        !["stop", "tool_calls"].includes(chunk.done_reason)
      )
        throw Error("The assistant could not complete its response.");
      text(chunk.message?.content);
      ollamaCalls.push(...(chunk.message?.tool_calls ?? []));
      if (ollamaCalls.length > MAX_PROVIDER_TOOL_CALLS)
        throw Error("Too many assistant tool calls.");
      if (chunk.done) {
        terminal = true;
        finished = true;
      }
    }
  };
  const parser = createParser({ onEvent: (event) => receive(event.data) });
  try {
    while (!blocked) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024)
        throw Error("The assistant response was too large.");
      const chunk = decoder.decode(value, { stream: true });
      if (kind === "openrouter") parser.feed(chunk);
      else {
        pending += chunk;
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, end).trim();
          pending = pending.slice(end + 1);
          if (line) receive(line);
        }
      }
    }
    if (blocked) {
      // The blocked reply was still billed, and its usage comes in a frame
      // of its own just after; nothing else in the rest is used.
      const until = Date.now() + BLOCKED_USAGE_WAIT_MS;
      try {
        while (!seen.usage && !terminal && Date.now() < until) {
          const { done, value } = await readUntil(reader, until);
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch {
        // The block stands, whatever the rest holds.
      }
      throw new ContentFiltered();
    }
    const tail = decoder.decode();
    if (kind === "openrouter") parser.feed(tail);
    else if ((pending + tail).trim()) receive((pending + tail).trim());
    signal.throwIfAborted();
    if (!finished || !terminal)
      throw Error("The assistant response ended early. Please try again.");
    return kind === "openrouter"
      ? {
          model: seen.model,
          usage: seen.usage,
          choices: [
            {
              ...(cut ? { finish_reason: "length" } : {}),
              message: {
                role: "assistant",
                content,
                ...(calls.size
                  ? {
                      tool_calls: [...calls.entries()]
                        .sort(([a], [b]) => a - b)
                        .map(([, call]) => call),
                    }
                  : {}),
              },
            },
          ],
        }
      : {
          message: {
            role: "assistant",
            content,
            ...(ollamaCalls.length ? { tool_calls: ollamaCalls } : {}),
          },
        };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
