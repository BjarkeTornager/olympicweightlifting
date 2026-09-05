import test from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_DEFINITION } from "../js/data.js";
import { planExercise, planProgramDay, upgradeProgramDraft, isValidLoggedSet, updatePendingSets } from "../js/progression.js";

const monday = PROGRAM_DEFINITION.days.find(day => day.id === "monday");
const snatch = monday.exercises[0];
const context = { programId: PROGRAM_DEFINITION.id, dayId: "monday", date: "2026-09-14", recovery: "auto" };

function session(exercise = snatch, date = "2026-09-07") {
  const plan = planExercise(exercise, { ...context, sessions: [] });
  return {
    id: "previous", date, finishedAt: date + "T12:00:00Z",
    programId: context.programId, programDayId: context.dayId,
    exercises: [{
      id: "entry", exerciseId: exercise.exerciseId, loggingVersion: 1,
      completed: true, strongSets: true,
      prescribed: { targetSets: plan.sets, targetReps: plan.reps, targetWeight: plan.weight, progression: plan },
      sets: Array.from({ length: plan.sets }, (_, index) => ({
        id: "set-" + index, weight: String(plan.weight), reps: String(plan.reps),
        rpe: "", logged: true, result: "success", touched: true,
      })),
    }],
  };
}
const planFor = (previous, extra = {}, exercise = snatch) =>
  planExercise(exercise, { ...context, sessions: [previous], ...extra });

test("all four days retain prescribed default sets and reps; only configured lifts progress", () => {
  for (const day of PROGRAM_DEFINITION.days) {
    for (const exercise of day.exercises) {
      const plan = planExercise(exercise, { ...context, dayId: day.id, sessions: [] });
      assert.equal(plan.weight, exercise.initialWeight);
      assert.equal(plan.reps, exercise.defaultReps);
      assert.equal(plan.sets, typeof exercise.sets === "number" ? exercise.sets : exercise.sets.default);
      assert.equal(plan.status, exercise.progression ? "initial" : "manual");
      if (plan.maxWeight !== null) assert.ok(plan.maxWeight >= plan.weight);
    }
  }
});

test("successful controlled work increases 45 to 47.5 without increasing sets or reps", () => {
  const plan = planFor(session());
  assert.equal(plan.weight, 47.5);
  assert.equal(plan.status, "increase");
  assert.equal(plan.sets, 6);
  assert.equal(plan.reps, 1);
  assert.equal(plan.sourceDate, "2026-09-07");
});

test("progression is automatic unless current or previous recovery is limited", () => {
  assert.equal(planFor(session(), { recovery: undefined }).status, "increase");
  assert.equal(planFor(session(), { recovery: "unknown" }).status, "increase");
  assert.equal(planFor(session(), { recovery: "limited" }).weight, 45);
  assert.equal(planFor(session(), { recovery: "limited" }).status, "hold");
  const previous = session();
  previous.recovery = "limited";
  assert.equal(planFor(previous).status, "hold");
});

test("a miss, partial exercise, removed set, or unlogged prefill cannot unlock progression", () => {
  for (const modify of [
    entry => { entry.sets[1].result = "miss"; },
    entry => { entry.completed = false; entry.sets = entry.sets.slice(0, 3); },
    entry => { entry.sets.pop(); },
    entry => { entry.sets[1].result = ""; entry.sets[1].logged = false; },
  ]) {
    const previous = session();
    modify(previous.exercises[0]);
    assert.equal(planFor(previous).status, "hold");
    assert.equal(planFor(previous).weight, 45);
  }
});

test("actual reps and loads must meet the frozen prescription", () => {
  const squat = monday.exercises[2];
  const previous = session(squat);
  previous.exercises[0].sets[0].reps = "3";
  assert.equal(planFor(previous, {}, squat).status, "hold");
  previous.exercises[0].sets[0].reps = "4";
  previous.exercises[0].sets[0].weight = "100";
  assert.equal(planFor(previous, {}, squat).status, "hold");
});

test("logging all work qualifies without extra confirmations; invalid or high RPE holds", () => {
  const previous = session();
  previous.exercises[0].strongSets = false;
  previous.exercises[0].completed = false;
  assert.equal(planFor(previous).status, "increase");
  previous.exercises[0].sets.forEach(set => { set.rpe = "8"; });
  assert.equal(planFor(previous).weight, 47.5);
  for (const rpe of ["9", "0", "11", "8abc"]) {
    previous.exercises[0].strongSets = true;
    previous.exercises[0].sets[0].rpe = rpe;
    assert.equal(planFor(previous).status, "hold");
  }
});

