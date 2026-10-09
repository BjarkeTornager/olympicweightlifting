import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backup,
  createWorkout,
  dateInProse,
  days,
  emptyJournal,
  program,
  PR_DEFINITIONS,
  finishWorkout,
  mergeImport,
  parseLegacyBackup,
} from "../lib/domain";
import { journalSchema } from "../lib/model";
import { canonicalJson, jsonEqual } from "../lib/json";
test("dates in a sentence read like the masthead and stay on one line", () => {
  assert.equal(dateInProse("2026-09-30", "2026-10-03"), "30\u00a0September");
  assert.equal(
    dateInProse("2025-12-30", "2026-01-02"),
    "30\u00a0December\u00a02025",
  );
});
test("new athletes do not inherit the owner's personal records", () => {
  const s = emptyJournal();
  assert.equal(s.prs.snatch, 0);
  assert.equal(s.profile.bodyweight, 0);
  for (const definition of PR_DEFINITIONS)
    assert.deepEqual(Object.keys(definition).sort(), ["exerciseId", "label"]);
  for (const day of days)
    for (const exercise of day.exercises)
      assert.ok(exercise.initialWeight === "" || exercise.initialWeight === 0);
  assert.doesNotMatch(
    JSON.stringify(program),
    /coach Tim|Alfa Omega|70 kg PR|60–65 kg/,
  );
});
test("finishing saves explicit work and keeps the prescription snapshot", () => {
  const s = emptyJournal();
  s.activeWorkout = createWorkout(
    s,
    days.find((d) => d.id === "monday"),
    "2026-09-05",
  );
  const set = s.activeWorkout.exercises[0].sets[0];
  // A historical prescription must remain exact even when catalogue defaults change.
  s.activeWorkout.exercises[0].prescribed.targetWeight = 45;
  set.weight = "47.5";
  set.logged = true;
  set.result = "success";
  const result = finishWorkout(s);
  assert.equal(result.activeWorkout, null);
  assert.equal(result.sessions[0].exercises[0].sets.length, 1);
  assert.equal(result.sessions[0].exercises[0].sets[0].weight, "47.5");
  assert.equal(result.sessions[0].exercises[0].prescribed.targetWeight, 45);
});
test("import is repeatable and does not discard the active draft", () => {
  const s = emptyJournal();
  s.activeWorkout = createWorkout(s, days[0], "2026-09-05");
  const parsed = parseLegacyBackup(backup(s));
  const merged = mergeImport(emptyJournal(), parsed);
  assert.deepEqual(mergeImport(merged, parsed), merged);
  assert.equal(merged.activeWorkout?.id, s.activeWorkout.id);
});
test("conflicting backups require review", () => {
  const s = emptyJournal();
  s.activeWorkout = createWorkout(s, days[0], "2026-09-05");
  const other = structuredClone(s);
  other.activeWorkout!.athleteNotes = "different";
  assert.throws(() => mergeImport(s, other), /unfinished workout/);
});
test("JSONB key ordering does not turn an identical backup into a conflict", () => {
  const state = emptyJournal();
  state.activeWorkout = createWorkout(state, days[0], "2026-09-05");
  const reordered = JSON.parse(canonicalJson(state));
  assert.deepEqual(mergeImport(state, reordered), state);
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});
test("JSON equality agrees with comparing canonical JSON, without building it", () => {
  const state = emptyJournal();
  state.activeWorkout = createWorkout(state, days[0], "2026-09-05");
  const reordered = JSON.parse(canonicalJson(state));
  assert.ok(jsonEqual(state, reordered));
  const changed = structuredClone(reordered);
  changed.activeWorkout.exercises[0].sets[0].weight = "61";
  assert.ok(!jsonEqual(state, changed));
  const cases: [unknown, unknown][] = [
    [{ a: 1, b: undefined }, { a: 1 }],
    [{ a: 1 }, { a: 1, b: null }],
    [
      [1, 2],
      [2, 1],
    ],
    [[], {}],
    ["80", 80],
    [{ a: [{ b: 1 }] }, { a: [{ b: 1 }] }],
    [null, undefined],
    [0, -0],
  ];
  for (const [a, b] of cases)
    assert.equal(
      jsonEqual(a, b),
      canonicalJson(a) === canonicalJson(b),
      JSON.stringify([a, b]),
    );
});
test("v1 migration preserves athlete values and active session", () => {
  const s = emptyJournal();
  const draft = createWorkout(s, days[0], "2026-09-05");
  const legacy = {
    schemaVersion: 1,
    bodyweight: 83.5,
    age: 34,
    sessions: [],
    activeSession: draft,
  };
  const result = parseLegacyBackup(legacy);
  assert.equal(result.profile.bodyweight, 83.5);
  assert.equal(result.activeWorkout?.id, draft.id);
});
test("future backups and invalid numeric or date values are rejected", () => {
  assert.throws(() => parseLegacyBackup({ schemaVersion: 99, sessions: [] }));
  const s = emptyJournal();
  s.activeWorkout = createWorkout(s, days[0], "2026-02-30");
  assert.equal(journalSchema.safeParse(s).success, false);
  s.activeWorkout.date = "2026-09-05";
  s.activeWorkout.exercises[0].sets[0].weight = -5;
  assert.equal(journalSchema.safeParse(s).success, false);
});
