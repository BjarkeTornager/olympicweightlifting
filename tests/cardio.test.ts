import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyJournal,
  backup,
  parseLegacyBackup,
  mergeImport,
  createWorkout,
} from "../lib/domain";
import { journalSchema } from "../lib/model";
import {
  saveCardio,
  cardioRate,
  cardioSummary,
  formatDuration,
} from "../lib/cardio";
import { dailyHealth, saveCheckin } from "../lib/health";
import { prepareAction } from "../lib/agent/actions";
const date = "2026-09-06";

test("Cardio records exact time, missing metrics, and sport-specific rates without changing food or lifting", () => {
  const state = emptyJournal();
  state.activeWorkout = createWorkout(state, undefined, date);
  saveCheckin(state, { date, sleepHours: 7.5, waterMl: 1000 }, date);
  const before = structuredClone(state);
  const run = saveCardio(
    state,
    {
      activity: "running",
      date,
      durationSeconds: 28 * 60,
      distanceKm: 5,
      averageHeartRate: 145,
      caloriesKcal: 300,
      notes: "Easy run",
    },
    date,
  );
  assert.equal(cardioRate(run), "5:36 /km");
  assert.equal(
    cardioRate({
      ...run,
      activity: "cycling",
      distanceKm: 20,
      durationSeconds: 3600,
    }),
    "20 km/h",
  );
  assert.equal(
    cardioRate({
      ...run,
      activity: "swimming",
      distanceKm: 1.5,
      durationSeconds: 1800,
    }),
    "2:00 /100 m",
  );
  assert.equal(
    cardioRate({
      ...run,
      activity: "rowing",
      distanceKm: 2,
      durationSeconds: 480,
    }),
    "2:00 /500 m",
  );
  assert.equal(cardioRate({ ...run, distanceKm: null }), null);
  assert.equal(cardioRate({ ...run, distanceKm: 0 }), null);
  assert.equal(formatDuration(3667), "1 h 1 min 7 sec");
  assert.deepEqual(state.activeWorkout, before.activeWorkout);
  assert.deepEqual(state.nutrition, before.nutrition);
  assert.deepEqual(state.health, before.health);
  const health = dailyHealth(state, date);
  assert.equal(health.sessionsThisWeek, 1);
  assert.equal(health.strengthSessionsThisWeek, 0);
  assert.equal(health.cardio.durationSeconds, 1680);
  assert.equal(
    health.nutrients.calories,
    0,
    "Activity energy is never counted as food intake",
  );
  saveCardio(state, { activity: "walking", date, durationSeconds: 600 }, date);
  const summary = cardioSummary(state, date, date);
  assert.equal(summary.distanceSamples, 1);
  assert.equal(
    summary.byActivity.find((s) => s.activity === "walking")!.distanceKm,
    null,
  );
  assert.equal(summary.durationSeconds, 2280);
  assert.equal(summary.daily.length, 1, "Missing days are absent observations");
});

test("Cardio validation rejects invalid dates, measurements and duplicate IDs; patches preserve unspecified values", () => {
  for (const input of [
    { durationSeconds: 0 },
    { durationSeconds: 1.5 },
    { date: "2026-02-30" },
    { date: "2026-09-07" },
    { distanceKm: -1 },
    { distanceKm: Infinity },
    { averageHeartRate: 150, maxHeartRate: 120 },
    { effort: 11 },
    { caloriesKcal: -1 },
    { activity: "invented" },
  ])
    assert.throws(() =>
      saveCardio(
        emptyJournal(),
        { activity: "cycling", date, durationSeconds: 3600, ...input },
        date,
      ),
    );
  const state = emptyJournal();
  const original = saveCardio(
    state,
    {
      activity: "cycling",
      date,
      durationSeconds: 3600,
      distanceKm: 25,
      averageHeartRate: 135,
      maxHeartRate: 160,
      notes: "Keep note",
    },
    date,
  );
  const changed = saveCardio(state, { distanceKm: 26.2 }, date, original.id);
  assert.equal(changed.averageHeartRate, 135);
  assert.equal(changed.notes, "Keep note");
  assert.equal(changed.id, original.id);
  assert.equal(changed.createdAt, original.createdAt);
  assert.equal(state.cardio.sessions.length, 1);
  assert.throws(() =>
    saveCardio(state, { maxHeartRate: 100 }, date, original.id),
  );
  assert.throws(
    () => saveCardio(state, { distanceKm: 5 }, date, crypto.randomUUID()),
    /not in your journal/,
  );
  const duplicate = structuredClone(state);
  duplicate.cardio.sessions.push(changed);
  assert.equal(journalSchema.safeParse(duplicate).success, false);
});

