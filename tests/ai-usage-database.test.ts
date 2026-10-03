import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// The AI cost ledger, against a fake OpenRouter, Jev and Exa: no request
// leaves this machine, and each test uses its own synthetic accounts.

type Scripted =
  | {
      content?: string;
      tool?: { name: string; arguments: Record<string, unknown> };
      cost: number;
      filtered?: boolean;
    }
  | { status: number };

const usage = (cost: number) => ({
  prompt_tokens: Math.round(cost * 1e6),
  completion_tokens: 20,
  prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  cost,
});

// The reply OpenRouter would send for one scripted call, streamed when the
// request asks for a stream.
function openRouterReply(
  body: { model: string; stream?: boolean },
  step: Scripted,
) {
  if ("status" in step) return new Response("{}", { status: step.status });
  const finish = step.filtered
    ? "content_filter"
    : step.tool
      ? "tool_calls"
      : "stop";
  const toolCalls = step.tool
    ? [
        {
          id: `call-${crypto.randomUUID()}`,
          function: {
            name: step.tool.name,
            arguments: JSON.stringify(step.tool.arguments),
          },
        },
      ]
    : undefined;
  if (!body.stream)
    return Response.json({
      model: body.model,
      usage: usage(step.cost),
      choices: [
        {
          finish_reason: finish,
          message: {
            role: "assistant",
            content: step.content ?? "",
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
          },
        },
      ],
    });
  const frames = [
    {
      model: body.model,
      choices: [
        {
          delta: {
            content: step.content ?? "",
            ...(toolCalls
              ? {
                  tool_calls: toolCalls.map((call, index) => ({
                    index,
                    ...call,
                  })),
                }
              : {}),
          },
          finish_reason: finish,
        },
      ],
    },
    { model: body.model, choices: [], usage: usage(step.cost) },
  ];
  return new Response(
    frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") +
      "data: [DONE]\n\n",
  );
}

const jevReply = {
  model: "jev-1.13.0",
  answers: {
    work_kind: {
      type: "choice",
      choice: "explain",
      probabilities: { explain: 0.95, log: 0.05 },
      confidence: 0.95,
    },
    difficulty: {
      type: "score",
      score: 0,
      confidence: 0.9,
      probabilities: { "0": 0.9, "1": 0.08, "2": 0.02 },
    },
    mutation_stakes: { type: "noul", noul: 0.05 },
  },
};

// Answers every outside request from a script; anything unexpected fails.
function fakeProviders(script: Scripted[]) {
  const models: string[] = [];
  const fetch = mock.method(
    globalThis,
    "fetch",
    async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.typesafe.ai/v1/systemone")
        return Response.json(jevReply);
      if (href === "https://api.exa.ai/search")
        return Response.json({
          results: [
            {
              title: "Label",
              url: "https://example.test/label",
              text: "Creatine monohydrate, nothing else.",
            },
          ],
        });
      if (href === "https://openrouter.ai/api/v1/chat/completions") {
        const body = JSON.parse(String(init?.body));
        models.push(body.model);
        const step = script.shift();
        assert.ok(step, "An unscripted model call");
        return openRouterReply(body, step);
      }
      throw Error(`Unexpected request to ${href}`);
    },
  );
  return { models, restore: () => fetch.mock.restore() };
}

const env = {
  AGENT_PROVIDER: "openrouter",
  AGENT_MODEL: "openai/gpt-5.6-luna",
  OPENROUTER_API_KEY: "test-key",
  AGENT_ROUTING: "jev",
  TYPESAFE_API_KEY: "test-typesafe",
  EXA_API_KEY: "test-exa",
};

