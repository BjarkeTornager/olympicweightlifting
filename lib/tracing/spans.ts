// The tracing API the rest of the app sees. A trace is one root span with
// children passed down explicitly. With tracing off or a turn not sampled,
// every call goes to a shared no-op span and nothing else runs. Every method
// catches its own errors: tracing can never fail or slow a request.
import { errorCategory } from "../error-log";
import { disabled, tracingConfig, type TracingConfig } from "./config";
import { sessionCode, userCode } from "./ids";
import {
  allowed,
  eventNames,
  spanName,
  type EventName,
  type RootName,
  type SpanAttributes,
  type SpanName,
} from "./attributes";
import type { Backend, RawSpan } from "./provider";

export type Operation = "invoke_agent" | "chat" | "execute_tool";

// A model message as content mode records it; images become "[image]".
export type ContentMessage = {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: unknown[];
};

export interface TraceSpan {
  // False for the no-op span.
  readonly recording: boolean;
  readonly traceId: string | undefined;
  child(
    name: SpanName,
    operation?: Operation,
    attributes?: SpanAttributes,
  ): TraceSpan;
  set(attributes: SpanAttributes): void;
  event(name: EventName, attributes?: SpanAttributes): void;
  // Records only the error's category, never its message or stack.
  fail(error: unknown): void;
  end(attributes?: SpanAttributes): void;
  // Message text for content mode (config.ts); ignored everywhere else.
  content(input: ContentMessage[], output?: ContentMessage): void;
  // While the server shuts down, waits up to half a second for the spans
  // ended so far to be sent; returns at once otherwise. Awaited after the
  // root ends, so the request stays open, and the process alive, until then.
  settle(): Promise<void>;
}

export const noTrace: TraceSpan = {
  recording: false,
  traceId: undefined,
  child: () => noTrace,
  set() {},
  event() {},
  fail() {},
  end() {},
  content() {},
  async settle() {},
};

type Trace = { backend: Backend; content: boolean; open: Set<LiveSpan> };

const plain = (m: ContentMessage) => ({
  role: m.role,
  content: m.content,
  ...(m.images?.length ? { images: m.images.map(() => "[image]") } : {}),
  ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
});

class LiveSpan implements TraceSpan {
  readonly recording = true;
  private failed = false;
  private ended = false;
  constructor(
    private readonly trace: Trace,
    private readonly raw: RawSpan,
    readonly traceId: string,
    private readonly root: boolean,
    private dropped: number,
  ) {
    if (!root) trace.open.add(this);
  }
  child(
    name: SpanName,
    operation?: Operation,
    attributes: SpanAttributes = {},
  ): TraceSpan {
    try {
      if (this.ended) return noTrace;
      const { kept, dropped } = allowed({
        ...attributes,
        ...(operation ? { "gen_ai.operation.name": operation } : {}),
      });
      const { span } = this.trace.backend.start(spanName(name), kept, this.raw);
      return new LiveSpan(this.trace, span, this.traceId, false, dropped);
    } catch {
      return noTrace;
    }
  }
  set(attributes: SpanAttributes) {
    try {
      if (this.ended) return;
      const { kept, dropped } = allowed(attributes);
      this.dropped += dropped;
      this.raw.setAttributes(kept);
    } catch {
      /* Tracing never fails a request. */
    }
  }
  event(name: EventName, attributes: SpanAttributes = {}) {
    try {
      if (this.ended || !eventNames.includes(name)) return;
      const { kept, dropped } = allowed(attributes);
      this.dropped += dropped;
      this.raw.addEvent(name, kept);
    } catch {
      /* Tracing never fails a request. */
    }
  }
  fail(error: unknown) {
    try {
      if (this.ended) return;
      const { kept } = allowed({ "lift.error": errorCategory(error) });
      const category = String(kept["lift.error"] ?? "unknown");
      this.failed = true;
      this.raw.setAttribute("lift.error", category);
      this.trace.backend.fail(this.raw, category);
    } catch {
      /* Tracing never fails a request. */
    }
  }
  end(attributes: SpanAttributes = {}) {
    try {
      if (this.ended) return;
      this.set(attributes);
      // A step left open by an early return or a throw ends with its trace.
      if (this.root) for (const span of [...this.trace.open]) span.end();
      if (this.dropped)
        this.raw.setAttribute("lift.dropped_attrs", this.dropped);
      this.ended = true;
      this.trace.open.delete(this);
      this.raw.end();
    } catch {
      /* Tracing never fails a request. */
    }
  }
  content(input: ContentMessage[], output?: ContentMessage) {
    if (!this.trace.content || this.ended) return;
    try {
      this.raw.setAttribute(
        "gen_ai.input.messages",
        JSON.stringify(input.map(plain)),
      );
      if (output)
        this.raw.setAttribute(
          "gen_ai.output.messages",
          JSON.stringify([plain(output)]),
        );
    } catch {
      /* Tracing never fails a request. */
    }
  }
  async settle() {
    try {
      await this.trace.backend.settle();
    } catch {
      /* Tracing never fails a request. */
    }
  }
}

