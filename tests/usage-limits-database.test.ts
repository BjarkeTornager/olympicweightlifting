import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelResponse } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

// Usage limits against seeded ledger rows, Coach messages and voice calls.
// Each test uses its own synthetic accounts, and no request leaves this
// machine.

const tz = "Europe/Copenhagen";
const env = [
  "LIMITS_MODE",
  "OWNER_EMAIL",
  "AGENT_PROVIDER",
  "AGENT_MODEL",
  "OPENROUTER_API_KEY",
  "AGENT_ROUTING",
];

async function setup() {
  assert.ok(
    new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    "Use a disposable database",
  );
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const saved = Object.fromEntries(env.map((key) => [key, process.env[key]]));
  delete process.env.LIMITS_MODE;
  // Turns in these tests use a model passed in, so nothing is routed.
  process.env.AGENT_ROUTING = "off";
  const { getPool } = await import("../lib/db");
  const pool = getPool();
  const users: string[] = [];
  return {
    pool,
    async user() {
      const id = crypto.randomUUID();
      users.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','limits-'||$1||'@example.test',true)",
        [id],
      );
      return id;
    },
    spend(userId: string, at: Date, cost: number, sourceId?: string) {
      return pool.query(
        "INSERT INTO ai_usage(id,user_id,feature,source_id,model,cost_usd,created_at) VALUES ($1,$2,'coach',$3,'test',$4,$5)",
        [crypto.randomUUID(), userId, sourceId ?? null, cost, at],
      );
    },
    message(
      userId: string,
      at: Date,
      { status = "done", question = "Synthetic message", id = "" } = {},
    ) {
      return pool.query(
        "INSERT INTO agent_turns(id,user_id,question,status,created_at) VALUES ($1,$2,$3,$4,$5)",
        [id || crypto.randomUUID(), userId, question, status, at],
      );
    },
    call(userId: string, startedAt: Date, minutes: number) {
      return pool.query(
        "INSERT INTO voice_calls(id,user_id,transcript,content,started_at,updated_at) VALUES ($1,$2,'[]','',$3,$4)",
        [
          crypto.randomUUID(),
          userId,
          startedAt,
          new Date(startedAt.getTime() + minutes * 60000),
        ],
      );
    },
    limit(userId: string, key: string, value: number) {
      return pool.query(
        "INSERT INTO user_limits(user_id,key,value) VALUES ($1,$2,$3) ON CONFLICT (user_id,key) DO UPDATE SET value=excluded.value",
        [userId, key, value],
      );
    },
    // How often each limit was reached, as the owner usage page counts it.
    async counts(userId: string) {
      const { rows } = await pool.query<{ feature: string; n: number }>(
        "SELECT feature, sum(count)::int AS n FROM feature_use WHERE user_id=$1 AND feature LIKE 'limit.%' GROUP BY 1 ORDER BY 1",
        [userId],
      );
      return Object.fromEntries(rows.map((r) => [r.feature, r.n]));
    },
    async status(turnId: string) {
      const { rows } = await pool.query(
        "SELECT status, response FROM agent_turns WHERE id=$1",
        [turnId],
      );
      return rows[0];
    },
    async cleanup() {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [users]);
      for (const [key, value] of Object.entries(saved))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    },
  };
}

// The structured lines the limit checks write.
function captureLimitLogs() {
  const lines: Record<string, unknown>[] = [];
  const info = mock.method(console, "info", (line: unknown) => {
    const parsed =
      typeof line === "string" && line.startsWith("{")
        ? JSON.parse(line)
        : null;
    if (parsed?.event === "usage_limit") lines.push(parsed);
  });
  return { lines, restore: () => info.mock.restore() };
}

const input = (message = "How should I warm up today?") => ({
  id: crypto.randomUUID(),
  message,
  revision: 0,
  timezone: tz,
});

