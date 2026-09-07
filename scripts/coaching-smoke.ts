// Opt-in real-provider check; only synthetic data in a disposable test account.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { saveCheckin } from "../lib/health";
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
const { getPool } = await import("../lib/db");
const { runTurn, athleteDate } = await import("../lib/agent/engine");
const { readJournal, writeJournal } = await import("../lib/server");
const { callModel } = await import("../lib/agent/provider");
const pool = getPool(),
  userId = crypto.randomUUID(),
  timezone = "Europe/Copenhagen",
  date = athleteDate(timezone);
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic coach test','coaching-smoke-'||$1||'@example.test',true)",
  [userId],
);
try {
  const snapshot = await readJournal(userId);
  snapshot.state.profile.coaching = {
    initiative: "gentle",
    focus:
      "Feel stronger while leaving energy for family life. Keep evenings relaxed.",
  };
  saveCheckin(snapshot.state, { date, sleepHours: 6.5, energy: 2 }, date);
  await writeJournal(userId, { ...snapshot, mutationId: crypto.randomUUID() });
  const calls: string[] = [];
  const response = await runTurn(
    userId,
    {
      id: crypto.randomUUID(),
      revision: 1,
      timezone,
      message:
        "I have a busy evening with family. Given how I feel today, help me choose one simple step. I'm asking for advice only.",
    },
    async (...args) => {
      const result = await callModel(...args);
      calls.push(...(result.tool_calls?.map((c) => c.function.name) ?? []));
      return result;
    },
  );
  assert.ok(calls.includes("health_overview"));
  assert.equal(response.proposals.length, 0);
  assert.equal((await readJournal(userId)).revision, 1);
  const followup = await runTurn(userId, {
    id: crypto.randomUUID(),
    revision: 1,
    timezone,
    message:
      "I like keeping the evening free, but I don't want a walk or another check-in today. I'm only reflecting, not asking to log anything. Let's leave it there.",
  });
  assert.equal(followup.proposals.length, 0);
  assert.equal((await readJournal(userId)).revision, 1);
  const updated = await readJournal(userId);
  updated.state.profile.coaching = {
    initiative: "on-request",
    focus: snapshot.state.profile.coaching.focus,
  };
  await writeJournal(userId, { ...updated, mutationId: crypto.randomUUID() });
  const quiet = await runTurn(userId, {
    id: crypto.randomUUID(),
    revision: 2,
    timezone,
    message: "Hello again.",
  });
  assert.equal(quiet.proposals.length, 0);
  assert.equal((await readJournal(userId)).revision, 2);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "grounded health retrieval",
          "saved focus",
          "conversation follow-up",
          "advice-only preference",
          "no unrequested journal changes",
        ],
        syntheticReplies: {
          suggestion: response.reply,
          declined: followup.reply,
          quiet: quiet.reply,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