async function setup() {
  assert.ok(
    new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    "Use a disposable database",
  );
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const saved = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  const { getPool } = await import("../lib/db");
  const pool = getPool();
  const users: string[] = [];
  return {
    pool,
    async user() {
      const id = crypto.randomUUID();
      users.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','ledger-'||$1||'@example.test',true)",
        [id],
      );
      return id;
    },
    async rows(userId: string) {
      const { rows } = await pool.query<{
        feature: string;
        sourceId: string | null;
        model: string;
        inputTokens: number | null;
        outputTokens: number | null;
        cost: number;
        estimated: boolean;
      }>(
        `SELECT feature, source_id AS "sourceId", model, input_tokens AS "inputTokens",
          output_tokens AS "outputTokens", cost_usd::float8 AS cost, estimated
        FROM ai_usage WHERE user_id=$1 ORDER BY created_at`,
        [userId],
      );
      return rows;
    },
    async cleanup() {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [users]);
      for (const [key, value] of Object.entries(saved))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    },
  };
}

const total = (rows: { cost: number }[]) =>
  Math.round(rows.reduce((n, r) => n + r.cost, 0) * 1e6) / 1e6;

test(
  "a Coach turn records one row per model call, plus routing and search, and its totals match the turn's metrics",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { runTurn } = await import("../lib/agent/engine"),
      { turnTotals } = await import("../lib/agent/turn-metrics"),
      { aiPrices } = await import("../lib/ai-usage");
    const fake = fakeProviders([
      {
        tool: { name: "search_web", arguments: { query: "creatine label" } },
        cost: 0.0011,
      },
      { tool: { name: "current_workout", arguments: {} }, cost: 0.0012 },
      { content: "Plain creatine monohydrate.", cost: 0.0013 },
    ]);
    try {
      const user = await db.user(),
        id = crypto.randomUUID();
      const response = await runTurn(
        user,
        {
          id,
          message: "Secret question: does my creatine have additives?",
          revision: 0,
          timezone: "Europe/Copenhagen",
        },
        undefined,
        { emit: () => {} },
      );
      assert.equal(response.reply, "Plain creatine monohydrate.");
      assert.equal(fake.models.length, 3);
      const rows = await db.rows(user);
      assert.ok(rows.every((r) => r.sourceId === id && !r.estimated));
      const coach = rows.filter((r) => r.feature === "coach");
      assert.equal(coach.length, 3);
      assert.ok(coach.every((r) => r.model === "openai/gpt-5.6-luna"));
      assert.deepEqual(
        rows.filter((r) => r.feature !== "coach"),
        [
          {
            feature: "routing",
            sourceId: id,
            model: "jev-1.13.0",
            inputTokens: null,
            outputTokens: null,
            cost: aiPrices().jevRequest,
            estimated: false,
          },
          {
            feature: "web-search",
            sourceId: id,
            model: "exa-search",
            inputTokens: null,
            outputTokens: null,
            cost: aiPrices().exaSearch,
            estimated: false,
          },
        ],
      );
      // The model rounds in the ledger are the rounds in the turn's metrics.
      const { rows: turns } = await db.pool.query(
        "SELECT metrics FROM agent_turns WHERE id=$1",
        [id],
      );
      const totals = turnTotals(turns[0].metrics);
      assert.equal(totals.rounds, coach.length);
      assert.equal(total(coach), totals.costUsd);
      assert.equal(total(coach), 0.0036);
      assert.equal(
        coach.reduce((n, r) => n + r.inputTokens!, 0),
        totals.inputTokens,
      );
      assert.equal(
        coach.reduce((n, r) => n + r.outputTokens!, 0),
        totals.outputTokens,
      );
      // Counts, models and costs only.
      assert.doesNotMatch(JSON.stringify(rows), /Secret|creatine|additives/i);
    } finally {
      fake.restore();
      await db.cleanup();
    }
  },
);

