import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { allowed, attributes, spanName } from "../lib/tracing/attributes";
import {
  contentAllowed,
  traceAdminConfig,
  tracingConfig,
} from "../lib/tracing/config";
import { accountTraceCode, sessionCode, userCode } from "../lib/tracing/ids";

// Diagnostic traces (lib/tracing): off by default, metadata only, accounts
// only as HMAC codes. Model-free: the provider and MLflow are mocked, and
// spans are read back from an in-memory exporter.

const TRACING = {
  TRACING: "metadata",
  MLFLOW_TRACKING_URI: "http://127.0.0.1:5999",
  MLFLOW_EXPERIMENT_ID: "7",
  TRACE_USER_SECRET: "test-only-secret",
  TRACE_SAMPLE_RATE: undefined,
  TRACE_RETENTION_DAYS: undefined,
  TRACE_CONTENT: undefined,
  MLFLOW_TRACKING_USERNAME: undefined,
  MLFLOW_TRACKING_PASSWORD: undefined,
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

const providerState = () =>
  (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for("lift.tracing")
  ];

test("tracing is off by default: no provider, no network and a no-op span", async (t) => {
  const fetch = mock.method(globalThis, "fetch", async () => {
    throw Error("no network with tracing off");
  });
  const warn = mock.method(console, "warn", () => {});
  t.after(() => {
    fetch.mock.restore();
    warn.mock.restore();
  });
  const { startTrace } = await import("../lib/tracing/spans");
  await withEnv({ ...TRACING, TRACING: undefined }, async () => {
    let session = false;
    const trace = await startTrace(
      "coach_turn",
      {
        userId: "user-a",
        session: () => {
          session = true;
          return "coach:user-a:2026-10-03";
        },
      },
      { "lift.streaming": true },
    );
    assert.equal(trace.recording, false);
    assert.equal(trace.traceId, undefined);
    const child = trace.child("round");
    child.set({ "lift.round": 0 });
    child.fail(Error("ignored"));
    child.end();
    trace.end();
    assert.equal(session, false, "nothing is computed for a trace never made");
  });
  // A missing variable turns tracing off with one log line per reason.
  await withEnv({ ...TRACING, TRACE_USER_SECRET: undefined }, async () => {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await startTrace("coach_turn", { userId: "user-a" })).recording,
        false,
      );
  });
  await withEnv({ ...TRACING, TRACE_SAMPLE_RATE: "0" }, async () => {
    assert.equal(
      (await startTrace("coach_turn", { userId: "user-a" })).recording,
      false,
      "a turn that isn't sampled isn't traced",
    );
  });
  assert.equal(providerState(), undefined, "no provider was created");
  assert.equal(fetch.mock.callCount(), 0);
  const lines = warn.mock.calls.map((c) => JSON.parse(String(c.arguments[0])));
  assert.deepEqual(lines, [
    { event: "tracing_disabled", reason: "missing_user_secret" },
  ]);
});

test("configuration is checked before anything is traced", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const config = (vars: Record<string, string | undefined>) =>
      tracingConfig({ ...TRACING, ...vars });
    assert.equal(config({ TRACING: "off" }), null);
    assert.equal(config({ TRACING: "everything" }), null);
    assert.equal(
      config({ MLFLOW_TRACKING_URI: "http://user:pass@127.0.0.1:5000" }),
      null,
    );
    assert.equal(config({ MLFLOW_TRACKING_URI: "file:///tmp/mlruns" }), null);
    assert.equal(config({ MLFLOW_EXPERIMENT_ID: "lift; drop" }), null);
    assert.equal(config({ TRACE_SAMPLE_RATE: "2" }), null);
    assert.equal(config({ TRACE_RETENTION_DAYS: "31" }), null);
    assert.equal(
      config({ NODE_ENV: "production" }),
      null,
      "production needs a long secret",
    );
    const ok = config({
      MLFLOW_TRACKING_URI: "http://mlflow.railway.internal:5000/",
      MLFLOW_TRACKING_USERNAME: "lift-app",
      MLFLOW_TRACKING_PASSWORD: "app-password",
      TRACE_SAMPLE_RATE: "0.5",
    });
    assert.equal(ok?.trackingUri, "http://mlflow.railway.internal:5000");
    assert.equal(
      ok?.authorization,
      `Basic ${Buffer.from("lift-app:app-password").toString("base64")}`,
    );
    assert.equal(ok?.sampleRate, 0.5);
    assert.equal(ok?.retentionDays, 30);
    assert.equal(ok?.content, false);
  } finally {
    warn.mock.restore();
  }
});

