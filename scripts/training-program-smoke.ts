// Opt-in evaluation against the configured real provider; synthetic users only.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { trainingPrograms } from "../lib/training-programs";
config({ path: ".env.local", quiet: true });
if (
  process.env.TRAINING_PROGRAM_SMOKE !== "true" ||
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw Error(
    "Opt in with TRAINING_PROGRAM_SMOKE=true and a disposable _test database.",
  );
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
const { readJournal } = await import("../lib/server");
const { runTurn, applyProposal, athleteDate } =
  await import("../lib/agent/engine");
const { callModel } = await import("../lib/agent/provider");
const pool = getPool(),
  userId = crypto.randomUUID(),
  timezone = "Europe/Copenhagen",
  date = athleteDate(timezone);
const results: unknown[] = [];
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic training evaluation','training-smoke-'||$1||'@example.test',true)",
  [userId],
);
async function ask(message: string) {
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
    process.env.TRAINING_PROGRAM_SMOKE_STREAM === "true"
      ? { emit: () => {} }
      : {},
  );
  results.push({ message, calls, response });
  assert.equal(
    response.proposals.length,
    1,
    `Expected a review for: ${message}`,
  );
  assert.equal(
    (await readJournal(userId)).revision,
    snapshot.revision,
    "Preparation never saves",
  );
  console.log(
    JSON.stringify({
      step: results.length,
      calls,
      review: response.proposals[0].title,
    }),
  );
  return {
    response,
    saved: await applyProposal(userId, response.proposals[0].id),
  };
}
try {
  if (process.env.TRAINING_PROGRAM_SMOKE_CASE !== "design") {
    const created = await ask(
      "Create a reusable routine in Train named Lower accessories: seated leg curl 3 sets of 12 reps at 35 kg, standing calf raise 3 sets of 15 at 20 kg additional weight. These are planned starting targets, not completed exercise. I have no completed sessions. Please prepare it now.",
    );
    assert.equal(created.saved.state.templates.length, 1);
    assert.equal(created.saved.state.sessions.length, 0);
    assert.equal(created.saved.state.activeWorkout, null);
    const routine = created.saved.state.templates[0];
    assert.equal(routine.exercises[0].exerciseId, "seated_leg_curl");
    assert.equal(routine.exercises[0].sets.length, 3);
    assert.equal(routine.exercises[1].sets[0].weight, 20);
    const edited = await ask(
      "Edit that saved Lower accessories routine: change all seated leg curl sets to 37.5 kg. Keep the reps, calf raises and everything else the same. Prepare the edit.",
    );
    assert.equal(edited.saved.state.templates[0].id, routine.id);
    assert.ok(
      edited.saved.state.templates[0].exercises[0].sets.every(
        (s) => s.weight === 37.5,
      ),
    );
    assert.deepEqual(
      edited.saved.state.templates[0].exercises[1],
      routine.exercises[1],
    );
    const programResult = await ask(
      "Create a separate reusable 6-week program named Flexible week in Train. Monday: seated leg curl 3 sets of 10–12 reps at 35 kg, rest 90 seconds, target RPE 7; and a custom movement Landmine squat, 3 sets of 8 reps with the starting load left blank. Wednesday: an easy 30-minute run. Friday: a recovery day with gentle mobility. Keep the three days in that order, and don't log any completed activity. Please prepare the whole program now.",
    );
    const p = trainingPrograms(programResult.saved.state)[0];
    assert.ok(p);
    assert.equal(p.days.length, 3);
    assert.equal(p.days[0].exercises[0].repsMax, 12);
    assert.equal(p.days[0].exercises[0].restSeconds, 90);
    assert.equal(p.days[0].exercises[1].weight, null);
    assert.match(p.days[0].exercises[1].exerciseId, /^custom:/);
    assert.equal(p.days[1].cardio?.[0].durationSeconds, 1800);
    assert.equal(programResult.saved.state.cardio.sessions.length, 0);
    const changed = await ask(
      "Edit Flexible week: increase Monday's seated leg curl starting load to 40 kg and change the program length to 8 weeks. Keep every other exercise, target, day, instruction and day order unchanged. Prepare this edit.",
    );
    const changedProgram = trainingPrograms(changed.saved.state)[0];
    assert.equal(changedProgram.weeks, 8);
    assert.equal(changedProgram.days[0].exercises[0].weight, 40);
    assert.deepEqual(changedProgram.days.slice(1), p.days.slice(1));
    assert.deepEqual(
      changedProgram.days[0].exercises[1],
      p.days[0].exercises[1],
    );
    const started = await ask(
      `Start Monday from my saved Flexible week program as an unfinished workout for ${date}. Don't mark any sets completed.`,
    );
    assert.equal(started.saved.state.activeWorkout?.programId, p.id);
    assert.equal(
      started.saved.state.activeWorkout?.exercises[0].sets[0].weight,
      40,
    );
    assert.ok(
      started.saved.state.activeWorkout?.exercises.every((e) =>
        e.sets.every((s) => !s.logged && !s.result),
      ),
    );
    const adjusted = await ask(
      "Change Wednesday in Flexible week to a 45-minute easy run. Preserve Monday, Friday and all other details. This is only a plan edit, not a completed run, and keep my current workout as it is. Prepare the change.",
    );
    assert.equal(
      trainingPrograms(adjusted.saved.state)[0].days[1].cardio?.[0]
        .durationSeconds,
      2700,
    );
    assert.deepEqual(
      adjusted.saved.state.activeWorkout,
      started.saved.state.activeWorkout,
    );
    assert.equal(adjusted.saved.state.cardio.sessions.length, 0);
    const undone = await applyProposal(
      userId,
      adjusted.response.proposals[0].id,
      true,
    );
    assert.deepEqual(
      trainingPrograms(undone.state),
      trainingPrograms(started.saved.state),
    );
  }
  const designed = await ask(
    "Create a NEW reusable program named Four day gym plan. Design a four-day upper/lower split for general strength, around 45 minutes per session. I have barbells, dumbbells, cables and machines. Choose 3–5 suitable exercises per day, with 2–4 sets and rep ranges. Leave all starting loads blank, as I will choose them in the gym. Please design the details and prepare the program now; these are future targets, not completed training.",
  );
  const design = trainingPrograms(designed.saved.state).find(
    (p) => p.name === "Four day gym plan",
  );
  assert.ok(design);
  assert.equal(design.days.length, 4);
  assert.ok(
    design.days.every(
      (d) =>
        d.exercises.length >= 3 &&
        d.exercises.length <= 5 &&
        d.exercises.every(
          (e) => e.weight === null && e.sets >= 2 && e.sets <= 4,
        ),
    ),
  );
  assert.equal(designed.saved.state.sessions.length, 0);
  assert.equal(designed.saved.state.cardio.sessions.length, 0);
  console.log(
    JSON.stringify({
      passed: true,
      conversations: results.length,
      checks:
        process.env.TRAINING_PROGRAM_SMOKE_CASE === "design"
          ? "Design a four-day gym plan from goals and equipment, with unknown loads, reviewed before saving"
          : "create/edit routine, multi-day plan, unknown load, custom movement, planned cardio/recovery, preserve days and active workout, start unlogged, approve and undo, design a four-day gym plan",
    }),
  );
} finally {
  await writeFile(
    process.env.TRAINING_PROGRAM_SMOKE_CASE === "design"
      ? process.env.TRAINING_PROGRAM_SMOKE_STREAM === "true"
        ? "/tmp/lift-training-design-stream-result.json"
        : "/tmp/lift-training-design-result.json"
      : "/tmp/lift-training-smoke-result.json",
    JSON.stringify(results, null, 2),
    { mode: 0o600 },
  );
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
