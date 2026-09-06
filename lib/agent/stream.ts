import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import type { CoachResponse } from "../coach-visuals";
import { apiFailure } from "./http";

export type EmitCoachEvent = (event: BaseEvent) => void;

export function coachStream(
  request: Request,
  threadId: string,
  runId: string,
  run: (emit: EmitCoachEvent, signal: AbortSignal) => Promise<CoachResponse>,
) {
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  const utf8 = new TextEncoder();
  const cancelled = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    cancelled.signal,
    AbortSignal.timeout(100000),
  ]);
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: EmitCoachEvent = (event) => {
        if (!closed && !signal.aborted)
          controller.enqueue(utf8.encode(encoder.encode(event)));
      };
      emit({ type: EventType.RUN_STARTED, threadId, runId });
      heartbeat = setInterval(() => {
        if (!closed && !signal.aborted)
          controller.enqueue(utf8.encode(": keep-alive\n\n"));
      }, 10000);
      try {
        const result = await run(emit, signal);
        signal.throwIfAborted();
        // The durable, server-owned result is the authority, including review cards.
        emit({ type: EventType.RUN_FINISHED, threadId, runId, result });
      } catch (error) {
        if (!signal.aborted) {
          const failure = apiFailure(error);
          const { error: message } = await failure.json();
          emit({
            type: EventType.RUN_ERROR,
            message,
            code: String(failure.status),
          });
        }
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      cancelled.abort();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": encoder.getContentType(),
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