test("content mode only away from production, on a _test database and a local MLflow", () => {
  const local = "http://127.0.0.1:5001";
  const env = {
    TRACE_CONTENT: "1",
    NODE_ENV: "development",
    DATABASE_URL: "postgres://lift@127.0.0.1:54329/lift_test",
  };
  assert.equal(contentAllowed(env, local), true);
  assert.equal(contentAllowed(env, "http://localhost:5001"), true);
  assert.equal(
    contentAllowed({ ...env, TRACE_CONTENT: undefined }, local),
    false,
  );
  assert.equal(
    contentAllowed({ ...env, NODE_ENV: "production" }, local),
    false,
  );
  assert.equal(
    contentAllowed(
      { ...env, DATABASE_URL: "postgres://lift@127.0.0.1:54329/lift" },
      local,
    ),
    false,
  );
  assert.equal(
    contentAllowed(env, "http://mlflow.railway.internal:5000"),
    false,
  );
});

test("only allowed keys and values survive, and text has nowhere to go", () => {
  const { kept, dropped } = allowed({
    "lift.status": "done",
    "lift.round": 2,
    "gen_ai.request.model": "openai/gpt-5.6-luna",
    "lift.skills": ["photos", "routes"],
    "lift.cost_usd": 0.0021,
    // Each of these is dropped.
    "lift.error": `Error: ${CANARY} ate pizza`,
    "gen_ai.response.model": `Model ${CANARY}`,
    "lift.tier": "luna; drop",
    "lift.rows": -1,
    "lift.ms": Number.NaN,
    "lift.change_kinds": [CANARY],
    "lift.message": CANARY,
    "gen_ai.input.messages": CANARY,
    "user.id": "user-a",
  } as Record<string, unknown>);
  assert.deepEqual(kept, {
    "lift.status": "done",
    "lift.round": 2,
    "gen_ai.request.model": "openai/gpt-5.6-luna",
    "lift.skills": ["photos", "routes"],
    "lift.cost_usd": 0.0021,
  });
  assert.equal(dropped, 9);
  assert.equal(
    Object.hasOwn(attributes, "gen_ai.input.messages") ||
      Object.hasOwn(attributes, "gen_ai.output.messages") ||
      Object.hasOwn(attributes, "gen_ai.tool.call.arguments"),
    false,
    "no key for messages or tool inputs",
  );
  assert.equal(spanName("round"), "round");
  assert.equal(spanName("tool.find_sessions"), "tool.find_sessions");
  assert.equal(spanName(`tool.${CANARY}`), "tool.unknown");
  assert.equal(spanName("my meal"), "tool.unknown");
});

test("accounts and sessions are HMAC codes: stable, secret-bound and not the id", () => {
  const code = userCode("secret-a", "user-123");
  assert.match(code, /^[0-9a-f]{32}$/);
  assert.equal(userCode("secret-a", "user-123"), code);
  assert.notEqual(userCode("secret-b", "user-123"), code);
  assert.notEqual(userCode("secret-a", "user-124"), code);
  assert.notEqual(sessionCode("secret-a", "user-123"), code);
  assert.ok(!code.includes("user-123"));
});

