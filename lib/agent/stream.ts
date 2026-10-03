import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import type { CoachResponse } from "../coach-visuals";
import { logFailure } from "../error-log";
import { apiFailure } from "./http";
import { readTurnEvents, TurnEventWriter } from "./turn-events";

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
        if (!signal.aborted) emit(await runError(error));
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
  return eventStream(body, encoder);
}

// The run's failure as the app is told it: the message and HTTP status the
// request would have been answered with, never the raw error.
async function runError(error: unknown): Promise<BaseEvent> {
  const failure = apiFailure(error);
  const { error: message } = await failure.json();
  return { type: EventType.RUN_ERROR, message, code: String(failure.status) };
}

function eventStream(body: ReadableStream<Uint8Array>, encoder: EventEncoder) {
  return new Response(body, {
    headers: {
      "Content-Type": encoder.getContentType(),
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Sends SSE frames as `frames` gives them, with the same keep-alive as
// coachStream, until it ends or the connection closes. `onClose` is told
// when the app closes the connection.
function framedStream(
  encoder: EventEncoder,
  frames: (send: (frame: string) => void, signal: AbortSignal) => Promise<void>,
  onClose?: () => void,
) {
  const utf8 = new TextEncoder();
  const reading = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: string) => {
        if (!reading.signal.aborted)
          try {
            controller.enqueue(utf8.encode(frame));
          } catch {
            // The connection closed as the frame was sent.
            reading.abort();
          }
      };
      heartbeat = setInterval(() => send(": keep-alive\n\n"), 10000);
      try {
        await frames(send, reading.signal);
      } catch (error) {
        // The turn carries on; the app reads its saved result.
        logFailure("turn_events_read_failed", error);
      } finally {
        clearInterval(heartbeat);
        if (!reading.signal.aborted) {
          reading.abort();
          controller.close();
        }
      }
    },
    cancel() {
      reading.abort();
      clearInterval(heartbeat);
      onClose?.();
    },
  });
  return eventStream(body, encoder);
}

// coachStream with COACH_TURN_EVENTS on: the run writes its events to
// Postgres (lib/agent/turn-events.ts) and this stream sends them from there,
// each with its SSE id, so an app that loses the connection can read on
// from where it was with resumeCoachStream. The events are the same as
// coachStream's, the reply's pieces merged about every 250 ms. As with
// coachStream, a closed connection cancels the run, as the website's Stop
// does, which also calls /api/agent/run/cancel. With `background` it doesn't:
// only cancelRun or the time limit does, and `waitUntil` (after() in the
// route) keeps a release's shutdown waiting for it.
export function storedCoachStream(
  request: Request,
  threadId: string,
  runId: string,
  run: (
    emit: EmitCoachEvent,
    signal: AbortSignal,
    onAttempt: (attempt: number) => void,
  ) => Promise<CoachResponse>,
  options: {
    key: string;
    background?: boolean;
    waitUntil?: (work: Promise<unknown>) => void;
  },
) {
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  const cancelled = new AbortController();
  // A second request for a run already under way doesn't take its Stop;
  // the one that takes the turn does.
  if (!detachedRuns.has(options.key)) detachedRuns.set(options.key, cancelled);
  const signal = AbortSignal.any([
    ...(options.background ? [] : [request.signal]),
    cancelled.signal,
    AbortSignal.timeout(100000),
  ]);
  const writer = new TurnEventWriter(runId);
  // The run's last event, and whether it is in the table. When it isn't
  // (the run ended before taking the turn, with a saved reply, a limit's
  // reply or a refusal, or writing failed), or reading the table failed,
  // it is sent from here.
  let lastEvent: BaseEvent | undefined;
  let stored = false;
  const finished = (async () => {
    try {
      const result = await run(writer.emit, signal, (attempt) => {
        detachedRuns.set(options.key, cancelled);
        writer.claim(attempt);
      });
      signal.throwIfAborted();
      // The durable, server-owned result is the authority, including review cards.
      lastEvent = { type: EventType.RUN_FINISHED, threadId, runId, result };
    } catch (error) {
      if (!signal.aborted) lastEvent = await runError(error);
    } finally {
      if (detachedRuns.get(options.key) === cancelled)
        detachedRuns.delete(options.key);
    }
    stored = await writer.finish(lastEvent);
  })();
  options.waitUntil?.(finished);
  return framedStream(
    encoder,
    async (send, reading) => {
      send(encoder.encode({ type: EventType.RUN_STARTED, threadId, runId }));
      await Promise.race([writer.claimed, finished]);
      if (reading.aborted) return;
      let readFailed = false;
      if (writer.position)
        try {
          for await (const frame of readTurnEvents({
            turnId: runId,
            ...writer.position,
            signal: reading,
            writer,
          }))
            send(frame);
        } catch (error) {
          // The run carries on in this process, so its last event still
          // comes, from here.
          logFailure("turn_events_read_failed", error);
          readFailed = true;
        }
      if (reading.aborted) return;
      await finished;
      if (lastEvent && (!stored || readFailed)) send(encoder.encode(lastEvent));
    },
    () => {
      if (!options.background) cancelled.abort();
    },
  );
}

// Picks up a turn's events where a dropped connection left them: those
// after `after` (the last SSE id the app read) and the rest as they come,
// with COACH_TURN_EVENTS on. From the start of the turn's latest attempt,
// after RUN_STARTED, when the app read none.
export function resumeCoachStream(
  threadId: string,
  turnId: string,
  from: { after: number; attempt?: number; started: boolean },
) {
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  return framedStream(encoder, async (send, reading) => {
    if (from.started)
      send(
        encoder.encode({
          type: EventType.RUN_STARTED,
          threadId,
          runId: turnId,
        }),
      );
    for await (const frame of readTurnEvents({
      turnId,
      after: from.after,
      attempt: from.attempt,
      signal: reading,
    }))
      send(frame);
  });
}
