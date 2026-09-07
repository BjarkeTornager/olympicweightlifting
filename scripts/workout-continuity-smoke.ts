// Opt-in provider regression. Only synthetic data in a disposable database.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
config({ path: ".env.local", quiet: true });
if (
  process.env.WORKOUT_CONTINUITY_SMOKE !== "true" ||
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test") ||
  !process.env.OPENROUTER_API_KEY
)
  throw Error(
    "Explicit opt-in, configured provider key and disposable _test database required.",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getPool } = await import("../lib/db");
const { readJournal, writeJournal } = await import("../lib/server");
const { runTurn, applyProposal, athleteDate } =
  await import("../lib/agent/engine");
const { callModel } = await import("../lib/agent/provider");
const { prepareAction } = await import("../lib/agent/actions");
const pool = getPool(),
  userId = crypto.randomUUID(),
  timezone = "Europe/Copenhagen",
  date = athleteDate(timezone);
const results: unknown[] = [];
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic continuity evaluation','continuity-smoke-'||$1||'@example.test',true)",
  [userId],
);
async function ask(message: string, expectProposal = true) {
  const snapshot = await readJournal(userId),
    calls: string[] = [];
  const response = await runTurn(
    userId,
    { id: crypto.randomUUID(), revision: snapshot.revision, timezone, message },
    async (...args) => {
      const result = await callModel(...args);
      calls.push(...(result.tool_calls?.map((c) => c.function.name) ?? []));
      return result;
    },
    process.env.WORKOUT_CONTINUITY_SMOKE_STREAM === "true"
      ? { emit: () => {} }
      : {},
  );
  results.push({ message, calls, response });
  await writeFile(
    "/tmp/lift-continuity-model-results.json",
    JSON.stringify(results, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      step: results.length,
      calls,
      review: response.proposals[0]?.title,
    }),
  );
  assert.equal((await readJournal(userId)).revision, snapshot.revision);
  assert.equal(response.proposals.length, expectProposal ? 1 : 0, message);
  return expectProposal
    ? await applyProposal(userId, response.proposals[0].id)
    : snapshot;
}
try {
  let saved = await ask(
    `Log my lower body workout so far today (${date}): Romanian deadlift 60 kg x 10, 80 kg x 8, 90 kg x 8, 100 kg x 6. Back squat 110 kg x 6, 120 kg x 4, 130 kg x 4, 140 kg x 2, 150 kg x 1. All made. I have not started Bulgarian split squats yet; I am still training.`,
  );
  assert.equal(saved.state.sessions.length, 0);
  assert.equal(
    saved.state.activeWorkout!.exercises.flatMap((e) => e.sets).length,
    9,
  );
  const activeId = saved.state.activeWorkout!.id;
  saved = await ask(
    "Next I did Bulgarian split squats: 28 kg total dumbbell weight for 16 total reps (8 per leg), then 36 kg total for 16 total reps, then 40 kg total for 16 total reps. All successful. Add these to this same ongoing workout. I am not finished yet.",
  );
  assert.equal(saved.state.activeWorkout!.id, activeId);
  assert.equal(saved.state.sessions.length, 0);
  assert.equal(
    saved.state.activeWorkout!.exercises.flatMap((e) => e.sets).length,
    12,
  );
  saved = await ask(
    "That is the whole workout done now. No more sets. Finish it as one workout.",
  );
  assert.equal(saved.state.activeWorkout, null);
  assert.equal(saved.state.sessions.length, 1);
  assert.equal(
    saved.state.sessions[0].exercises.flatMap((e) => e.sets).length,
    12,
  );
  saved = await ask(
    "I forgot one additional back squat set from that same completed workout: 100 kg for 5 reps, successful. Add only that missing set and keep everything already logged. The workout is finished.",
  );
  assert.equal(saved.state.sessions.length, 1);
  assert.equal(
    saved.state.sessions[0].exercises.flatMap((e) => e.sets).length,
    13,
  );
  saved = await ask(
    "To recap, I did Romanian deadlift 60 kg x 10, 80 kg x 8, 90 kg x 8 and 100 kg x 6. These are the sets already saved; do not add them again. Is that what my journal shows?",
    false,
  );
  assert.equal(
    saved.state.sessions[0].exercises.flatMap((e) => e.sets).length,
    13,
  );
  const extra = prepareAction(
    saved.state,
    {
      kind: "record_session",
      separateSession: true,
      workout: {
        title: "Lower body final sets",
        date,
        category: "accessories",
        exercises: [
          {
            exerciseId: "seated_leg_curl",
            sets: [{ weight: 35, reps: 12, result: "success" }],
          },
        ],
      },
    },
    date,
  ).state;
  await writeJournal(userId, {
    state: extra,
    revision: saved.revision,
    mutationId: crypto.randomUUID(),
  });
  saved = await ask(
    `The two history entries for ${date} are pieces of that same lower body workout: the earlier session and Lower body final sets. Please combine those two entries into one completed session named Lower body strength. Keep all sets and notes, including any repeated sets.`,
  );
  assert.equal(saved.state.sessions.length, 1);
  assert.equal(
    saved.state.sessions[0].exercises.flatMap((e) => e.sets).length,
    14,
  );
  console.log(
    JSON.stringify({
      passed: results.length,
      model: process.env.AGENT_MODEL,
      stream: process.env.WORKOUT_CONTINUITY_SMOKE_STREAM === "true",
    }),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