test("a failure is recorded only as its category, and open steps end with the trace", async () => {
  const { memoryExporterForTests } = await import("../lib/tracing/provider");
  const { startTrace } = await import("../lib/tracing/spans");
  const { ProviderError } = await import("../lib/agent/provider");
  const memory = await memoryExporterForTests();
  try {
    await withEnv(TRACING, async () => {
      const trace = await startTrace("coach_turn", { userId: "user-a" });
      assert.equal(trace.recording, true);
      const tool = trace.child("tool.find_sessions", "execute_tool");
      tool.fail(Error(`My meal was ${CANARY} pizza`));
      tool.end({ "lift.ok": false });
      const chat = trace.child("chat", "chat");
      chat.fail(new ProviderError(`Rate limited ${CANARY}`, 429));
      chat.end();
      // Left open, as a throw would: it ends with its trace.
      trace.child("round", undefined, { "lift.round": 1 });
      trace.set({ "lift.status": CANARY } as Record<string, unknown>);
      trace.end({ "lift.status": "failed" });
    });
    const spans = memory.spans();
    assert.deepEqual(spans.map((s) => s.name).sort(), [
      "chat",
      "coach_turn",
      "round",
      "tool.find_sessions",
    ]);
    const tool = spans.find((s) => s.name === "tool.find_sessions")!;
    assert.deepEqual(tool.status, { code: "error", message: "Error" });
    assert.equal(tool.attributes["lift.error"], "Error");
    assert.equal(
      spans.find((s) => s.name === "chat")!.status.message,
      "provider_rate_limited",
    );
    const root = spans.find((s) => s.name === "coach_turn")!;
    assert.equal(root.attributes["lift.status"], "failed");
    assert.equal(root.attributes["lift.dropped_attrs"], 1);
    assert.equal(
      root.attributes["user.id"],
      userCode("test-only-secret", "user-a"),
    );
    assert.doesNotMatch(JSON.stringify(spans), /CANARY|pizza|user-a/);
  } finally {
    await memory.stop();
  }
});

test("a turn that ends while the server shuts down returns only once its trace is sent", async () => {
  const { memoryExporterForTests } = await import("../lib/tracing/provider");
  const { startTrace, noTrace } = await import("../lib/tracing/spans");
  const memory = await memoryExporterForTests(false, { batched: true });
  try {
    await withEnv(TRACING, async () => {
      // Normally spans wait for the batch timer, and the turn doesn't.
      const early = await startTrace("coach_turn", { userId: "user-a" });
      early.end();
      await early.settle();
      assert.equal(memory.spans().length, 0);
      // SIGTERM sends what is queued.
      await memory.drain();
      assert.deepEqual(
        memory.spans().map((s) => s.name),
        ["coach_turn"],
      );
      // A turn still running ends after the signal: without settle its
      // root would wait a second for the timer, and the process exits first.
      const late = await startTrace("coach_turn", { userId: "user-a" });
      late.child("commit").end();
      late.end({ "lift.status": "done" });
      const sent = () =>
        memory.spans().filter((s) => s.traceId === late.traceId);
      assert.equal(sent().length, 0);
      await late.settle();
      assert.deepEqual(
        sent()
          .map((s) => s.name)
          .sort(),
        ["coach_turn", "commit"],
      );
      const root = sent().find((s) => s.name === "coach_turn")!;
      assert.equal(root.attributes["lift.status"], "done");
      assert.equal(
        root.attributes["user.id"],
        userCode("test-only-secret", "user-a"),
      );
      await noTrace.settle();
    });
  } finally {
    await memory.stop();
  }
});

const usage = (prompt: number, cost: number) => ({
  prompt_tokens: prompt,
  completion_tokens: 12,
  prompt_tokens_details: { cached_tokens: prompt - 100, cache_write_tokens: 0 },
  cost,
});

