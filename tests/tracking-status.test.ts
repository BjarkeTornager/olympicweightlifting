import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { budgetState, trackingNotices } from "../lib/tracking-status";
import { providerBudget, providerBudgetSoon } from "../lib/provider-budget";

test("tracking status reports failures without treating unknown quota as available", () => {
  assert.equal(budgetState({ limit_remaining: null }), "ok");
  assert.equal(budgetState({ limit: 10, limit_remaining: 1 }), "low");
  assert.equal(budgetState({ limit: 10, limit_remaining: 2 }), "ok");
  assert.equal(budgetState({ limit_remaining: 0 }), "exhausted");
  for (const value of [
    null,
    {},
    { limit_remaining: "0" },
    { limit_remaining: NaN },
  ])
    assert.equal(budgetState(value), "unknown");
  assert.deepEqual(
    trackingNotices({ remindersConfigured: true, budget: "unknown" }),
    [],
  );
  assert.deepEqual(
    trackingNotices({
      health: { last_result: "failed" },
      reminder: { enabled: false, last_status: "expired" },
      remindersConfigured: true,
      budget: "exhausted",
    }).map((n) => n.code),
    ["sleep_failed", "reminder_expired", "ai_exhausted"],
  );
  assert.deepEqual(
    trackingNotices({
      reminder: { enabled: false, last_status: "failed" },
      remindersConfigured: false,
      budget: "ok",
    }),
    [],
  );
  assert.equal(
    trackingNotices({
      reminder: { enabled: true, last_status: "sent" },
      remindersConfigured: false,
      budget: "low",
    }).length,
    2,
  );
});

test("quota checks share a cached read and fail quietly without disclosing provider data", async () => {
  const previous = {
    provider: process.env.AGENT_PROVIDER,
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.AGENT_MODEL,
  };
  Object.assign(process.env, {
    AGENT_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "synthetic-quota-test",
    AGENT_MODEL: "synthetic",
  });
  let calls = 0;
  const fetch = mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, "https://openrouter.ai/api/v1/key");
    calls++;
    return Response.json({
      data: { limit: 10, limit_remaining: 0 },
      secret: "never-return-this",
    });
  });
  try {
    assert.deepEqual(await Promise.all([providerBudget(), providerBudget()]), [
      "exhausted",
      "exhausted",
    ]);
    assert.equal(calls, 1);
    process.env.OPENROUTER_API_KEY = "synthetic-second-key";
    fetch.mock.mockImplementation(async () => {
      throw Error("provider unavailable");
    });
    assert.equal(await providerBudget(), "unknown");
  } finally {
    fetch.mock.restore();
    for (const [key, value] of Object.entries({
      AGENT_PROVIDER: previous.provider,
      OPENROUTER_API_KEY: previous.key,
      AGENT_MODEL: previous.model,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("a Coach turn never waits on OpenRouter for the budget once one has been read", async () => {
  const previous = {
    AGENT_PROVIDER: process.env.AGENT_PROVIDER,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    AGENT_MODEL: process.env.AGENT_MODEL,
  };
  Object.assign(process.env, {
    AGENT_PROVIDER: "openrouter",
    // Its own key, so no earlier read is reused.
    OPENROUTER_API_KEY: `synthetic-soon-${crypto.randomUUID()}`,
    AGENT_MODEL: "synthetic",
  });
  // OpenRouter answers only when told to.
  const answers: ((remaining: number) => void)[] = [];
  const fetch = mock.method(globalThis, "fetch", async () => {
    const remaining = await new Promise<number>((resolve) =>
      answers.push(resolve),
    );
    return Response.json({ data: { limit: 10, limit_remaining: remaining } });
  });
  const timed = async (waitMs: number) => {
    const started = performance.now();
    const state = await providerBudgetSoon(waitMs);
    return { state, ms: performance.now() - started };
  };
  try {
    // Nothing read yet: it waits only briefly, then goes on.
    const first = await timed(50);
    assert.equal(first.state, "unknown");
    assert.ok(first.ms < 1000);
    answers[0](0);
    await new Promise((resolve) => setImmediate(resolve));
    // Read once: answered at once, with no new request.
    assert.equal((await timed(5000)).state, "exhausted");
    assert.ok((await timed(5000)).ms < 1000);
    assert.equal(fetch.mock.callCount(), 1);
    // Five minutes on, the last state answers while a newer one is fetched.
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 300001 });
    const stale = await timed(5000);
    assert.equal(stale.state, "exhausted");
    assert.ok(stale.ms < 1000);
    assert.equal(fetch.mock.callCount(), 2);
    answers[1](5);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await timed(5000)).state, "ok");
  } finally {
    mock.timers.reset();
    fetch.mock.restore();
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
