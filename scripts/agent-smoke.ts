// Explicit opt-in smoke test against a real model provider, using synthetic data only.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
config({ path: ".env.local", quiet: true });
if (
  process.env.AGENT_PROVIDER === "openrouter" &&
  !process.env.OPENROUTER_API_KEY
) {
  process.env.OPENROUTER_API_KEY = (
    await readFile(
      join(homedir(), ".config/lift-journal/openrouter.key"),
      "utf8",
    )
  ).trim();
}
if (
  !process.env.TEST_DATABASE_URL ||
  !(await import("../lib/agent/provider")).providerConfig()
)
  throw Error(
    "Set TEST_DATABASE_URL and a model provider for this opt-in test.",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getPool } = await import("../lib/db"),
  { runTurn, applyProposal } = await import("../lib/agent/engine"),
  { readJournal } = await import("../lib/server");
const pool = getPool(),
  id = crypto.randomUUID();
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic athlete','agent-smoke-'||$1||'@example.test',true)",
  [id],
);
try {
  const response = await runTurn(id, {
    id: crypto.randomUUID(),
    revision: 0,
    timezone: "Europe/Copenhagen",
    message:
      "Please log this completed accessory training on 5 September 2026: strict press, one successful set of 40 kg for 8 reps. Title: Accessory training. There were no other exercises.",
  });
  assert.equal(response.proposals.length, 1, `No proposal: ${response.reply}`);
  const p = response.proposals[0];
  assert.equal(p.workout!.date, "2026-09-05");
  assert.equal(p.workout!.programDayId, "gym_accessories");
  assert.equal(p.workout!.exercises.length, 1);
  assert.equal(p.workout!.exercises[0].exerciseId, "strict_press");
  assert.equal(Number(p.workout!.exercises[0].sets[0].weight), 40);
  assert.equal(Number(p.workout!.exercises[0].sets[0].reps), 8);
  assert.equal((await readJournal(id)).state.sessions.length, 0);
  await applyProposal(id, p.id);
  const summary = await runTurn(id, {
    id: crypto.randomUUID(),
    revision: 1,
    timezone: "Europe/Copenhagen",
    message:
      "What exactly did I train on 5 September 2026? Include the weight, reps and exercise.",
  });
  assert.equal(summary.proposals.length, 0);
  assert.match(summary.reply, /40/);
  assert.match(summary.reply, /8/);
  assert.match(summary.reply, /strict press/i);
  await applyProposal(id, p.id, true);
  assert.equal((await readJournal(id)).state.sessions.length, 0);
  console.log(
    JSON.stringify({
      model: process.env.AGENT_MODEL ?? process.env.OLLAMA_MODEL,
      checks: [
        "real tool calling",
        "exact accessory proposal",
        "review before save",
        "retrieved synthetic history",
        "undo",
      ],
      passed: true,
    }),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
  await pool.end();
}
