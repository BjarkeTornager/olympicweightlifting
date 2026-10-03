import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { allowed, spanName, rootNames } from "../lib/tracing/attributes";
import type { FinishedSpan } from "../lib/tracing/provider";
import { videoUploadSchema, type VideoAnalysis } from "../lib/video/types";
import { identifyLift } from "../lib/video/identification";

// Diagnostic traces beyond Coach turns (lib/tracing): transcript tidying,
// video review passes and the helpers the other roots use. Model-free: the
// provider is mocked at fetch, spans are read back from an in-memory
// exporter. None of what was said, shown or reviewed may reach a span.

const TRACING = {
  TRACING: "metadata",
  MLFLOW_TRACKING_URI: "http://127.0.0.1:5999",
  MLFLOW_EXPERIMENT_ID: "7",
  TRACE_USER_SECRET: "test-only-secret",
  TRACE_SAMPLE_RATE: undefined,
  TRACE_RETENTION_DAYS: undefined,
  TRACE_CONTENT: undefined,
  AGENT_PROVIDER: "openrouter",
  AGENT_MODEL: "openai/gpt-5.6-luna",
  OPENROUTER_API_KEY: "test-key",
};
const CANARY = "CANARY-7f3a";

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => Promise<T> | T,
) {
  const saved = Object.fromEntries(
    Object.keys(vars).map((key) => [key, process.env[key]]),
  );
  const assign = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  };
  assign(vars);
  try {
    return await run();
  } finally {
    assign(saved);
  }
}

// Every key allowed, every string short, and no content anywhere.
function contentFree(spans: FinishedSpan[], ...secrets: string[]) {
  for (const span of spans)
    for (const values of [
      span.attributes,
      ...span.events.map((e) => e.attributes),
    ]) {
      const { dropped } = allowed(values);
      assert.equal(dropped, 0, `${span.name} holds only allowed attributes`);
      for (const value of Object.values(values))
        for (const item of Array.isArray(value) ? value : [value])
          if (typeof item === "string") assert.ok(item.length <= 64);
    }
  const sent = JSON.stringify(spans);
  for (const secret of [CANARY, ...secrets])
    assert.ok(!sent.includes(secret), `${secret} is not in the trace`);
}

const usage = (prompt: number, cost: number) => ({
  prompt_tokens: prompt,
  completion_tokens: 30,
  prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  cost,
});

test("every root and step keeps its name, and a trigger is a fixed value", () => {
  for (const name of [
    ...rootNames,
    "context",
    "mint_token",
    "signed_url",
    "process_video",
    "identify",
    "refine",
    "sam3",
    "overlay_recovery",
    "review",
    "body_reconstruction",
  ])
    assert.equal(spanName(name), name);
  assert.deepEqual(
    allowed({
      "lift.trigger": "catch_up",
      "lift.provider": "elevenlabs",
      "lift.outcome": "requeued",
      "lift.review_failure": "attempt_range",
      "lift.socket_event": "go_away",
    }).dropped,
    0,
  );
  const { kept, dropped } = allowed({
    "lift.trigger": `upload ${CANARY}`,
    "lift.provider": "openai",
    "lift.purpose": CANARY,
    "lift.close_code": -1,
    "lift.outcome": "maybe",
    "lift.review_failure": "Coach said hello",
  } as Record<string, unknown>);
  assert.deepEqual(kept, {});
  assert.equal(dropped, 6);
});