// A model that answers from a script and records what each call cost, as
// the provider layer would (lib/agent/provider.ts).
async function scripted(
  steps: ({ tool: string } | { content: string })[],
  costs: number[],
) {
  const { recordModelCall } = await import("../lib/ai-usage");
  const calls = { count: 0 };
  const model = async (): Promise<ModelResponse> => {
    const i = calls.count++;
    const step = steps[i];
    assert.ok(step, "An unscripted model call");
    await recordModelCall({ model: "fake", costUsd: costs[i] }, "fake");
    return "tool" in step
      ? {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: `call-${i}`, function: { name: step.tool, arguments: {} } },
          ],
        }
      : { role: "assistant", content: step.content };
  };
  return { model, calls };
}
const never = async (): Promise<ModelResponse> => {
  throw Error("A limited turn must not call the model");
};

test(
  "in log mode, an account over a limit is logged and counted once a turn, and Coach still answers",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { runTurn } = await import("../lib/agent/engine");
    const log = captureLimitLogs();
    try {
      const user = await db.user();
      await db.spend(user, new Date(), 1.2);
      const { model, calls } = await scripted(
        [
          { tool: "current_workout" },
          { content: "Five easy minutes on the bike." },
        ],
        [0.001, 0.001],
      );
      const turn = input();
      const response = await runTurn(user, turn, model);
      assert.equal(response.reply, "Five easy minutes on the bike.");
      assert.equal(calls.count, 2);
      assert.equal((await db.status(turn.id)).status, "done");
      // One line for the turn, not one per round, with no content or full id.
      assert.deepEqual(log.lines, [
        {
          event: "usage_limit",
          mode: "log",
          limit: "spend-day-usd",
          check: "turn-start",
          account: user.slice(0, 8),
        },
      ]);
      assert.doesNotMatch(
        JSON.stringify(log.lines),
        new RegExp(`warm up|bike|${user}`),
      );
      assert.deepEqual(await db.counts(user), { "limit.log.spend-day-usd": 1 });
    } finally {
      log.restore();
      await db.cleanup();
    }
  },
);

test(
  "in enforce mode, a turn over a limit is Coach's reply, saved as limited, and calls no model",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { runTurn, history } = await import("../lib/agent/engine"),
      { buildCoach } = await import("../lib/native-api"),
      { LIMIT_REPLIES } = await import("../lib/usage-limits");
    try {
      process.env.LIMITS_MODE = "enforce";
      const user = await db.user();
      await db.spend(user, new Date(), 1.2);
      const turn = input("Plan my week");
      const response = await runTurn(user, turn, never);
      assert.deepEqual(response, {
        reply: LIMIT_REPLIES["spend-day-usd"],
        proposals: [],
      });
      assert.deepEqual(await db.status(turn.id), {
        status: "limited",
        response,
      });
      // The same message again gets the same reply, and isn't counted twice.
      assert.deepEqual(await runTurn(user, turn, never), response);
      assert.deepEqual(await db.counts(user), {
        "limit.enforce.spend-day-usd": 1,
      });
      // Shown in the thread as a reply; the iPhone app sees a finished turn.
      const saved = await history(user);
      assert.equal(saved.length, 1);
      assert.equal(saved[0].status, "limited");
      assert.equal(saved[0].reply, LIMIT_REPLIES["spend-day-usd"]);
      const native = buildCoach(saved).turns[0];
      assert.equal(native.status, "done");
      assert.equal(native.reply, LIMIT_REPLIES["spend-day-usd"]);
      // Nothing new in the ledger.
      const { rows } = await db.pool.query(
        "SELECT count(*)::int AS n FROM ai_usage WHERE user_id=$1",
        [user],
      );
      assert.equal(rows[0].n, 1);
    } finally {
      await db.cleanup();
    }
  },
);