test(
  "a retried call or turn is billed again, so it writes another row",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { runTurn } = await import("../lib/agent/engine"),
      { FILTER_FALLBACK_MODEL } = await import("../lib/agent/provider");
    try {
      // The host's filter blocks a reply, and the fallback model answers.
      const user = await db.user(),
        filteredId = crypto.randomUUID();
      let fake = fakeProviders([
        { content: "I can't help with that.", cost: 0.0004, filtered: true },
        { content: "Three light doubles.", cost: 0.0006 },
      ]);
      try {
        await runTurn(user, {
          id: filteredId,
          message: "How many sets when I'm tired?",
          revision: 0,
          timezone: "Europe/Copenhagen",
        });
      } finally {
        fake.restore();
      }
      assert.deepEqual(fake.models, [
        "openai/gpt-5.6-luna",
        FILTER_FALLBACK_MODEL,
      ]);
      const filtered = (await db.rows(user)).filter(
        (r) => r.sourceId === filteredId && r.feature === "coach",
      );
      assert.deepEqual(
        filtered.map((r) => [r.model, r.cost]),
        [
          ["openai/gpt-5.6-luna", 0.0004],
          [FILTER_FALLBACK_MODEL, 0.0006],
        ],
      );

      // A turn fails in its second round, and the athlete retries it.
      const id = crypto.randomUUID();
      const input = {
        id,
        message: "Is there a workout in progress?",
        revision: 0,
        timezone: "Europe/Copenhagen",
      };
      fake = fakeProviders([
        { tool: { name: "current_workout", arguments: {} }, cost: 0.001 },
        { status: 503 },
      ]);
      try {
        await assert.rejects(runTurn(user, input), /unavailable/);
      } finally {
        fake.restore();
      }
      fake = fakeProviders([
        { tool: { name: "current_workout", arguments: {} }, cost: 0.001 },
        { content: "No workout in progress.", cost: 0.002 },
      ]);
      try {
        assert.equal(
          (await runTurn(user, input)).reply,
          "No workout in progress.",
        );
      } finally {
        fake.restore();
      }
      const retried = (await db.rows(user)).filter((r) => r.sourceId === id);
      // The first round ran twice and was billed twice; the failed request
      // was not billed.
      assert.deepEqual(
        retried.filter((r) => r.feature === "coach").map((r) => r.cost),
        [0.001, 0.001, 0.002],
      );
      assert.equal(retried.filter((r) => r.feature === "routing").length, 2);
      const { rows: turns } = await db.pool.query(
        "SELECT status, metrics FROM agent_turns WHERE id=$1",
        [id],
      );
      // The turn's metrics describe the attempt that finished; the ledger
      // keeps every call that was paid for.
      assert.equal(turns[0].status, "done");
      assert.equal(turns[0].metrics.rounds.length, 2);
    } finally {
      await db.cleanup();
    }
  },
);

test(
  "image tagging and transcript tidying are charged to their image and call, and a call outside any account is not recorded",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { callModel } = await import("../lib/agent/provider"),
      { tagUserImage } = await import("../lib/user-images"),
      { saveVoiceTranscript, tidyVoiceCall } =
        await import("../lib/conversation-memory");
    const fake = fakeProviders([
      { content: "Outside any account.", cost: 0.424242 },
      {
        tool: {
          name: "classify_image",
          arguments: { category: "food", confidence: "high", tags: ["meal"] },
        },
        cost: 0.0002,
      },
      { content: '{"lines":["Hello there."]}', cost: 0.0003 },
    ]);
    try {
      const user = await db.user(),
        image = crypto.randomUUID(),
        call = crypto.randomUUID();
      await callModel(
        [{ role: "user", content: "Hi" }],
        [],
        AbortSignal.timeout(5000),
      );
      await db.pool.query(
        "INSERT INTO food_photos(user_id,id,label,meal_date,bytes,digest,data) VALUES ($1,$2,'Lunch','2026-10-03',3,'test',$3)",
        [user, image, Buffer.from([1, 2, 3])],
      );
      await tagUserImage(user, image, 0);
      await saveVoiceTranscript(user, {
        id: call,
        purpose: "checkin",
        entries: [{ role: "you", text: "hello there" }],
      });
      await tidyVoiceCall(user, call);
      const rows = await db.rows(user);
      assert.deepEqual(
        rows.map((r) => [r.feature, r.sourceId, r.model, r.cost]),
        [
          ["image-tag", image, "openai/gpt-5.6-luna", 0.0002],
          ["transcript-tidy", call, "openai/gpt-5.6-luna", 0.0003],
        ],
      );
      const { rows: stray } = await db.pool.query(
        "SELECT count(*)::int AS n FROM ai_usage WHERE cost_usd = 0.424242",
      );
      assert.equal(stray[0].n, 0);
    } finally {
      fake.restore();
      await db.cleanup();
    }
  },
);