test("progression uses the lightest successful working set, not a top single", () => {
  const previous = session();
  previous.exercises[0].sets[5].weight = "55";
  assert.equal(planFor(previous).weight, 47.5);
  previous.exercises[0].sets[5].result = "miss";
  assert.equal(planFor(previous).weight, 45);
  assert.equal(planFor(previous).status, "hold");
});

test("starting ranges are not fixed ceilings; an explicit custom ceiling is still respected", () => {
  const previous = session();
  previous.exercises[0].sets.forEach(set => { set.weight = "55"; });
  assert.equal(planFor(previous).weight, 57.5);
  assert.equal(planFor(previous).status, "increase");
  const cappedSnatch = { ...snatch, progression: { step: 2.5, maxWeight: 55 } };
  assert.equal(planFor(previous, {}, cappedSnatch).weight, 55);
  assert.equal(planFor(previous, {}, cappedSnatch).status, "limit");
  const pull = { ...monday.exercises[1], progression: { step: 2.5, maxWeight: 67 } };
  const pullSession = session(pull);
  pullSession.exercises[0].sets.forEach(set => { set.weight = "65.5"; });
  assert.equal(planFor(pullSession, {}, pull).weight, 65.5);
  assert.equal(planFor(pullSession, {}, pull).status, "limit");
});

test("Saturday, another program, the same date and future workouts cannot increase Monday", () => {
  for (const modify of [
    s => { s.programDayId = "saturday"; },
    s => { s.programId = "other"; },
    s => { s.date = context.date; },
    s => { s.date = "2027-01-01"; },
  ]) {
    const previous = session();
    modify(previous);
    assert.equal(planFor(previous).status, "initial");
  }
});

test("use latest training date, not edit time; skipped exercise holds old baseline", () => {
  const old = session();
  old.finishedAt = "2027-01-01T12:00:00Z";
  const newer = session(snatch, "2026-09-10");
  newer.id = "newer";
  newer.exercises[0].sets[0].result = "miss";
  assert.equal(planFor(old, { sessions: [old, newer] }).sourceSessionId, "newer");
  assert.equal(planFor(old, { sessions: [old, newer] }).status, "hold");
  newer.exercises = [];
  assert.equal(planFor(old, { sessions: [old, newer] }).status, "hold");
});

test("explicit legacy results qualify; touched or prefilled legacy rows are only references", () => {
  const previous = session();
  delete previous.exercises[0].loggingVersion;
  delete previous.exercises[0].prescribed;
  previous.exercises[0].sets.forEach(set => { set.weight = "50"; });
  assert.equal(planFor(previous).weight, 52.5);
  assert.equal(planFor(previous).status, "increase");
  previous.exercises[0].sets.forEach(set => { set.logged = false; set.result = ""; });
  assert.equal(planFor(previous).weight, 50);
  assert.equal(planFor(previous).status, "hold");
});

test("the program keeps increasing across eight successful sessions beyond the original range", () => {
  const history = [];
  for (let week = 0; week < 8; week++) {
    const date = new Date(Date.UTC(2026, 8, 7 + week * 7)).toISOString().slice(0, 10);
    const plan = planExercise(snatch, { ...context, sessions: history, date });
    assert.equal(plan.weight, 45 + week * 2.5);
    const next = session(snatch, date);
    next.id = `week-${week}`;
    next.exercises[0].strongSets = false;
    next.exercises[0].prescribed.targetWeight = plan.weight;
    next.exercises[0].sets.forEach(set => { set.weight = String(plan.weight); });
    history.push(next);
  }
});

test("next-program preview advances after today's work without compounding same-day repeats", () => {
  const previous = session();
  const today = session(snatch, context.date);
  today.id = "today";
  today.exercises[0].prescribed.targetWeight = 47.5;
  today.exercises[0].sets.forEach(set => { set.weight = "47.5"; });
  const future = session(snatch, "2026-09-15");
  future.id = "future";
  future.exercises[0].sets.forEach(set => { set.weight = "100"; });
  const sessions = [previous, today, future];
  const preview = planProgramDay(monday, { ...context, sessions });
  assert.equal(preview.trainedToday, true);
  assert.equal(preview.availableFrom, "2026-09-15");
  assert.equal(preview.exercises[0].weight, 50);
  assert.equal(planExercise(snatch, { ...context, sessions }).weight, 47.5);
  assert.equal(planProgramDay(monday, { ...context, sessions: [previous] }).exercises[0].weight, 47.5);
});