test(
  "the day's messages, spend and voice minutes count from the athlete's local midnight, and the month from the first",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { usageFor, coachLimits, LIMIT_REPLIES } =
      await import("../lib/usage-limits");
    try {
      const user = await db.user(),
        turnId = crypto.randomUUID();
      // 23:30 in Copenhagen, 17:30 in New York, 06:30 the next day in Tokyo.
      const now = new Date("2026-10-03T21:30:00Z");
      const at = (iso: string) => new Date(iso);
      await db.spend(user, at("2026-09-30T21:59:00Z"), 2);
      await db.spend(user, at("2026-10-02T21:59:00Z"), 0.5);
      await db.spend(user, at("2026-10-02T22:01:00Z"), 0.3);
      await db.spend(user, at("2026-10-03T10:00:00Z"), 0.05, turnId);
      await db.spend(user, at("2026-10-03T16:00:00Z"), 0.2);
      await db.message(user, at("2026-10-02T21:59:00Z"));
      await db.message(user, at("2026-10-03T10:00:00Z"));
      // Refused by a limit, or saved from a voice call: not Coach messages.
      await db.message(user, at("2026-10-03T11:00:00Z"), {
        status: "limited",
      });
      await db.message(user, at("2026-10-03T12:00:00Z"), {
        question: "[voice] Logged 500 ml of water",
      });
      await db.message(user, at("2026-10-03T16:00:00Z"));
      // The message being checked doesn't count itself.
      await db.message(user, at("2026-10-03T21:00:00Z"), { id: turnId });
      await db.call(user, at("2026-10-02T21:00:00Z"), 50);
      await db.call(user, at("2026-10-03T09:00:00Z"), 20);
      // Counted up to the 30-minute cap on a call.
      await db.call(user, at("2026-10-03T17:00:00Z"), 45);

      assert.deepEqual(await usageFor(user, "Europe/Copenhagen", turnId, now), {
        "coach-messages-day": 2,
        "spend-day-usd": 0.55,
        "spend-month-usd": 1.05,
        "spend-turn-usd": 0.05,
        "voice-minutes-day": 50,
      });
      assert.deepEqual(await usageFor(user, "America/New_York", turnId, now), {
        "coach-messages-day": 2,
        "spend-day-usd": 0.25,
        "spend-month-usd": 1.05,
        "spend-turn-usd": 0.05,
        "voice-minutes-day": 50,
      });
      assert.deepEqual(await usageFor(user, "Asia/Tokyo", turnId, now), {
        "coach-messages-day": 1,
        "spend-day-usd": 0.2,
        "spend-month-usd": 3.05,
        "spend-turn-usd": 0.05,
        "voice-minutes-day": 30,
      });
      // Half an hour later it's a new day in Copenhagen.
      const midnight = await usageFor(
        user,
        "Europe/Copenhagen",
        turnId,
        at("2026-10-03T22:00:00Z"),
      );
      assert.equal(midnight["coach-messages-day"], 0);
      assert.equal(midnight["spend-day-usd"], 0);
      assert.equal(midnight["spend-month-usd"], 1.05);

      // With two messages a day, the third is refused where it's still the
      // same day, and allowed where a new day has begun.
      process.env.LIMITS_MODE = "enforce";
      await db.limit(user, "coach-messages-day", 2);
      const check = (timezone: string) =>
        coachLimits(user, { id: turnId, timezone, provider: false }).start(now);
      assert.equal(
        await check("Europe/Copenhagen"),
        LIMIT_REPLIES["coach-messages-day"],
      );
      assert.equal(await check("Asia/Tokyo"), undefined);
    } finally {
      await db.cleanup();
    }
  },
);