test(
  "voice calls are estimated from their minutes, per connection",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { recordVoiceStart, recordVoiceEnd, aiPrices } =
        await import("../lib/ai-usage"),
      { saveVoiceTranscript } = await import("../lib/conversation-memory");
    try {
      const user = await db.user(),
        minute = 60000,
        start = Date.now() - 3 * 60 * minute;
      const call = async (id: string, startedAt: number) => {
        await saveVoiceTranscript(user, {
          id,
          purpose: "checkin",
          entries: [{ role: "coach", text: "Secret greeting" }],
        });
        await db.pool.query(
          "UPDATE voice_calls SET started_at=$2 WHERE id=$1",
          [id, new Date(startedAt)],
        );
      };
      // A connection that never became a call, long before.
      await recordVoiceStart(
        user,
        "google",
        "gemini-live",
        new Date(start - 60 * minute),
      );
      // A call that reconnected once, after four minutes.
      const first = crypto.randomUUID();
      await recordVoiceStart(
        user,
        "elevenlabs",
        "eleven_v4_turbo",
        new Date(start),
      );
      await recordVoiceStart(
        user,
        "elevenlabs",
        "eleven_v4_turbo",
        new Date(start + 4 * minute),
      );
      await call(first, start + 10_000);
      await recordVoiceEnd(user, first, new Date(start + 10 * minute));
      // Ending it again changes nothing.
      await recordVoiceEnd(user, first, new Date(start + 20 * minute));
      // A call whose end arrived long after the phone's 30-minute cap.
      const second = crypto.randomUUID();
      await recordVoiceStart(
        user,
        "google",
        "gemini-live",
        new Date(start + 60 * minute),
      );
      await call(second, start + 60 * minute + 5000);
      await recordVoiceEnd(user, second, new Date(start + 150 * minute));

      const rows = await db.rows(user);
      const rate = aiPrices();
      assert.deepEqual(
        rows.map((r) => [r.feature, r.sourceId, r.cost, r.estimated]),
        [
          ["voice-gemini", null, 0, true],
          [
            "voice-elevenlabs",
            first,
            Math.round(4 * rate.elevenLabsVoiceMinute * 1e6) / 1e6,
            true,
          ],
          [
            "voice-elevenlabs",
            first,
            Math.round(6 * rate.elevenLabsVoiceMinute * 1e6) / 1e6,
            true,
          ],
          [
            "voice-gemini",
            second,
            Math.round(30 * rate.geminiVoiceMinute * 1e6) / 1e6,
            true,
          ],
        ],
      );
      assert.doesNotMatch(JSON.stringify(rows), /Secret/);
    } finally {
      await db.cleanup();
    }
  },
);

test(
  "an account's ledger is deleted with it",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { withAiUsage, recordFixedPrice } = await import("../lib/ai-usage");
    try {
      const user = await db.user();
      await withAiUsage({ userId: user, feature: "coach" }, () =>
        recordFixedPrice("web-search", "exa-search", 0.01),
      );
      assert.equal((await db.rows(user)).length, 1);
      await db.pool.query("DELETE FROM users WHERE id=$1", [user]);
      const { rows } = await db.pool.query(
        "SELECT count(*)::int AS n FROM ai_usage WHERE user_id=$1",
        [user],
      );
      assert.equal(rows[0].n, 0);
      const { rows: indexes } = await db.pool.query(
        "SELECT indexdef FROM pg_indexes WHERE indexname='ai_usage_user_date_idx'",
      );
      assert.match(indexes[0].indexdef, /\(user_id, created_at\)/);
    } finally {
      await db.cleanup();
    }
  },
);