test("old drafts upgrade untouched presets once without altering entered work or saved history", () => {
  const prior = session();
  const draft = session(snatch, context.date);
  draft.recovery = "unknown";
  draft.exercises[0].completed = false;
  draft.exercises[0].sets.forEach(set => { set.logged = false; set.result = ""; set.touched = false; });
  const protectedEntry = session(monday.exercises[2]).exercises[0];
  protectedEntry.id = "protected";
  draft.exercises.push(protectedEntry);
  const original = JSON.stringify(draft);
  const historyBefore = JSON.stringify(prior);
  const upgraded = upgradeProgramDraft(draft, { day: monday, sessions: [prior] });
  assert.equal(upgraded.recovery, "auto");
  assert.ok(upgraded.exercises[0].sets.every(set => set.weight === "47.5"));
  assert.deepEqual(upgraded.exercises[1], protectedEntry);
  assert.equal(JSON.stringify(draft), original);
  assert.equal(JSON.stringify(prior), historyBefore);
  assert.equal(upgradeProgramDraft(upgraded, { day: monday, sessions: [prior] }), upgraded);
  assert.equal(upgradeProgramDraft({ ...draft, editingSessionId: "saved" }, { day: monday, sessions: [prior] }).editingSessionId, "saved");
  delete draft.exercises[0].loggingVersion;
  delete draft.exercises[0].prescribed;
  const legacy = upgradeProgramDraft(draft, { day: monday, sessions: [prior] });
  assert.equal(legacy.exercises[0].loggingVersion, 1);
  assert.equal(legacy.exercises[0].prescribed.targetWeight, 47.5);
  draft.exercises[0].sets[0].weight = "52";
  assert.equal(upgradeProgramDraft(draft, { day: monday, sessions: [prior] }).exercises[0].sets[0].weight, "52");
});

test("pending sets inherit edits but explicitly edited or logged values are kept", () => {
  const entry = session().exercises[0];
  entry.sets.forEach(set => { set.result = ""; set.logged = false; });
  entry.sets[3].logged = true;
  entry.sets[4].edited = { weight: true };
  updatePendingSets(entry, "set-0", "weight", "47.5");
  assert.deepEqual(entry.sets.map(set => set.weight), ["47.5", "47.5", "47.5", "45", "45", "47.5"]);
  assert.equal(entry.completed, false);
  assert.equal(entry.strongSets, false);
  updatePendingSets(entry, "set-1", "reps", "2");
  assert.deepEqual(entry.sets.map(set => set.reps), ["1", "2", "2", "1", "2", "2"]);
});

test("editing a recorded weight invalidates its old success without recording new work", () => {
  const entry = session().exercises[0];
  updatePendingSets(entry, "set-0", "weight", "60");
  assert.equal(entry.sets[0].logged, false);
  assert.equal(entry.sets[0].result, "");
  assert.equal(isValidLoggedSet(entry.sets[0]), false);
  assert.equal(entry.sets[1].weight, "45");
});

test("invalid numbers and untouched presets are not valid logged work", () => {
  const valid = { weight: "50", reps: "1", result: "success", logged: true };
  assert.ok(isValidLoggedSet(valid));
  for (const weight of ["", "50abc", "-1", null]) assert.equal(isValidLoggedSet({ ...valid, weight }), false);
  for (const reps of ["", "1.5", "-1", null]) assert.equal(isValidLoggedSet({ ...valid, reps }), false);
  assert.equal(isValidLoggedSet({ weight: "50", reps: "1", touched: true }), false);
  assert.ok(isValidLoggedSet({ ...valid, reps: "0", result: "miss" }));
});

test("planning never mutates saved sessions and survives a JSON backup round trip", () => {
  const previous = session();
  const before = JSON.stringify(previous);
  const plan = planFor(previous);
  assert.equal(JSON.stringify(previous), before);
  assert.deepEqual(planFor(JSON.parse(before)), plan);
});
