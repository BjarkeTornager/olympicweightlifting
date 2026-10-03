// The only module that loads OpenTelemetry at run time. spans.ts imports it
// on the first traced turn, so with tracing off none of this is loaded.
//
// The tracer provider is never registered globally: Next.js would otherwise
// export every request as a trace and nest Coach's spans under its own.
// Parents are passed explicitly, so there is no context manager either.
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  BatchSpanProcessor,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { TracingConfig } from "./config";

export type RawSpan = Span;
export type Backend = {
  start(
    name: string,
    attributes: Attributes,
    parent?: RawSpan,
  ): { span: RawSpan; traceId: string };
  fail(span: RawSpan, category: string): void;
};

type State = { provider: BasicTracerProvider; tracer: Tracer };
// Shared through globalThis: instrumentation.ts and the route handlers are
// separate bundles, and a module-level provider would be created in each.
const KEY = Symbol.for("lift.tracing");
const shared = globalThis as unknown as Record<symbol, State | undefined>;

// Export failures are logged at most every ten minutes, without the
// endpoint or the error text.
let lastReported = 0;
class ReportingExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}
  export(...[spans, done]: Parameters<SpanExporter["export"]>) {
    this.inner.export(spans, (result) => {
      // 0 is ExportResultCode.SUCCESS.
      if (result.code !== 0 && Date.now() - lastReported > 600000) {
        lastReported = Date.now();
        console.warn(
          JSON.stringify({
            event: "tracing_export_failed",
            spans: spans.length,
          }),
        );
      }
      done(result);
    });
  }
  shutdown() {
    return this.inner.shutdown();
  }
  forceFlush() {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

function create(processor: SpanProcessor, content: boolean): State {
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "lift-journal",
      "deployment.environment":
        process.env.RAILWAY_ENVIRONMENT_NAME ??
        process.env.NODE_ENV ??
        "development",
      "service.version":
        process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
    }),
    // Sampling is decided once per root in spans.ts.
    sampler: new AlwaysOnSampler(),
    spanLimits: {
      attributeCountLimit: 64,
      eventCountLimit: 32,
      // Validated values are short; only content mode sends message text.
      ...(content ? {} : { attributeValueLengthLimit: 256 }),
    },
    spanProcessors: [processor],
  });
  return { provider, tracer: provider.getTracer("lift-journal") };
}

function backend({ tracer }: State): Backend {
  return {
    start(name, attributes, parent) {
      const span = tracer.startSpan(
        name,
        { attributes },
        parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT,
      );
      return { span, traceId: span.spanContext().traceId };
    },
    // MLflow reads an unset status as OK, so only failures set one.
    fail(span, category) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: category });
    },
  };
}

export function tracingBackend(config: TracingConfig): Backend {
  let state = shared[KEY];
  if (!state) {
    const exporter = new OTLPTraceExporter({
      url: `${config.trackingUri}/v1/traces`,
      headers: {
        "x-mlflow-experiment-id": config.experimentId,
        ...(config.authorization
          ? { Authorization: config.authorization }
          : {}),
      },
      timeoutMillis: 5000,
    });
    // Drops spans when the queue is full; a turn never waits for an export.
    state = create(
      new BatchSpanProcessor(new ReportingExporter(exporter), {
        scheduledDelayMillis: 1000,
        maxQueueSize: 2048,
        maxExportBatchSize: 256,
        exportTimeoutMillis: 5000,
      }),
      config.content,
    );
    shared[KEY] = state;
    const provider = state.provider;
    // Next.js closes the server and exits on SIGTERM; flush alongside it. In
    // a script with no handler of its own, end the process afterwards as
    // SIGTERM would have.
    process.once("SIGTERM", () => {
      const alone = process.listenerCount("SIGTERM") === 0;
      void provider
        .forceFlush({ timeoutMillis: 1500 })
        .catch(() => {})
        .finally(() => {
          if (alone) process.kill(process.pid, "SIGTERM");
        });
    });
    // The export timer doesn't keep a process alive, so a script that ends
    // on its own (a benchmark, an eval) flushes before it exits.
    process.once("beforeExit", () => {
      void provider.forceFlush({ timeoutMillis: 2000 }).catch(() => {});
    });
  }
  return backend(state);
}

export function flushTracing() {
  return shared[KEY]?.provider.forceFlush().catch(() => {});
}

export type FinishedSpan = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes: Record<string, unknown> }[];
  status: { code: "unset" | "ok" | "error"; message?: string };
};

// Tests only: replaces the exporter with an in-memory one, so spans can be
// read back without MLflow or any network.
export async function memoryExporterForTests(content = false) {
  await shared[KEY]?.provider.shutdown().catch(() => {});
  const exporter = new InMemorySpanExporter();
  shared[KEY] = create(new SimpleSpanProcessor(exporter), content);
  return {
    spans(): FinishedSpan[] {
      return exporter.getFinishedSpans().map((s) => ({
        name: s.name,
        traceId: s.spanContext().traceId,
        spanId: s.spanContext().spanId,
        ...(s.parentSpanContext
          ? { parentSpanId: s.parentSpanContext.spanId }
          : {}),
        attributes: { ...s.attributes },
        events: s.events.map((e) => ({
          name: e.name,
          attributes: { ...e.attributes },
        })),
        status: {
          code:
            s.status.code === SpanStatusCode.ERROR
              ? "error"
              : s.status.code === SpanStatusCode.OK
                ? "ok"
                : "unset",
          ...(s.status.message ? { message: s.status.message } : {}),
        },
      }));
    },
    reset() {
      exporter.reset();
    },
    async stop() {
      await shared[KEY]?.provider.shutdown().catch(() => {});
      shared[KEY] = undefined;
    },
  };
}