test(
  "an account's own limits replace the defaults; the owner has higher caps and is still recorded",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { coachLimits, LIMIT_REPLIES } = await import("../lib/usage-limits"),
      { runTurn } = await import("../lib/agent/engine");
    try {
      process.env.LIMITS_MODE = "enforce";
      const [a, b, owner] = [await db.user(), await db.user(), await db.user()];
      process.env.OWNER_EMAIL = `limits-${owner}@example.test`;
      for (const id of [a, b, owner]) await db.spend(id, new Date(), 2);
      const start = (userId: string) =>
        coachLimits(userId, {
          id: crypto.randomUUID(),
          timezone: tz,
          provider: false,
        }).start();
      // $2 today is over everyone's $1.
      assert.equal(await start(a), LIMIT_REPLIES["spend-day-usd"]);
      // An account allowed $5 a day goes on.
      await db.limit(b, "spend-day-usd", 5);
      assert.equal(await start(b), undefined);
      // The owner's cap is higher, and the owner's turns are still recorded.
      assert.equal(await start(owner), undefined);
      const { model } = await scripted([{ content: "Noted." }], [0.01]);
      const turn = input();
      assert.equal((await runTurn(owner, turn, model)).reply, "Noted.");
      const { rows } = await db.pool.query(
        "SELECT feature, cost_usd::float8 AS cost FROM ai_usage WHERE user_id=$1 AND source_id=$2",
        [owner, turn.id],
      );
      assert.deepEqual(rows, [{ feature: "coach", cost: 0.01 }]);
      // An owner's own value replaces the owner's cap too.
      await db.limit(owner, "spend-day-usd", 1.5);
      assert.equal(await start(owner), LIMIT_REPLIES["spend-day-usd"]);
      assert.deepEqual(await db.counts(owner), {
        "limit.enforce.spend-day-usd": 1,
      });
      // Deleted with the account.
      await db.pool.query("DELETE FROM users WHERE id=$1", [b]);
      const { rows: left } = await db.pool.query(
        "SELECT count(*)::int AS n FROM user_limits WHERE user_id=$1",
        [b],
      );
      assert.equal(left[0].n, 0);
    } finally {
      await db.cleanup();
    }
  },
);

test(
  "a turn's spend is checked between rounds, and over it the turn finishes with what it has",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { runTurn } = await import("../lib/agent/engine"),
      { LIMIT_REPLIES } = await import("../lib/usage-limits");
    const log = captureLimitLogs();
    const steps = [
      { tool: "current_workout" },
      { tool: "current_workout" },
      { content: "All done." },
    ];
    const costs = [0.2, 0.1, 0.01];
    try {
      // Logged only: every round runs.
      const logged = await db.user(),
        first = await scripted(steps, costs);
      const answered = await runTurn(logged, input(), first.model);
      assert.equal(first.calls.count, 3);
      assert.equal(answered.reply, "All done.");
      assert.deepEqual(
        log.lines.map((l) => [l.mode, l.limit, l.check]),
        [["log", "spend-turn-usd", "round"]],
      );

      // Enforced: $0.30 after two rounds is over $0.25, so no third.
      process.env.LIMITS_MODE = "enforce";
      const limited = await db.user(),
        second = await scripted(steps, costs),
        turn = input();
      const response = await runTurn(limited, turn, second.model);
      assert.equal(second.calls.count, 2);
      assert.equal(response.reply, LIMIT_REPLIES["spend-turn-usd"]);
      assert.equal((await db.status(turn.id)).status, "done");
      assert.deepEqual(await db.counts(limited), {
        "limit.enforce.spend-turn-usd": 1,
      });
    } finally {
      log.restore();
      await db.cleanup();
    }
  },
);

