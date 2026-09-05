import test from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_DEFINITION } from "../js/data.js";
import { PROGRESSION_STEP, PROGRAM_PROGRESSION_REVISION, wholeKilograms, planExercise, planProgramDay, upgradeProgramDraft, isValidLoggedSet, updatePendingSets } from "../js/progression.js";

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

test("all programmes retain prescribed default sets and reps; only configured lifts progress", () => {
  for (const day of PROGRAM_DEFINITION.days) {
    for (const exercise of day.exercises) {
      const plan = planExercise(exercise, { ...context, dayId: day.id, sessions: [] });
      assert.equal(plan.weight, exercise.initialWeight);
      assert.equal(plan.reps, exercise.defaultReps);
      assert.equal(plan.sets, typeof exercise.sets === "number" ? exercise.sets : exercise.sets.default);
      assert.equal(plan.status, exercise.progression ? typeof exercise.initialWeight === "number" ? "initial" : "choose" : "manual");
      if (plan.maxWeight !== null) assert.ok(plan.maxWeight >= plan.weight);
    }
  }
});

test("successful controlled work increases 45 to 47 without increasing sets or reps", () => {
  const plan = planFor(session());
  assert.equal(plan.weight, 47);
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
  assert.equal(planFor(previous).weight, 47);
  for (const rpe of ["9", "0", "11", "8abc"]) {
    previous.exercises[0].strongSets = true;
    previous.exercises[0].sets[0].rpe = rpe;
    assert.equal(planFor(previous).status, "hold");
  }
});

test("progression uses the lightest successful working set, not a top single", () => {
  const previous = session();
  previous.exercises[0].sets[5].weight = "55";
  assert.equal(planFor(previous).weight, 47);
  previous.exercises[0].sets[5].result = "miss";
  assert.equal(planFor(previous).weight, 45);
  assert.equal(planFor(previous).status, "hold");
});

test("starting ranges are not fixed ceilings; an explicit custom ceiling is still respected", () => {
  const previous = session();
  previous.exercises[0].sets.forEach(set => { set.weight = "55"; });
  assert.equal(planFor(previous).weight, 57);
  assert.equal(planFor(previous).status, "increase");
  const cappedSnatch = { ...snatch, progression: { step: 2, maxWeight: 55 } };
  assert.equal(planFor(previous, {}, cappedSnatch).weight, 55);
  assert.equal(planFor(previous, {}, cappedSnatch).status, "limit");
  const pull = { ...monday.exercises[1], progression: { step: 2, maxWeight: 67 } };
  const pullSession = session(pull);
  pullSession.exercises[0].sets.forEach(set => { set.weight = "66.5"; });
  assert.equal(planFor(pullSession, {}, pull).weight, 66);
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
  assert.equal(planFor(previous).weight, 52);
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
    assert.equal(plan.weight, 45 + week * 2);
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
  today.exercises[0].prescribed.targetWeight = 47;
  today.exercises[0].sets.forEach(set => { set.weight = "47"; });
  const future = session(snatch, "2026-09-15");
  future.id = "future";
  future.exercises[0].sets.forEach(set => { set.weight = "100"; });
  const sessions = [previous, today, future];
  const preview = planProgramDay(monday, { ...context, sessions });
  assert.equal(preview.trainedToday, true);
  assert.equal(preview.availableFrom, "2026-09-15");
  assert.equal(preview.exercises[0].weight, 49);
  assert.equal(planExercise(snatch, { ...context, sessions }).weight, 47);
  assert.equal(planProgramDay(monday, { ...context, sessions: [previous] }).exercises[0].weight, 47);
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
  assert.ok(upgraded.exercises[0].sets.every(set => set.weight === "47"));
  assert.deepEqual(upgraded.exercises[1], protectedEntry);
  assert.equal(JSON.stringify(draft), original);
  assert.equal(JSON.stringify(prior), historyBefore);
  assert.equal(upgradeProgramDraft(upgraded, { day: monday, sessions: [prior] }), upgraded);
  assert.equal(upgradeProgramDraft({ ...draft, editingSessionId: "saved" }, { day: monday, sessions: [prior] }).editingSessionId, "saved");
  delete draft.exercises[0].loggingVersion;
  delete draft.exercises[0].prescribed;
  const legacy = upgradeProgramDraft(draft, { day: monday, sessions: [prior] });
  assert.equal(legacy.exercises[0].loggingVersion, 1);
  assert.equal(legacy.exercises[0].prescribed.targetWeight, 47);
  draft.exercises[0].sets[0].weight = "52";
  assert.equal(upgradeProgramDraft(draft, { day: monday, sessions: [prior] }).exercises[0].sets[0].weight, "52");
});