test("traced and timed record an outcome, an HTTP status and a paused step, never a message", async () => {
  const { memoryExporterForTests } = await import("../lib/tracing/provider");
  const { traced, timed } = await import("../lib/tracing/spans");
  const { ApiError } = await import("../lib/agent/http");
  const { userCode } = await import("../lib/tracing/ids");
  const memory = await memoryExporterForTests();
  class Pending extends Error {}
  try {
    await withEnv(TRACING, async () => {
      await assert.rejects(
        traced(
          "voice_setup",
          { userId: "user-a" },
          { "lift.provider": "google" },
          async () => {
            throw new ApiError(`Limit reached ${CANARY}`, 429);
          },
        ),
        ApiError,
      );
      const value = await traced(
        "video_job",
        { userId: "user-a", session: () => "video:user-a:v1" },
        {},
        async (trace) => {
          await assert.rejects(
            timed(
              trace,
              "sam3",
              async () => {
                throw new Pending(CANARY);
              },
              (e) => e instanceof Pending,
            ),
          );
          await assert.rejects(
            timed(trace, "refine", async () => {
              throw Error(`Bad frame ${CANARY}`);
            }),
          );
          return timed(trace, "process_video", async () => 42);
        },
      );
      assert.equal(value, 42);
    });
    const spans = memory.spans();
    const named = (name: string) => spans.find((s) => s.name === name)!;
    const setup = named("voice_setup");
    assert.equal(setup.attributes["lift.ok"], false);
    assert.equal(setup.attributes["lift.http_status"], 429);
    assert.deepEqual(setup.status, { code: "error", message: "Error" });
    assert.equal(
      setup.attributes["user.id"],
      userCode("test-only-secret", "user-a"),
    );
    const job = named("video_job");
    assert.equal(job.status.code, "unset");
    assert.match(String(job.attributes["session.id"]), /^[0-9a-f]{32}$/);
    const sam3 = named("sam3");
    assert.equal(sam3.attributes["lift.waiting"], true);
    assert.equal(sam3.status.code, "unset", "a paused step hasn't failed");
    assert.equal(named("refine").status.code, "error");
    assert.ok(Number(named("process_video").attributes["lift.ms"]) >= 0);
    for (const step of ["sam3", "refine", "process_video"])
      assert.equal(named(step).parentSpanId, job.spanId);
    contentFree(spans, "user-a", "Limit reached", "Bad frame");
  } finally {
    await memory.stop();
  }
  // With tracing off the work runs as before, untraced.
  await withEnv({ ...TRACING, TRACING: undefined }, async () => {
    assert.equal(
      await traced("voice_tool", { userId: "user-a" }, {}, async (trace) => {
        assert.equal(trace.recording, false);
        return "done";
      }),
      "done",
    );
  });
});

test("a tidied transcript is one chat span per chunk, with usage and a failed chunk's status, never a line", async (t) => {
  const { memoryExporterForTests } = await import("../lib/tracing/provider");
  const { startTrace } = await import("../lib/tracing/spans");
  const { tidyTranscript } = await import("../lib/voice-transcript");
  const memory = await memoryExporterForTests();
  t.after(() => memory.stop());
  const lines = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 ? ("coach" as const) : ("you" as const),
    text: `I ate ${CANARY} oats ${i}`,
  }));
  let calls = 0;
  const transport = (async (_url: string, init: RequestInit) => {
    if (++calls === 2) return new Response("busy", { status: 503 });
    const sent = JSON.parse(JSON.parse(String(init.body)).messages[1].content);
    return Response.json({
      model: "openai/gpt-5.6-luna",
      usage: usage(2400, 0.0009),
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              lines: sent.lines.map((l: { text: string }) => `${l.text}.`),
            }),
          },
        },
      ],
    });
  }) as unknown as typeof fetch;
  await withEnv(TRACING, async () => {
    const trace = await startTrace(
      "voice_tidy",
      { userId: "user-a" },
      { "lift.trigger": "final", "lift.lines": lines.length },
    );
    const tidy = await tidyTranscript(lines, transport, trace);
    assert.equal(tidy?.length, 100);
    trace.end({ "lift.ok": Boolean(tidy) });
  });
  const spans = memory.spans();
  const root = spans.find((s) => s.name === "voice_tidy")!;
  assert.equal(root.attributes["lift.chunks"], 2);
  assert.equal(root.attributes["lift.trigger"], "final");
  const [first, second] = spans.filter((s) => s.name === "chat");
  assert.equal(first.parentSpanId, root.spanId);
  assert.equal(first.attributes["gen_ai.operation.name"], "chat");
  assert.equal(first.attributes["gen_ai.request.model"], "openai/gpt-5.6-luna");
  assert.equal(first.attributes["gen_ai.usage.input_tokens"], 2400);
  assert.equal(first.attributes["lift.cost_usd"], 0.0009);
  assert.equal(first.attributes["lift.lines"], 80);
  assert.equal(first.attributes["lift.ok"], true);
  assert.equal(second.attributes["lift.lines"], 20);
  assert.equal(second.attributes["lift.ok"], false);
  assert.equal(second.attributes["lift.http_status"], 503);
  assert.deepEqual(second.status, {
    code: "error",
    message: "provider_unavailable",
  });
  contentFree(spans, "oats");
});