test(
  "when the provider's key has run out, Coach is paused for everyone before the turn starts",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { runTurn } = await import("../lib/agent/engine"),
      { coachLimits, LIMIT_REPLIES } = await import("../lib/usage-limits");
    Object.assign(process.env, {
      AGENT_PROVIDER: "openrouter",
      AGENT_MODEL: "openai/gpt-5.6-luna",
      // Its own key, so no earlier budget answer is reused.
      OPENROUTER_API_KEY: `test-limits-${crypto.randomUUID()}`,
    });
    const requests: string[] = [];
    const fetch = mock.method(
      globalThis,
      "fetch",
      async (url: string | URL) => {
        requests.push(String(url));
        if (String(url) === "https://openrouter.ai/api/v1/key")
          return Response.json({ data: { limit: 50, limit_remaining: 0 } });
        throw Error(`Unexpected request to ${url}`);
      },
    );
    const log = captureLimitLogs();
    try {
      const user = await db.user();
      // Logged only: the turn would go ahead.
      assert.equal(
        await coachLimits(user, {
          id: crypto.randomUUID(),
          timezone: tz,
          provider: true,
        }).start(),
        undefined,
      );
      assert.deepEqual(
        log.lines.map((l) => [l.mode, l.limit]),
        [["log", "provider"]],
      );
      // Enforced: Coach says so instead of failing with a 402 mid-turn.
      process.env.LIMITS_MODE = "enforce";
      const turn = input();
      const response = await runTurn(user, turn);
      assert.equal(response.reply, LIMIT_REPLIES.provider);
      assert.equal((await db.status(turn.id)).status, "limited");
      assert.ok(
        requests.every((url) => url === "https://openrouter.ai/api/v1/key"),
      );
    } finally {
      log.restore();
      fetch.mock.restore();
      await db.cleanup();
    }
  },
);

test(
  "voice minutes are checked when a call starts and every time it resumes",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { voiceLimit, LIMIT_REPLIES } = await import("../lib/usage-limits");
    const log = captureLimitLogs();
    try {
      const user = await db.user(),
        now = new Date("2026-10-03T12:00:00Z");
      await db.call(user, new Date("2026-10-03T07:00:00Z"), 30);
      await db.call(user, new Date("2026-10-03T09:00:00Z"), 29);
      process.env.LIMITS_MODE = "enforce";
      // 59 minutes: one more call may start.
      assert.equal(await voiceLimit(user, tz, "voice-start", now), undefined);
      assert.equal(log.lines.length, 0);
      await db.call(user, new Date("2026-10-03T11:00:00Z"), 1);
      assert.equal(
        await voiceLimit(user, tz, "voice-start", now),
        LIMIT_REPLIES["voice-minutes-day"],
      );
      assert.equal(
        await voiceLimit(user, tz, "voice-resume", now),
        LIMIT_REPLIES["voice-minutes-day"],
      );
      // Logged only: the call goes ahead.
      delete process.env.LIMITS_MODE;
      assert.equal(await voiceLimit(user, tz, "voice-resume", now), undefined);
      assert.deepEqual(
        log.lines.map((l) => [l.mode, l.limit, l.check]),
        [
          ["enforce", "voice-minutes-day", "voice-start"],
          ["enforce", "voice-minutes-day", "voice-resume"],
          ["log", "voice-minutes-day", "voice-resume"],
        ],
      );
      assert.deepEqual(await db.counts(user), {
        "limit.enforce.voice-minutes-day": 2,
        "limit.log.voice-minutes-day": 1,
      });
      // An account allowed more minutes goes on.
      process.env.LIMITS_MODE = "enforce";
      await db.limit(user, "voice-minutes-day", 90);
      assert.equal(await voiceLimit(user, tz, "voice-start", now), undefined);
    } finally {
      log.restore();
      await db.cleanup();
    }
  },
);