test("a reply blocked by the content filter and its retry are two chat spans, each with its usage", async (t) => {
  const { memoryExporterForTests } = await import("../lib/tracing/provider");
  const { startTrace } = await import("../lib/tracing/spans");
  const { callModel, FILTER_FALLBACK_MODEL } =
    await import("../lib/agent/provider");
  const memory = await memoryExporterForTests();
  const fetch = mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const filtered = body.model !== FILTER_FALLBACK_MODEL;
      if (body.stream) {
        const frames = filtered
          ? [
              {
                model: body.model,
                choices: [{ finish_reason: "content_filter", delta: {} }],
              },
            ]
          : [
              {
                model: body.model,
                choices: [{ delta: { content: "Three " } }],
              },
              {
                choices: [
                  { delta: { content: "doubles." }, finish_reason: "stop" },
                ],
              },
              { model: body.model, choices: [], usage: usage(900, 0.0004) },
            ];
        return new Response(
          frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") +
            "data: [DONE]\n\n",
        );
      }
      return Response.json({
        model: body.model,
        usage: filtered ? usage(1200, 0.003) : usage(900, 0.0004),
        choices: [
          {
            finish_reason: filtered ? "content_filter" : "stop",
            message: {
              role: "assistant",
              content: filtered
                ? `Sorry ${CANARY}`
                : `Three doubles ${CANARY}.`,
            },
          },
        ],
      });
    },
  );
  t.after(async () => {
    fetch.mock.restore();
    await memory.stop();
  });
  await withEnv(
    {
      ...TRACING,
      AGENT_PROVIDER: "openrouter",
      AGENT_MODEL: "openai/gpt-5.6-luna",
      OPENROUTER_API_KEY: "test-key",
    },
    async () => {
      const trace = await startTrace("coach_turn", { userId: "user-a" });
      const round = trace.child("round");
      const reply = await callModel(
        [
          {
            role: "user",
            content: `How many sets? ${CANARY}`,
            images: ["YWJj"],
          },
        ],
        [],
        AbortSignal.timeout(5000),
        undefined,
        { model: "openai/gpt-5.6-luna", span: round },
      );
      assert.equal(reply.content, `Three doubles ${CANARY}.`);
      assert.equal(reply.blocked?.inputTokens, 1200);
      assert.equal(reply.blocked?.costUsd, 0.003);
      assert.ok(reply.blocked!.ms >= 0);
      // Streamed: the blocked call ends early, without usage.
      const streamed = await callModel(
        [{ role: "user", content: "Hi" }],
        [],
        AbortSignal.timeout(5000),
        () => {},
        { span: round },
      );
      assert.equal(streamed.content, "Three doubles.");
      assert.equal(streamed.blocked?.model, "openai/gpt-5.6-luna");
      round.end();
      trace.end();
    },
  );
  const chats = memory.spans().filter((s) => s.name === "chat");
  assert.equal(chats.length, 4);
  const [blocked, retry, blockedStream, retryStream] = chats.map(
    (s) => s.attributes,
  );
  assert.equal(blocked["lift.filtered"], true);
  assert.equal(blocked["gen_ai.request.model"], "openai/gpt-5.6-luna");
  assert.equal(blocked["gen_ai.usage.input_tokens"], 1200);
  assert.equal(blocked["gen_ai.usage.cache_read.input_tokens"], 1100);
  assert.equal(blocked["lift.cost_usd"], 0.003);
  assert.equal(blocked["lift.image_count"], 1);
  assert.equal(retry["lift.fallback"], true);
  assert.equal(retry["lift.filtered"], false);
  assert.equal(retry["gen_ai.request.model"], FILTER_FALLBACK_MODEL);
  assert.equal(retry["gen_ai.usage.output_tokens"], 12);
  assert.equal(blockedStream["lift.filtered"], true);
  assert.equal(blockedStream["gen_ai.usage.input_tokens"], undefined);
  assert.equal(retryStream["lift.streaming"], true);
  assert.ok(Number(retryStream["lift.first_token_ms"]) >= 0);
  assert.equal(retryStream["gen_ai.usage.input_tokens"], 900);
  assert.ok(
    chats.every((s) => s.attributes["gen_ai.operation.name"] === "chat"),
  );
  assert.doesNotMatch(JSON.stringify(memory.spans()), /CANARY|YWJj|sets\?/);
});

