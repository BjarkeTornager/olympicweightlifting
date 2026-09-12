// Opt-in real-provider verification using a disposable account and synthetic check-ins.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
config({ path: ".env.local", quiet: true });
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw Error("Disposable _test database required.");
if (
  process.env.AGENT_PROVIDER === "openrouter" &&
  !process.env.OPENROUTER_API_KEY
)
  process.env.OPENROUTER_API_KEY = (
    await readFile(
      join(homedir(), ".config/lift-journal/openrouter.key"),
      "utf8",
    )
  ).trim();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getPool } = await import("../lib/db"),
  { runTurn, applyProposal, athleteDate } = await import("../lib/agent/engine"),
  { callModel } = await import("../lib/agent/provider"),
  { readJournal } = await import("../lib/server");
const userId = crypto.randomUUID(),
  pool = getPool(),
  timezone = "Europe/Copenhagen",
  date = athleteDate(timezone),
  calls: string[] = [];
const model: typeof callModel = async (...args) => {
  const response = await callModel(...args);
  calls.push(...(response.tool_calls?.map((c) => c.function.name) ?? []));
  return response;
};
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic health test','health-smoke-'||$1||'@example.test',true)",
  [userId],
);
try {
  const response = await runTurn(
    userId,
    {
      id: crypto.randomUUID(),
      revision: 0,
      timezone,
      message: `Log my check-in for ${date}: I slept 6.5 hours last night, energy 2 out of 5, muscle soreness 4 out of 5, bodyweight 80 kg, and 500 ml water total so far today.`,
    },
    model,
  );
  assert.ok(calls.includes("health_overview"));
  assert.equal(response.proposals.length, 1, response.reply);
  const c = response.proposals[0].checkin!;
  assert.equal(c.sleepHours, 6.5);
  assert.equal(c.energy, 2);
  assert.equal(c.soreness, 4);
  assert.equal(c.waterMl, 500);
  assert.equal(c.bodyweight, 80);
  assert.equal((await readJournal(userId)).state.health.checkins.length, 0);
  await applyProposal(userId, response.proposals[0].id);
  calls.length = 0;
  const updated = await runTurn(
    userId,
    {
      id: crypto.randomUUID(),
      revision: 1,
      timezone,
      message:
        "Log another 250 ml of water today. Keep my other check-in values.",
    },
    model,
  );
  assert.equal(updated.proposals.length, 1, updated.reply);
  assert.equal(updated.proposals[0].checkin?.waterMl, 750);
  assert.equal(updated.proposals[0].checkin?.sleepHours, 6.5);
  await applyProposal(userId, updated.proposals[0].id);
  calls.length = 0;
  const plan = await runTurn(
    userId,
    {
      id: crypto.randomUUID(),
      revision: 2,
      timezone,
      message:
        "Read my health overview and help me decide what to do today. Give me no more than three practical priorities based on what I logged, explain the evidence and missing information, and don't change my records.",
    },
    model,
  );
  assert.ok(calls.includes("health_overview"));
  assert.equal(plan.proposals.length, 0);
  assert.equal((await readJournal(userId)).revision, 2);
  assert.match(plan.reply, /recover|rest|easy|gentle|lighter/i);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "natural-language check-in",
        "health context retrieval",
        "review before save",
        "incremental water total",
        "preserved measurements",
        "read-only daily guidance",
      ],
      syntheticDailyPlan: plan.reply,
    }),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