test(
  "Train, Food, Health and the iPhone's outbox are never refused, even with every limit at zero",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { runTurn } = await import("../lib/agent/engine"),
      { voiceLimit, DEFAULT_CAPS } = await import("../lib/usage-limits"),
      { readJournal, writeJournal } = await import("../lib/server"),
      { prepareAction } = await import("../lib/agent/actions"),
      { applyNativeAction } = await import("../lib/native-actions"),
      { syncHealth } = await import("../lib/health-sync");
    try {
      process.env.LIMITS_MODE = "enforce";
      const user = await db.user();
      for (const key of Object.keys(DEFAULT_CAPS)) await db.limit(user, key, 0);
      await db.spend(user, new Date(), 50);
      // Coach and voice are refused...
      assert.match(
        (await runTurn(user, input(), never)).reply,
        /Logging in Train and Food still works\./,
      );
      assert.ok(await voiceLimit(user, tz, "voice-start"));
      const counted = await db.counts(user);

      // ...while a session and a meal logged by hand are saved,
      const date = "2026-10-01";
      let snapshot = await readJournal(user);
      const session = prepareAction(
        snapshot.state,
        {
          kind: "record_session",
          workout: {
            title: "Accessory training",
            date,
            category: "accessories",
            exercises: [
              {
                exerciseId: "strict_press",
                sets: [{ weight: 40, reps: 8, result: "success" }],
              },
            ],
          },
        },
        date,
      );
      await writeJournal(user, {
        state: session.state,
        revision: snapshot.revision,
        mutationId: crypto.randomUUID(),
      });
      snapshot = await readJournal(user);
      const meal = prepareAction(
        snapshot.state,
        {
          kind: "record_meal",
          meal: {
            date,
            name: "Lunch",
            type: "lunch",
            source: "manual",
            estimated: false,
            items: [
              {
                name: "Rice",
                portion: "200 g cooked",
                calories: 260,
                protein: 5,
                carbs: 56,
                fat: 1,
              },
            ],
          },
        },
        date,
      );
      await writeJournal(user, {
        state: meal.state,
        revision: snapshot.revision,
        mutationId: crypto.randomUUID(),
      });
      // a save queued offline on the iPhone is applied,
      const drink = await applyNativeAction(user, {
        id: crypto.randomUUID(),
        timezone: tz,
        action: { kind: "log_drink", drink: { date, ml: 500, kind: "water" } },
      });
      assert.equal(drink.status, "saved");
      // and Apple Health syncs.
      const health = await syncHealth(user, {
        timezone: tz,
        sleep: [
          {
            date,
            samples: [
              {
                start: "2026-09-30T23:00:00+02:00",
                end: "2026-10-01T07:00:00+02:00",
                value: "core",
              },
            ],
          },
        ],
      });
      assert.deepEqual(
        health.sleep.map((s) => s.result),
        ["imported"],
      );
      const { state } = await readJournal(user);
      assert.equal(state.sessions.length, 1);
      assert.equal(state.nutrition.meals.length, 1);
      assert.equal(state.health.drinks?.length, 1);
      assert.equal(state.health.checkins[0].sleepHours, 8);
      // None of them met a limit.
      assert.deepEqual(await db.counts(user), counted);
    } finally {
      await db.cleanup();
    }
  },
);

test(
  "a check that fails lets the work go ahead",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await setup();
    const { coachLimits, voiceLimit } = await import("../lib/usage-limits");
    const warn = mock.method(console, "warn", () => {});
    try {
      process.env.LIMITS_MODE = "enforce";
      const user = await db.user();
      await db.limit(user, "voice-minutes-day", 0);
      await db.limit(user, "coach-messages-day", 0);
      // A time zone this server can't read.
      const limits = coachLimits(user, {
        id: crypto.randomUUID(),
        timezone: "Mars/Olympus_Mons",
        provider: false,
      });
      assert.equal(await limits.start(), undefined);
      assert.equal(await limits.round(), undefined);
      assert.equal(
        await voiceLimit(user, "Mars/Olympus_Mons", "voice-start"),
        undefined,
      );
      const lines = warn.mock.calls.map((c) =>
        JSON.parse(String(c.arguments[0])),
      );
      assert.deepEqual(
        lines.map((l) => [l.event, l.check]),
        [
          ["usage_limit_failed", "turn-start"],
          ["usage_limit_failed", "round"],
          ["usage_limit_failed", "voice-start"],
        ],
      );
    } finally {
      warn.mock.restore();
      await db.cleanup();
    }
  },
);