test("content mode records messages, with images replaced, only where it is allowed", async (t) => {
  const { memoryExporterForTests } = await import("../lib/tracing/provider");
  const { startTrace } = await import("../lib/tracing/spans");
  const { callModel } = await import("../lib/agent/provider");
  const fetch = mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ message: { role: "assistant", content: "Synthetic reply" } }],
    }),
  );
  t.after(() => fetch.mock.restore());
  const env = {
    ...TRACING,
    AGENT_PROVIDER: "openrouter",
    AGENT_MODEL: "openai/gpt-5.6-luna",
    OPENROUTER_API_KEY: "test-key",
    TRACE_CONTENT: "1",
    NODE_ENV: "development",
    DATABASE_URL: "postgres://lift@127.0.0.1:54329/lift_test",
    // Long enough for production, so that case is traced too.
    TRACE_USER_SECRET: "test-only-secret-long-enough-for-production",
  };
  const run = async (vars: Record<string, string | undefined>) => {
    const memory = await memoryExporterForTests(true);
    try {
      await withEnv(vars, async () => {
        const trace = await startTrace("coach_turn", { userId: "bench" });
        await callModel(
          [{ role: "user", content: "Synthetic meal", images: ["YWJjZGVm"] }],
          [],
          AbortSignal.timeout(5000),
          undefined,
          { span: trace },
        );
        trace.end();
      });
      return memory.spans().find((s) => s.name === "chat")!.attributes;
    } finally {
      await memory.stop();
    }
  };
  const allowedHere = await run(env);
  assert.deepEqual(JSON.parse(String(allowedHere["gen_ai.input.messages"])), [
    { role: "user", content: "Synthetic meal", images: ["[image]"] },
  ]);
  assert.match(
    String(allowedHere["gen_ai.output.messages"]),
    /Synthetic reply/,
  );
  for (const vars of [
    { ...env, NODE_ENV: "production" },
    { ...env, DATABASE_URL: "postgres://lift@127.0.0.1:54329/lift" },
    { ...env, MLFLOW_TRACKING_URI: "http://mlflow.railway.internal:5000" },
  ]) {
    const attributes = await run(vars);
    assert.equal(attributes["gen_ai.input.messages"], undefined);
    assert.equal(attributes["gen_ai.output.messages"], undefined);
  }
});

test("routing returns Jev's tokens and time, and why the rules decided instead", async () => {
  const { routeCoachTurn } = await import("../lib/agent/routing");
  const jev = {
    model: "jev-1.13.0",
    answers: {
      work_kind: {
        type: "choice",
        choice: "log",
        confidence: 0.96,
        probabilities: { log: 0.94, explain: 0.06 },
      },
      difficulty: {
        type: "score",
        score: 0.1,
        confidence: 0.94,
        probabilities: { "0": 0.92, "1": 0.06, "2": 0.02 },
      },
      mutation_stakes: { type: "noul", noul: 0.03 },
    },
    usage: { input_tokens: 812, output_tokens: 9 },
  };
  await withEnv(
    {
      AGENT_PROVIDER: "openrouter",
      AGENT_MODEL: "openai/gpt-5.6-luna",
      OPENROUTER_API_KEY: "test-key",
      AGENT_ROUTING: "jev",
      TYPESAFE_API_KEY: "test-typesafe",
    },
    async () => {
      const input = {
        message: "I ate eggs",
        photoCount: 0,
        activeWorkout: false,
      };
      const routed = await routeCoachTurn(input, async () =>
        Response.json(jev),
      );
      assert.equal(routed.source, "jev");
      assert.equal(routed.jev?.inputTokens, 812);
      assert.equal(routed.jev?.outputTokens, 9);
      assert.ok(routed.jev!.ms >= 0);
      assert.equal(routed.jev?.fallback, undefined);
      const failed = await routeCoachTurn(input, async () =>
        Response.json({}, { status: 503 }),
      );
      assert.equal(failed.source, "fallback");
      assert.equal(failed.jev?.fallback, "error");
      const slow = await routeCoachTurn(input, async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      });
      assert.equal(slow.jev?.fallback, "timeout");
    },
  );
});