test("each video review pass is a span with its model call, and says why it was rejected", async (t) => {
  const { memoryExporterForTests } = await import("../lib/tracing/provider");
  const { startTrace } = await import("../lib/tracing/spans");
  const { callModel } = await import("../lib/agent/provider");
  const { reviewMessages, reviewWithRecovery } =
    await import("../lib/video/review");
  const memory = await memoryExporterForTests();
  const evidence = {
    visibility: "sufficient",
    limitation: "",
    phases: [
      { kind: "pull", frame: 1, evidence: "Bar is lifted from the knees." },
      {
        kind: "front_rack_receive",
        frame: 3,
        evidence: "Bar is received at the front shoulders.",
      },
      {
        kind: "leg_drive_from_rack",
        frame: 5,
        evidence: "A separate dip and drive starts from the rack.",
      },
      {
        kind: "overhead_receive",
        frame: 7,
        evidence: "The bar is received with arms overhead.",
      },
    ],
  };
  const analysis: VideoAnalysis = {
    version: 1,
    width: 320,
    height: 480,
    duration: 4,
    frameCount: 120,
    sampleTimes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
    tracking: {
      status: "not_requested",
      reason: "",
      points: [],
      coverage: 0,
      horizontalRangeCm: null,
      riseCm: null,
      peakUpwardVelocity: null,
      velocities: [],
    },
  };
  analysis.identification = identifyLift(JSON.stringify(evidence), analysis);
  const coaching = {
    strength: `The rack position is visible ${CANARY}.`,
    limitation: "Side-view depth is uncertain.",
    moments: [],
  };
  let calls = 0;
  const fetch = mock.method(globalThis, "fetch", async () =>
    Response.json({
      model: "openai/gpt-5.6-luna",
      usage: usage(9000, 0.004),
      choices: [
        {
          message: {
            role: "assistant",
            content:
              ++calls === 1
                ? `Not JSON ${CANARY}`
                : JSON.stringify({ evidence, coaching }),
          },
        },
      ],
    }),
  );
  t.after(async () => {
    fetch.mock.restore();
    await memory.stop();
  });
  const input = videoUploadSchema.parse({
    id: crypto.randomUUID(),
    lift: "Identify from video",
    date: "2026-10-03",
    start: 0,
    end: 4,
  });
  await withEnv(TRACING, async () => {
    const trace = await startTrace("video_job", { userId: "user-a" });
    const reviewed = await reviewWithRecovery(
      reviewMessages(input, analysis, ["c3ludGhldGljLWZyYW1l"]),
      analysis,
      input,
      {
        id: "attempt-1",
        start: 0,
        end: 4,
        identification: analysis.identification!,
      },
      callModel,
      new AbortController().signal,
      async () => {},
      trace,
    );
    assert.equal(reviewed.identification.lift, "Clean & jerk");
    trace.end();
  });
  const spans = memory.spans();
  const root = spans.find((s) => s.name === "video_job")!;
  const passes = spans
    .filter((s) => s.name === "review")
    .sort(
      (a, b) =>
        Number(a.attributes["lift.pass"]) - Number(b.attributes["lift.pass"]),
    );
  assert.equal(passes.length, 2);
  assert.ok(passes.every((p) => p.parentSpanId === root.spanId));
  assert.deepEqual(
    passes.map((p) => [
      p.attributes["lift.repair"],
      p.attributes["lift.valid"],
      p.attributes["lift.review_failure"],
    ]),
    [
      [false, false, "invalid_json"],
      [true, true, undefined],
    ],
  );
  for (const pass of passes) {
    const [chat] = spans.filter((s) => s.parentSpanId === pass.spanId);
    assert.equal(chat.name, "chat");
    assert.equal(chat.attributes["gen_ai.usage.input_tokens"], 9000);
    assert.equal(chat.attributes["lift.image_count"], 1);
  }
  contentFree(spans, "c3ludGhldGljLWZyYW1l", "rack position", "Not JSON");
});
