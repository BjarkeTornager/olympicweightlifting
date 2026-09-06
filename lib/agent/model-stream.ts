import { createParser } from "eventsource-parser";
import { z } from "zod";

const routerChunk = z.object({
  error: z.unknown().optional(),
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
                  index: z.number().int().min(0).max(7),
                  id: z.string().max(200).optional(),
                  function: z
                    .object({
                      name: z.string().max(100).optional(),
                      arguments: z.string().max(40000).optional(),
                    })
                    .optional(),
                }),
              )
              .max(8)
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
        .max(8)
        .optional(),
    })
    .optional(),
});

// Provider framing only. Reasoning, raw errors, usage and credentials never
// leave this adapter. Validate assembled messages again before tools execute.
export async function readModelStream(
  response: Response,
  kind: "openrouter" | "ollama",
  onText: (delta: string) => void,
  signal: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("The assistant returned an empty response.");
  const decoder = new TextDecoder();
  let size = 0,
    content = "",
    pending = "",
    finished = false,
    terminal = false;
  const calls = new Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  >();
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
      const choice = chunk.choices?.[0];
      if (!choice) return; // usage-only frame
      if (
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
      if (ollamaCalls.length > 8) throw Error("Too many assistant tool calls.");
      if (chunk.done) {
        terminal = true;
        finished = true;
      }
    }
  };
  const parser = createParser({ onEvent: (event) => receive(event.data) });
  try {
    while (true) {
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
    const tail = decoder.decode();
    if (kind === "openrouter") parser.feed(tail);
    else if ((pending + tail).trim()) receive((pending + tail).trim());
    signal.throwIfAborted();
    if (!finished || !terminal)
      throw Error("The assistant response ended early. Please try again.");
    return kind === "openrouter"
      ? {
          choices: [
            {
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