let loading: Promise<typeof import("./provider")> | undefined;
async function backendFor(config: TracingConfig) {
  try {
    loading ??= import("./provider");
    return (await loading).tracingBackend(config);
  } catch {
    loading = undefined;
    return disabled("provider_failed");
  }
}

type Who = { userId: string; session?: () => string | undefined };

// Starts a trace for one unit of work, such as a Coach turn. The account is
// recorded only as its HMAC code; `session` is a key such as the account and
// local date, hashed the same way, and is only computed when tracing is on.
export async function startTrace(
  name: RootName,
  who: Who,
  attributes: SpanAttributes = {},
): Promise<TraceSpan> {
  try {
    const config = tracingConfig();
    if (!config || Math.random() >= config.sampleRate) return noTrace;
    const backend = await backendFor(config);
    if (!backend) return noTrace;
    const session = who.session?.();
    const { kept, dropped } = allowed({
      ...attributes,
      "user.id": userCode(config.userSecret, who.userId),
      ...(session
        ? { "session.id": sessionCode(config.userSecret, session) }
        : {}),
    });
    const { span, traceId } = backend.start(spanName(name), kept);
    return new LiveSpan(
      { backend, content: config.content, open: new Set() },
      span,
      traceId,
      true,
      dropped,
    );
  } catch {
    return noTrace;
  }
}

// A failure as its category and, for an HTTP error such as ApiError, its
// status. Never the message.
function failed(span: TraceSpan, error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") span.set({ "lift.http_status": status });
  span.fail(error);
}

// Runs one unit of work, such as a photo's tagging or a voice tool call, as
// a trace of its own. A throw sets lift.ok false and is recorded by its
// category; the root ends with the work and, while a deploy drains, the work
// waits briefly for its trace to be sent (settle). The work sets lift.ok
// itself when it succeeds.
export async function traced<T>(
  name: RootName,
  who: Who,
  attributes: SpanAttributes,
  work: (trace: TraceSpan) => Promise<T>,
): Promise<T> {
  const trace = await startTrace(name, who, attributes);
  try {
    return await work(trace);
  } catch (error) {
    trace.set({ "lift.ok": false });
    failed(trace, error);
    throw error;
  } finally {
    trace.end();
    await trace.settle();
  }
}

// Times one step as a child span, recording a throw by its category. A throw
// that `paused` accepts only pauses the work, such as a GPU job still
// running that a later attempt resumes: the step is marked lift.waiting, not
// failed.
export async function timed<T>(
  parent: TraceSpan,
  name: SpanName,
  work: (span: TraceSpan) => Promise<T>,
  paused?: (error: unknown) => boolean,
): Promise<T> {
  const span = parent.child(name);
  const started = Date.now();
  try {
    return await work(span);
  } catch (error) {
    if (paused?.(error)) span.set({ "lift.waiting": true });
    else failed(span, error);
    throw error;
  } finally {
    span.end({ "lift.ms": Date.now() - started });
  }
}
