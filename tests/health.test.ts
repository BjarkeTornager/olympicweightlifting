import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyJournal,
  backup,
  parseLegacyBackup,
  mergeImport,
} from "../lib/domain";
import {
  dailyHealth,
  saveCheckin,
  healthSchema,
  formatSleepDuration,
  sleepAverage,
  aboutSleepDifference,
} from "../lib/health";
import { prepareAction } from "../lib/agent/actions";
test("sleep minutes stay precise through proposals, backups and partial daily updates", () => {
  const state = emptyJournal(),
    date = "2026-09-06";
  saveCheckin(
    state,
    { date, waterMl: 750, bodyweight: 80, notes: "Keep this note" },
    date,
  );
  const prepared = prepareAction(
    state,
    { kind: "record_checkin", checkin: { date, sleepHours: 7 + 47 / 60 } },
    date,
  );
  assert.equal(prepared.title, "Log your sleep");
  assert.equal(
    formatSleepDuration(prepared.checkin!.sleepHours!),
    "7 h 47 min",
  );
  assert.equal(formatSleepDuration(0), "0 min");
  assert.equal(formatSleepDuration(59 / 60), "59 min");
  assert.equal(formatSleepDuration(7.999999), "8 h");
  assert.equal(formatSleepDuration(24), "24 h");
  assert.equal(state.health.checkins[0].sleepHours, null);
  const restored = mergeImport(
    emptyJournal(),
    parseLegacyBackup(backup(prepared.state)),
  );
  saveCheckin(restored, { date, waterMl: 1000 }, date);
  assert.equal(restored.health.checkins.length, 1);
  assert.equal(restored.health.checkins[0].sleepHours, 7 + 47 / 60);
  assert.equal(restored.health.checkins[0].bodyweight, 80);
  assert.equal(restored.health.checkins[0].notes, "Keep this note");
});
test("health check-ins preserve unspecified measurements and distinguish missing from zero", () => {
  const state = emptyJournal();
  assert.equal(dailyHealth(state, "2026-09-06").checkin, null);
  assert.equal(dailyHealth(state, "2026-09-06").sleepAverage, null);
  saveCheckin(
    state,
    {
      date: "2026-09-06",
      sleepHours: 6.5,
      waterMl: 500,
      energy: 2,
      notes: "Tired after travel",
    },
    "2026-09-06",
  );
  saveCheckin(state, { date: "2026-09-06", waterMl: 750 }, "2026-09-06");
  assert.equal(state.health.checkins.length, 1);
  assert.equal(state.health.checkins[0].sleepHours, 6.5);
  assert.equal(state.health.checkins[0].notes, "Tired after travel");
  assert.equal(state.health.checkins[0].soreness, null);
  const view = dailyHealth(state, "2026-09-06");
  assert.equal(view.recoveryFocus, true);
  assert.equal(
    view.priorities.some((p) => p.id === "recovery"),
    true,
  );
  assert.equal(view.sleepSamples, 1);
  assert.equal(view.sleepAverage, null, "one night is not an average");
  saveCheckin(state, { date: "2026-09-05", sleepHours: 0 }, "2026-09-06");
  for (const date of ["2026-09-02", "2026-09-03"])
    saveCheckin(state, { date, sleepHours: 7.2 }, "2026-09-06");
  assert.equal(dailyHealth(state, "2026-09-06").sleepAverage, null);
  saveCheckin(state, { date: "2026-09-01", sleepHours: 7.2 }, "2026-09-06");
  saveCheckin(state, { date: "2026-09-04", sleepHours: 7 }, "2026-09-06");
  const average = dailyHealth(state, "2026-09-06");
  assert.equal(average.sleepSamples, 6);
  // (6.5 + 0 + 3 x 7.2 + 7) / 6: 5 h 51 min, to the minute.
  assert.equal(
    average.sleepAverage,
    351 / 60,
    "explicit zero is a recorded observation",
  );
  assert.equal(
    dailyHealth(state, "2026-09-07").recoveryFocus,
    false,
    "yesterday's low energy is not presented as today's",
  );
});
test("sleep averages need five nights, and differences round to 15 minutes", () => {
  assert.equal(sleepAverage([7, 7, 7, 7]), null);
  assert.equal(sleepAverage([7, 7, 7, 7, 8]), 7.2);
  assert.equal(sleepAverage([6, 6, 6, 6, 6.01]), 6);
  assert.equal(aboutSleepDifference(0.12), null);
  assert.equal(aboutSleepDifference(0.13), "about 15 min");
  assert.equal(aboutSleepDifference(-0.7), "about 45 min");
  assert.equal(aboutSleepDifference(1.2), "about 1 h 15 min");
  assert.equal(aboutSleepDifference(2), "about 2 h");
});
test("health validation rejects invalid units, dates and duplicate days", () => {
  for (const patch of [
    { date: "2026-02-30", energy: 3 },
    { date: "2026-09-07", energy: 2 },
    { date: "2026-09-06", sleepHours: 25 },
    { date: "2026-09-06", energy: 0 },
    { date: "2026-09-06", waterMl: -1 },
    { date: "2026-09-06", bodyweight: NaN },
    { date: "2026-09-06" },
  ])
    assert.throws(() => saveCheckin(emptyJournal(), patch, "2026-09-06"));
  const state = emptyJournal();
  const c = saveCheckin(state, { date: "2026-09-06", energy: 3 }, "2026-09-06");
  assert.throws(() => healthSchema.parse({ checkins: [c, c] }), /one check-in/);
});
test("health backups are lossless, conflicts explicit and agent proposals do not change source data", () => {
  const state = emptyJournal();
  const prepared = prepareAction(
    state,
    {
      kind: "record_checkin",
      checkin: {
        date: "2026-09-06",
        sleepHours: 8,
        bodyweight: 80,
        notes: "Feeling good",
      },
    },
    "2026-09-06",
  );
  assert.equal(state.health.checkins.length, 0);
  assert.equal(prepared.checkin?.sleepHours, 8);
  assert.equal(prepared.state.profile.bodyweight, state.profile.bodyweight);
  const restored = mergeImport(
    emptyJournal(),
    parseLegacyBackup(backup(prepared.state)),
  );
  assert.deepEqual(restored.health, prepared.state.health);
  assert.equal(mergeImport(restored, restored).health.checkins.length, 1);
  const conflict = structuredClone(restored);
  conflict.health.checkins[0].sleepHours = 7;
  assert.throws(() => mergeImport(restored, conflict), /different check-in/);
  const legacy = { ...backup(state), data: { ...state, health: undefined } };
  assert.deepEqual(parseLegacyBackup(legacy).health, { checkins: [] });
});