test("Cardio backups are lossless, repeat imports are idempotent, conflicting records require review and old journals upgrade", () => {
  const state = emptyJournal();
  saveCardio(
    state,
    {
      activity: "swimming",
      date,
      durationSeconds: 1801,
      distanceKm: 1.5,
      effort: 4.5,
    },
    date,
  );
  const imported = mergeImport(
    emptyJournal(),
    parseLegacyBackup(backup(state)),
  );
  assert.deepEqual(imported.cardio, state.cardio);
  assert.equal(
    mergeImport(imported, parseLegacyBackup(backup(state))).cardio.sessions
      .length,
    1,
  );
  const conflict = structuredClone(state);
  conflict.cardio.sessions[0].durationSeconds++;
  assert.throws(
    () => mergeImport(imported, conflict),
    /different version of cardio/,
  );
  const old = JSON.parse(JSON.stringify(emptyJournal()));
  delete old.cardio;
  assert.deepEqual(parseLegacyBackup(old).cardio, { sessions: [] });
  assert.equal(
    mergeImport(imported, parseLegacyBackup(old)).cardio.sessions.length,
    1,
  );
  imported.profile.bodyweight = 81;
  const unrelated = emptyJournal();
  unrelated.profile.bodyweight = 65;
  assert.equal(
    mergeImport(imported, unrelated).profile.bodyweight,
    81,
    "A cardio-only journal is not treated as empty",
  );
});

test("Coach cardio proposals are reviewable, correct with patches, warn about duplicate activities and delete only the selected entry", () => {
  const state = emptyJournal();
  const prepared = prepareAction(
    state,
    {
      kind: "record_cardio",
      cardio: {
        activity: "running",
        date,
        durationSeconds: 1680,
        distanceKm: 5,
        notes: "Keep note",
      },
    },
    date,
  );
  assert.equal(state.cardio.sessions.length, 0);
  assert.equal(prepared.cardio!.durationSeconds, 1680);
  const duplicate = prepareAction(
    prepared.state,
    {
      kind: "record_cardio",
      cardio: { activity: "running", date, durationSeconds: 600 },
    },
    date,
  );
  assert.match(duplicate.detail, /similar activity/);
  const updated = prepareAction(
    prepared.state,
    {
      kind: "update_cardio",
      cardioId: prepared.cardio!.id,
      changes: { durationSeconds: 1700 },
    },
    date,
  );
  assert.equal(updated.cardio!.distanceKm, 5);
  assert.equal(updated.cardio!.notes, "Keep note");
  assert.throws(
    () =>
      prepareAction(
        state,
        { kind: "delete_cardio", cardioId: prepared.cardio!.id },
        date,
      ),
    /not in your journal/,
  );
  const deleted = prepareAction(
    updated.state,
    { kind: "delete_cardio", cardioId: prepared.cardio!.id },
    date,
  );
  assert.equal(deleted.state.cardio.sessions.length, 0);
  assert.equal(
    deleted.cardio!.id,
    prepared.cardio!.id,
    "Deletion review identifies exactly what will be removed",
  );
});
