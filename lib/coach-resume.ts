// A Coach reply that reads on after its connection drops. With
// COACH_TURN_EVENTS on, each event the server stores comes with its SSE id,
// and GET /api/agent/run?turnId=…&after=<id> sends the ones after it
// (lib/agent/turn-events.ts). This sits between fetch and the AG-UI client:
// it passes the reply on frame by frame, and when the stream fails before
// the run's last event, it reconnects from the last id it passed on, so the
// client sees one stream with nothing missing or repeated. Without ids (the
// switch off), after a clean end, or once reconnecting fails, the stream
// ends as the connection did, and the app reads the saved turn as before.

// The wait before each reconnect. A reconnect that brings new events
// starts the count again.
const RECONNECT_WAITS_MS = [1000, 2000, 4000];

type CoachEvent = {
  type?: string;
  name?: string;
  stepName?: string;
  messageId?: string;
  toolCallId?: string;
};

// The frames of an SSE stream, split as the AG-UI client splits them.
class Frames {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  // What came after the last whole frame.
  rest = "";

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  // The next whole frame, or undefined when the stream ends.
  async next() {
    while (true) {
      const end = this.rest.indexOf("\n\n");
      if (end >= 0) {
        const frame = this.rest.slice(0, end);
        this.rest = this.rest.slice(end + 2);
        return frame;
      }
      const { done, value } = await this.reader.read();
      if (done) {
        this.rest += this.decoder.decode();
        return undefined;
      }
      this.rest += this.decoder.decode(value, { stream: true });
    }
  }

  cancel() {
    void this.reader.cancel().catch(() => {});
  }
}

function parse(frame: string) {
  let id: number | undefined;
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim());
    else if (line.startsWith("data:"))
      data.push(line.slice(5).replace(/^ /, ""));
  }
  let event: CoachEvent | undefined;
  if (data.length)
    try {
      event = JSON.parse(data.join("\n"));
    } catch {
      // Passed on as it is; the AG-UI client reports it.
    }
  return { id: Number.isSafeInteger(id) ? id : undefined, event };
}

// What a cut-off attempt left open, closed when a later attempt replaces
// it (coach.reset), so the AG-UI client accepts the new attempt's events.
// The new attempt's messages are renamed: they reuse the cut-off ones' ids,
// and the client would add to the old text.
class Attempts {
  private steps = new Set<string>();
  private messages = new Set<string>();
  private toolCalls = new Set<string>();
  private resets = 0;

  // The frames to pass on for one event.
  pass(frame: string, event: CoachEvent | undefined): string[] {
    if (!event) return [frame];
    if (event.type === "CUSTOM" && event.name === "coach.reset") {
      const closing = [
        ...[...this.toolCalls].map((toolCallId) => ({
          type: "TOOL_CALL_END",
          toolCallId,
        })),
        ...[...this.messages].map((messageId) => ({
          type: "TEXT_MESSAGE_END",
          messageId,
        })),
        ...[...this.steps].map((stepName) => ({
          type: "STEP_FINISHED",
          stepName,
        })),
      ];
      this.steps.clear();
      this.messages.clear();
      this.toolCalls.clear();
      this.resets++;
      return [...closing.map((e) => `data: ${JSON.stringify(e)}`), frame];
    }
    const renamed =
      this.resets && event.messageId && event.type?.startsWith("TEXT_MESSAGE")
        ? { ...event, messageId: `${event.messageId}~${this.resets}` }
        : event;
    const { type, stepName, messageId, toolCallId } = renamed;
    if (type === "STEP_STARTED" && stepName) this.steps.add(stepName);
    else if (type === "STEP_FINISHED" && stepName) this.steps.delete(stepName);
    else if (type === "TEXT_MESSAGE_START" && messageId)
      this.messages.add(messageId);
    else if (type === "TEXT_MESSAGE_END" && messageId)
      this.messages.delete(messageId);
    else if (type === "TOOL_CALL_START" && toolCallId)
      this.toolCalls.add(toolCallId);
    else if (type === "TOOL_CALL_END" && toolCallId)
      this.toolCalls.delete(toolCallId);
    return [renamed === event ? frame : `data: ${JSON.stringify(renamed)}`];
  }
}

const finishes = (event: CoachEvent | undefined) =>
  event?.type === "RUN_FINISHED" || event?.type === "RUN_ERROR";

// Waits `ms`, or until `signal` aborts, which rejects with its reason.
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });

// `first` is the response to the run's POST; `resume(after)` asks for the
// events after that id. `signal` is the run's: Stop or the time limit.
export function resumableReply(
  first: Response,
  resume: (after: number, signal: AbortSignal) => Promise<Response>,
  signal: AbortSignal,
) {
  const utf8 = new TextEncoder();
  // Set when the AG-UI client cancels the stream: it stopped reading.
  const reading = new AbortController();
  const stop = AbortSignal.any([signal, reading.signal]);
  let frames: Frames | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!reading.signal.aborted) controller.enqueue(utf8.encode(text));
      };
      const end = (error?: unknown) => {
        if (reading.signal.aborted) return;
        if (error === undefined) controller.close();
        else controller.error(error);
      };
      const attempts = new Attempts();
      let lastId: number | undefined;
      let ended = false;
      let failures = 0;
      let failure: unknown;
      let response: Response | undefined = first;
      while (true) {
        let progressed = false;
        if (response?.body) {
          frames = new Frames(response.body);
          try {
            let frame: string | undefined;
            while ((frame = await frames.next()) !== undefined) {
              const { id, event } = parse(frame);
              for (const passed of attempts.pass(frame, event))
                send(`${passed}\n\n`);
              if (id !== undefined) {
                lastId = id;
                progressed = true;
              }
              ended ||= finishes(event);
            }
            // Ended by the server: whole, or cut short in a way a
            // reconnect wouldn't change. A last frame without its blank
            // line is passed on, as the AG-UI client reads one.
            if (frames.rest) send(frames.rest);
            return end();
          } catch (error) {
            failure = error;
          }
        }
        if (stop.aborted) return end(stop.reason);
        if (progressed) failures = 0;
        const wait = RECONNECT_WAITS_MS[failures++];
        // Without ids the switch is off, and a dropped reply fails as it
        // always has; so does one that can't be resumed in a few tries.
        if (ended || lastId === undefined || wait === undefined)
          return end(failure);
        response = undefined;
        try {
          await pause(wait, stop);
          const next = await resume(lastId, stop);
          // A release in progress answers 502 or 503: try again shortly.
          // Anything else (the reply can't be resumed, or wasn't found)
          // ends it as the connection did.
          if (next.ok) response = next;
          else {
            void next.body?.cancel().catch(() => {});
            if (next.status < 500) return end(failure);
          }
        } catch {
          if (stop.aborted) return end(stop.reason);
          // Offline for now: try again after the next wait.
        }
      }
    },
    cancel() {
      reading.abort();
      frames?.cancel();
    },
  });
  return new Response(body, { status: first.status, headers: first.headers });
}
