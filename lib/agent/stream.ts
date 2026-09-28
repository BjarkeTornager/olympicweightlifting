import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import type { CoachResponse } from "../coach-visuals";
import { apiFailure } from "./http";

export type EmitCoachEvent = (event: BaseEvent) => void;

// Runs that carry on when their connection closes, by account and run id, so
// the athlete's Stop can still cancel them from another request.
const detachedRuns = new Map<string, AbortController>();

// Cancels a run started in the background mode. False when it isn't running
// here (it finished, or never started).
export function cancelRun(key: string) {
  const run = detachedRuns.get(key);
  run?.abort();
  return Boolean(run);
}

// Streams one Coach run as AG-UI events. By default a closed connection
// cancels the run (the website's Stop). With `background`, used by the
// iPhone app, the run carries on to its saved result when the connection
// closes, as it does when the athlete switches app; only cancelRun or the
// time limit stops it.
export function coachStream(
  request: Request,
  threadId: string,
  runId: string,
  run: (emit: EmitCoachEvent, signal: AbortSignal) => Promise<CoachResponse>,
  options: { background?: { key: string } } = {},
) {
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  const utf8 = new TextEncoder();
  const cancelled = new AbortController();
  const background = options.background;
  if (background) detachedRuns.set(background.key, cancelled);
  const signal = AbortSignal.any([
    ...(background ? [] : [request.signal]),
    cancelled.signal,
    AbortSignal.timeout(100000),
  ]);
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: EmitCoachEvent = (event) => {
        if (!closed && !signal.aborted)
          try {
            controller.enqueue(utf8.encode(encoder.encode(event)));
          } catch {
            // The connection closed as the event was sent.
            closed = true;
          }
      };
      emit({ type: EventType.RUN_STARTED, threadId, runId });
      heartbeat = setInterval(() => {
        if (!closed && !signal.aborted)
          try {
            controller.enqueue(utf8.encode(": keep-alive\n\n"));
          } catch {
            closed = true;
          }
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
        if (background && detachedRuns.get(background.key) === cancelled)
          detachedRuns.delete(background.key);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      if (!background) cancelled.abort();
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