test("pending sets inherit edits but explicitly edited or logged values are kept", () => {
  const entry = session().exercises[0];
  entry.sets.forEach(set => { set.result = ""; set.logged = false; });
  entry.sets[3].logged = true;
  entry.sets[4].edited = { weight: true };
  updatePendingSets(entry, "set-0", "weight", "47");
  assert.deepEqual(entry.sets.map(set => set.weight), ["47", "47", "47", "45", "45", "47"]);
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

test("automatic targets and increments are whole kilograms for every configured lift", () => {
  for (const day of PROGRAM_DEFINITION.days) {
    for (const exercise of day.exercises.filter(item => item.progression && typeof item.initialWeight === "number")) {
      const initial = planExercise(exercise, { ...context, sessions: [] });
      const next = planFor(session(exercise), {}, exercise);
      assert.ok(Number.isInteger(initial.weight));
      assert.ok(Number.isInteger(next.weight));
      assert.equal(next.weight - initial.weight, 2);
      assert.match(next.reason, /2 kg total \(1 kg per side\)/);
    }
  }
  const fiveKg = { ...snatch, progression: { step: 5 } };
  assert.equal(planFor(session(fiveKg), {}, fiveKg).weight, 50);
  assert.match(planFor(session(fiveKg), {}, fiveKg).reason, /5 kg total \(2\.5 kg per side\)/);
  for (const step of [2.5, 0, -2, NaN, Infinity]) {
    assert.equal(planFor(session(), {}, { ...snatch, progression: { step } }).step, PROGRESSION_STEP);
  }
});

test("fractional historical loads round down only in new plans, including holds and ceilings", () => {
  const previous = session();
  previous.exercises[0].prescribed.targetWeight = 47.5;
  previous.exercises[0].sets.forEach(set => { set.weight = "47.5"; });
  const snapshot = JSON.stringify(previous);
  assert.equal(planFor(previous).weight, 49);
  assert.equal(planFor(previous).previousWeight, 47.5);
  assert.match(planFor(previous).reason, /47\.5 kg rounded down to a 47 kg baseline/);
  assert.equal(planFor(previous, { recovery: "limited" }).weight, 47);
  const capped = { ...snatch, progression: { step: 2, maxWeight: 48.5 } };
  assert.equal(planFor(previous, {}, capped).weight, 47);
  assert.equal(planFor(previous, {}, capped).status, "limit");
  assert.equal(JSON.stringify(previous), snapshot);
  previous.exercises[0].sets[0].result = "miss";
  assert.equal(planFor(previous).weight, 47);
  assert.equal(planFor(previous).status, "hold");
  assert.equal(planExercise({ ...snatch, initialWeight: 45.5 }).weight, 45);
  assert.equal(planExercise({ ...snatch, initialWeight: 45.5, progression: undefined }).weight, 45.5);
  assert.equal(wholeKilograms(47.5), 47);
  assert.equal(wholeKilograms(-2), 0);
});

test("revision 2 fractional drafts upgrade once while manual, logged and historical values remain exact", () => {
  const draft = session();
  draft.date = context.date;
  draft.progressionRevision = 2;
  const entry = draft.exercises[0];
  entry.completed = false;
  entry.prescribed.targetWeight = 47.5;
  entry.sets.forEach(set => { set.weight = "47.5"; set.logged = false; set.result = ""; set.touched = false; });
  const updated = upgradeProgramDraft(draft, { day: monday, sessions: [session()] });
  assert.equal(updated.progressionRevision, PROGRAM_PROGRESSION_REVISION);
  assert.ok(updated.exercises[0].sets.every(set => set.weight === "47"));
  assert.equal(entry.sets[0].weight, "47.5");
  for (const protect of [
    item => { item.sets[0].edited = { weight: true }; },
    item => { item.sets[0].logged = true; },
    item => { item.completed = true; },
  ]) {
    const protectedDraft = structuredClone(draft);
    protect(protectedDraft.exercises[0]);
    assert.deepEqual(upgradeProgramDraft(protectedDraft, { day: monday, sessions: [session()] }).exercises[0], protectedDraft.exercises[0]);
  }
  assert.equal(upgradeProgramDraft(updated, { day: monday, sessions: [session()] }), updated);
});

test("a solo programme can progress on Saturday; the actual training date does not change programme identity", () => {
  const previous = session(snatch, "2026-09-04");
  const saturday = planExercise(snatch, { ...context, date: "2026-09-05", sessions: [previous] });
  assert.equal(saturday.weight, 47);
  assert.equal(saturday.sourceDate, "2026-09-04");
  assert.equal(saturday.status, "increase");
  assert.equal(planExercise(snatch, { ...context, date: "2026-09-03", sessions: [previous] }).weight, 45);
});

test("gym accessories learn athlete-chosen starting loads, then progress independently", () => {
  const gym = PROGRAM_DEFINITION.days.find(day => day.id === "gym_accessories");
  assert.equal(gym.weekday, null);
  assert.deepEqual(gym.exercises.map(item => item.exerciseId), ["romanian_deadlift", "strict_press", "barbell_row", "split_squat", "dead_bug"]);
  for (const exercise of gym.exercises.filter(item => item.progression)) {
    const start = planExercise(exercise, { ...context, dayId: gym.id, sessions: [] });
    assert.equal(start.status, "choose");
    assert.equal(start.weight, "");
    const previous = session(exercise);
    previous.programDayId = gym.id;
    previous.exercises[0].sets.forEach(set => { set.weight = "30"; });
    assert.equal(planFor(previous, { dayId: gym.id }, exercise).weight, 32);
    assert.equal(planFor(previous, { dayId: gym.id, recovery: "limited" }, exercise).weight, 30);
    assert.equal(planFor(previous, { dayId: "monday" }, exercise).status, "choose");
    previous.exercises[0].sets[0].rpe = "9";
    assert.equal(planFor(previous, { dayId: gym.id }, exercise).status, "hold");
    previous.exercises[0].sets.pop();
    assert.equal(planFor(previous, { dayId: gym.id }, exercise).weight, 30);
  }
  const splitSquat = gym.exercises[3];
  const bodyweight = session(splitSquat);
  bodyweight.programDayId = gym.id;
  bodyweight.exercises[0].sets.forEach(set => { set.weight = "0"; });
  assert.equal(planFor(bodyweight, { dayId: gym.id }, splitSquat).weight, 0);
  assert.equal(planFor(bodyweight, { dayId: gym.id }, splitSquat).status, "hold");
  bodyweight.exercises[0].prescribed.targetWeight = 0;
  bodyweight.exercises[0].sets.forEach(set => { set.weight = "20"; });
  assert.equal(planFor(bodyweight, { dayId: gym.id }, splitSquat).weight, 22, "Choosing an added load after bodyweight training establishes a new baseline");
  assert.equal(planExercise(gym.exercises[4]).status, "manual");
  assert.equal(planExercise(gym.exercises[4]).weight, 0);
  assert.equal(splitSquat.defaultReps, 16);
});
