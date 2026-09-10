import { test } from "node:test";
import assert from "node:assert/strict";
import { backup, emptyJournal, parseLegacyBackup } from "../lib/domain";
import { journalSchema } from "../lib/model";
import { liftingReview, liftingBriefInputSchema } from "../lib/lifting-coach";
import { offsetDate } from "../lib/health";
import { prepareAction, loggingToolSchema } from "../lib/agent/actions";
import { liftingBrief, liftingFixture } from "./fixtures/lifting-coach";
const date = "2026-09-10";

test("lifting evidence separates explicit outcomes, unrated work and unknown recovery without mutating the journal", () => {
  const state = liftingFixture(date),
    before = structuredClone(state),
    report = liftingReview(state, date);
  assert.deepEqual(state, before);
  assert.equal(report.recordedSessions, 1);
  assert.equal(report.loggedSets, 3);
  assert.equal(report.madeSets, 1, "a double is one reported set outcome");
  assert.equal(report.missedSets, 1);
  assert.equal(report.unratedSets, 1);
  assert.equal(report.averageReportedRpe, 7);
  assert.equal(report.rpeSets, 2);
  assert.equal(report.weeks[0].averageSleepHours, null);
  assert.equal(report.weeks[0].averageReportedRpe, null);
  assert.equal(report.weeks[3].averageSleepHours, 7.5);
  assert.equal(report.weeks[3].sleepNights, 1);
  assert.equal(report.activeWorkout?.loggedSets, 0);
  assert.deepEqual(report.exercises[0].bestRecordedSet, {
    sessionId: state.sessions[0].id,
    date: "2026-09-09",
    weight: 45,
    reps: 2,
  });
  assert.match(report.recentSessions[0].reportedNotes, /felt steadier/);
  assert.equal(report.brief?.daysPerWeek, 3);
});

test("four-week lifting bounds exclude future, old, unfinished and merely prescribed training", () => {
  const state = liftingFixture(date),
    source = state.sessions[0];
  for (const day of [
    offsetDate(date, -28),
    offsetDate(date, -27),
    offsetDate(date, 1),
  ])
    state.sessions.push({
      ...structuredClone(source),
      id: crypto.randomUUID(),
      date: day,
    });
  state.sessions.push({
    ...structuredClone(source),
    id: crypto.randomUUID(),
    exercises: source.exercises.map((e) => ({
      ...e,
      sets: e.sets.filter((s) => s.logged === false),
    })),
  });
  state.activeWorkout!.exercises = structuredClone(source.exercises);
  const report = liftingReview(state, date);
  assert.equal(report.from, "2026-08-14");
  assert.equal(report.recordedSessions, 2);
  assert.equal(report.loggedSets, 6);
  assert.equal(report.activeWorkout?.loggedSets, 3);
  assert.equal(
    report.weeks.reduce((sum, w) => sum + w.sessions, 0),
    2,
  );
  const filtered = liftingReview(state, date, "front_squat");
  assert.equal(filtered.recordedSessions, 0);
  assert.equal(filtered.exercises.length, 0);
  assert.equal(
    filtered.weeks[3].sleepNights,
    1,
    "sleep remains person-level, not exercise data",
  );
  assert.throws(() => liftingReview(state, "2026-02-31"));
});

test("observed sets preserve reps, bodyweight conventions and source IDs; misses never become a best set", () => {
  const state = liftingFixture(date),
    entry = state.sessions[0].exercises[0];
  entry.exerciseId = "custom:Ring support";
  entry.sets = [
    { id: "bodyweight", weight: 0, reps: 1, logged: true, result: "", rpe: "" },
  ];
  const report = liftingReview(state, date);
  assert.equal(report.exercises[0].name, "Ring support");
  assert.equal(report.exercises[0].bestRecordedSet?.weight, 0);
  assert.equal(report.averageReportedRpe, null);
  entry.sets[0].result = "miss";
  assert.equal(liftingReview(state, date).exercises[0].bestRecordedSet, null);
});

test("brief is bounded, optional for legacy journals and retained in backups; plans and logging stay separate", () => {
  const original = emptyJournal();
  assert.equal(journalSchema.parse(original).profile.lifting, undefined);
  for (const changes of [
    { daysPerWeek: 8 },
    { minutesPerSession: 0 },
    { targetDate: "2026-02-31" },
    { goal: " " },
    { constraints: "x".repeat(501) },
    { experience: "elite-diagnosed" },
  ])
    assert.equal(
      liftingBriefInputSchema.safeParse({ ...liftingBrief, ...changes })
        .success,
      false,
    );
  const prepared = prepareAction(
    original,
    { kind: "set_lifting_brief", liftingBrief },
    date,
  );
  assert.equal(original.profile.lifting, undefined);
  assert.equal(prepared.state.profile.lifting?.goal, liftingBrief.goal);
  assert.deepEqual(prepared.liftingBrief, prepared.state.profile.lifting);
  assert.deepEqual(prepared.state.sessions, original.sessions);
  assert.deepEqual(prepared.state.program, original.program);
  assert.deepEqual(prepared.state.prs, original.prs);
  assert.deepEqual(
    parseLegacyBackup(backup(prepared.state)).profile.lifting,
    prepared.liftingBrief,
  );
  const cleared = prepareAction(
    prepared.state,
    { kind: "set_lifting_brief", liftingBrief: null },
    date,
  );
  assert.equal(cleared.state.profile.lifting, null);
  assert.equal(cleared.liftingBrief, null);
  assert.equal(
    loggingToolSchema.safeParse({ kind: "set_lifting_brief", liftingBrief })
      .success,
    false,
  );
});

test("empty evidence stays unknown and long notes remain bounded for the Coach context", () => {
  const empty = liftingReview(emptyJournal(), date);
  assert.equal(empty.brief, null);
  assert.equal(empty.averageReportedRpe, null);
  assert.equal(empty.latestSessionId, null);
  assert.equal(
    empty.weeks.every((w) => w.averageSleepHours === null),
    true,
  );
  const state = liftingFixture(date);
  state.sessions = Array.from({ length: 40 }, (_, i) => {
    const session = structuredClone(state.sessions[0]);
    session.id = `s${i}`;
    session.title = "s".repeat(10000);
    session.athleteNotes = "n".repeat(10000);
    session.exercises[0].exerciseId = `custom:Lift ${i}`;
    session.exercises[0].athleteNotes = "n".repeat(10000);
    return session;
  });
  const report = liftingReview(state, date);
  assert.equal(report.totalExercises, 40);
  assert.equal(report.exercises.length, 30);
  assert.equal(report.recentSessions.length, 5);
  assert.ok(JSON.stringify(report).length < 40000);
});