test("an account's traces are found by code and deleted, and expired traces in batches", async () => {
  const { deleteOlderThan, deleteUserTraces } =
    await import("../lib/tracing/admin");
  const config = tracingConfig({
    ...TRACING,
    MLFLOW_TRACKING_USERNAME: "lift-app",
    MLFLOW_TRACKING_PASSWORD: "app-password",
  })!;
  const code = userCode(config.userSecret, "user-a");
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const pages = [
    {
      traces: [{ trace_id: "tr-1" }, { trace_id: "tr-2" }],
      next_page_token: "p2",
    },
    { traces: [{ trace_id: "tr-3" }] },
  ];
  const transport = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url, body });
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      config.authorization,
    );
    if (url.endsWith("/traces/search")) return Response.json(pages.shift());
    return Response.json({ traces_deleted: body.request_ids?.length ?? 0 });
  }) as typeof fetch;
  assert.equal(await deleteUserTraces(code, config, transport), 3);
  assert.deepEqual(
    requests.map((r) => r.url),
    [
      "http://127.0.0.1:5999/api/3.0/mlflow/traces/search",
      "http://127.0.0.1:5999/api/3.0/mlflow/traces/search",
      "http://127.0.0.1:5999/api/2.0/mlflow/traces/delete-traces",
    ],
  );
  assert.equal(
    requests[0].body.filter,
    `metadata.\`mlflow.trace.user\` = '${code}'`,
  );
  assert.deepEqual(requests[0].body.locations, [
    { type: "MLFLOW_EXPERIMENT", mlflow_experiment: { experiment_id: "7" } },
  ]);
  assert.equal(requests[1].body.page_token, "p2");
  assert.deepEqual(requests[2].body, {
    experiment_id: "7",
    request_ids: ["tr-1", "tr-2", "tr-3"],
  });
  await assert.rejects(deleteUserTraces("user-a' OR 1=1", config, transport));
  assert.equal(await deleteUserTraces(code, null, transport), 0);

  const batches = [1000, 1000, 3];
  const expired: Record<string, unknown>[] = [];
  const now = Date.parse("2026-10-03T12:00:00Z");
  const deleted = await deleteOlderThan(
    30,
    config,
    (async (_url: string, init: RequestInit) => {
      expired.push(JSON.parse(String(init.body)));
      return Response.json({ traces_deleted: batches.shift() });
    }) as typeof fetch,
    now,
  );
  assert.equal(deleted, 2003);
  assert.equal(expired.length, 3);
  assert.deepEqual(expired[0], {
    experiment_id: "7",
    max_timestamp_millis: now - 30 * 86400000,
    max_traces: 1000,
  });
});

test("deletion needs only MLflow: the kill switch or a bad capture setting leaves it running", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const admin = (vars: Record<string, string | undefined>) =>
      traceAdminConfig({ ...TRACING, ...vars });
    for (const vars of [
      { TRACING: "off" },
      { TRACING: undefined },
      { TRACING: "everything" },
      { TRACE_SAMPLE_RATE: "2" },
      { NODE_ENV: "production" },
    ]) {
      assert.equal(tracingConfig({ ...TRACING, ...vars }), null);
      assert.deepEqual(
        admin(vars),
        {
          trackingUri: "http://127.0.0.1:5999",
          experimentId: "7",
          userSecret: "test-only-secret",
          retentionDays: 30,
        },
        JSON.stringify(vars),
      );
    }
    // Deletion keeps to the privacy page's 30 days whatever the variable says.
    assert.equal(admin({ TRACE_RETENTION_DAYS: "60" })?.retentionDays, 30);
    assert.equal(admin({ TRACE_RETENTION_DAYS: "7" })?.retentionDays, 7);
    assert.equal(
      admin({ TRACE_USER_SECRET: undefined })?.userSecret,
      undefined,
      "expiry doesn't need the secret",
    );
    assert.equal(admin({ MLFLOW_TRACKING_URI: undefined }), null);
    assert.equal(admin({ MLFLOW_EXPERIMENT_ID: "lift; drop" }), null);
    assert.equal(
      admin({ MLFLOW_TRACKING_URI: "http://user:pass@127.0.0.1:5000" }),
      null,
    );
  } finally {
    warn.mock.restore();
  }
});

test("with TRACING off the janitor still starts and sweeps, and accounts still have their code", async (t) => {
  const { startTraceJanitor, sweepTraces } =
    await import("../lib/tracing/janitor");
  const janitor = Symbol.for("lift.tracing.janitor");
  const shared = globalThis as unknown as Record<symbol, unknown>;
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ traces_deleted: 4 });
    },
  );
  const info = mock.method(console, "info", () => {});
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  t.after(() => {
    mock.timers.reset();
    fetch.mock.restore();
    info.mock.restore();
    delete shared[janitor];
  });
  await withEnv({ ...TRACING, TRACING: "off" }, async () => {
    assert.equal(
      accountTraceCode("user-a"),
      userCode("test-only-secret", "user-a"),
    );
    const before = Date.now();
    await sweepTraces();
    assert.equal(sent.length, 1);
    assert.equal(
      sent[0].url,
      "http://127.0.0.1:5999/api/2.0/mlflow/traces/delete-traces",
    );
    assert.equal(sent[0].body.experiment_id, "7");
    assert.ok(
      Number(sent[0].body.max_timestamp_millis) <= before - 30 * 86400000,
    );
    assert.deepEqual(JSON.parse(String(info.mock.calls[0].arguments[0])), {
      event: "trace_retention",
      deleted: 4,
      days: 30,
    });
    // instrumentation.ts leaves the decision to the janitor.
    assert.equal(startTraceJanitor(), true);
    mock.timers.tick(59999);
    assert.equal(sent.length, 1);
    mock.timers.tick(1);
    assert.equal(sent.length, 2, "the first sweep runs a minute after start");
    for (let i = 0; i < 50 && info.mock.callCount() < 2; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(info.mock.callCount(), 2);
  });
  delete shared[janitor];
  await withEnv(
    { ...TRACING, TRACING: "off", MLFLOW_TRACKING_URI: undefined },
    async () => {
      assert.equal(accountTraceCode("user-a"), null);
      assert.equal(startTraceJanitor(), false, "nothing to sweep");
    },
  );
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (["node_modules", ".next", "artifacts", "ios"].includes(name)) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : [];
  });

test("only lib/tracing loads OpenTelemetry, and only provider.ts at run time", () => {
  const root = join(import.meta.dirname, "..");
  const importsOtel = /(?:from|import|require)\s*\(?\s*["']@opentelemetry\//;
  const files = [
    ...["app", "components", "lib", "scripts", "tests"].flatMap((dir) =>
      sourceFiles(join(root, dir)),
    ),
    ...["instrumentation.ts", "next.config.ts"].map((f) => join(root, f)),
  ];
  for (const file of files) {
    const path = relative(root, file);
    const source = readFileSync(file, "utf8");
    if (path.startsWith("lib/tracing/")) {
      if (path === "lib/tracing/provider.ts") continue;
      // Types only, so with tracing off nothing of OpenTelemetry loads.
      assert.doesNotMatch(
        source,
        /^import (?!type )[^;]*@opentelemetry\//m,
        path,
      );
      assert.doesNotMatch(
        source,
        /^import (?!type )[^;]*"\.\/provider"/m,
        path,
      );
    } else assert.doesNotMatch(source, importsOtel, path);
  }
});
