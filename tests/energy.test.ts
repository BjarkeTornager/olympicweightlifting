import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { saveCardio } from "../lib/cardio";
import {
  burnText,
  burnedToday,
  cardioBurn,
  dayBurn,
  strengthBurn,
} from "../lib/energy";
import { dayForCoach, describeDay } from "../lib/journal-summary";
import type { Workout } from "../lib/model";

const date = "2026-09-28";

function journal(weight = 80) {
  const s = emptyJournal();
  s.profile.bodyweight = weight;
  return s;
}

test("a watch measurement is used as recorded", () => {
  const s = journal();
  const e = saveCardio(
    s,
    { date, activity: "rowing", durationSeconds: 900, caloriesKcal: 88 },
    date,
  );
  assert.deepEqual(cardioBurn(s, e), {
    kcal: 88,
    estimated: false,
    method: "measured",
  });
  assert.equal(burnText(cardioBurn(s, e)), "88 kcal");
});

test("an activity logged without calories is estimated and marked", () => {
  const s = journal(80);
  const e = saveCardio(
    s,
    { date, activity: "other", title: "StairMaster", durationSeconds: 1200 },
    date,
  );
  // 9 METs × 80 kg × 1/3 h
  assert.deepEqual(cardioBurn(s, e), {
    kcal: 240,
    estimated: true,
    method: "activity and duration",
  });
  assert.equal(burnText(cardioBurn(s, e)), "~240 kcal est.");
});

test("no bodyweight means no estimate rather than a guess", () => {
  const s = emptyJournal();
  const e = saveCardio(
    s,
    { date, activity: "walking", durationSeconds: 1800 },
    date,
  );
  assert.equal(cardioBurn(s, e), null);
  assert.equal(burnText(null), "");
});

test("heart rate refines the estimate when age and sex are known", () => {
  const s = journal(80);
  s.profile.body = { ...(s.profile.body ?? {}), age: 35, sex: "male" } as never;
  const e = saveCardio(
    s,
    { date, activity: "cycling", durationSeconds: 1800, averageHeartRate: 140 },
    date,
  );
  const burn = cardioBurn(s, e)!;
  assert.equal(burn.method, "heart rate");
  assert.ok(burn.kcal > 300 && burn.kcal < 450, String(burn.kcal));
});

test("a timed strength session is estimated; an open-ended one is not", () => {
  const s = journal(100);
  const w = {
    id: crypto.randomUUID(),
    date,
    title: "Snatch day",
    exercises: [],
    startedAt: "2026-09-28T16:00:00.000Z",
    finishedAt: "2026-09-28T17:30:00.000Z",
  } as unknown as Workout;
  // 5 METs × 100 kg × 1.5 h
  assert.equal(strengthBurn(s, w)?.kcal, 750);
  assert.equal(
    strengthBurn(s, { ...w, finishedAt: "2026-09-29T09:00:00.000Z" }),
    null,
  );
  assert.equal(strengthBurn(s, { ...w, finishedAt: undefined }), null);
});

test("Coach sees each activity's calories and the day's total", () => {
  const s = journal(80);
  saveCardio(
    s,
    { date, activity: "rowing", durationSeconds: 900, caloriesKcal: 88 },
    date,
  );
  saveCardio(
    s,
    { date, activity: "other", title: "StairMaster", durationSeconds: 1200 },
    date,
  );
  const day = dayForCoach(s, date);
  assert.deepEqual(
    day.activities.map((a) => [a.calories_kcal, a.calories_estimated]),
    [
      [88, false],
      [240, true],
    ],
  );
  assert.deepEqual(day.burnedInTraining, {
    kcal: 328,
    includes_estimates: true,
  });
  assert.deepEqual(dayBurn(s, date), { kcal: 328, estimated: true, count: 2 });
  assert.match(describeDay(day), /about 240 kcal estimated/);
  assert.match(describeDay(day), /15 min, 88 kcal/);
});

test("Today's burned total prefers Apple Health's active energy", () => {
  const s = journal(80);
  assert.equal(burnedToday(s, date), null);
  saveCardio(
    s,
    { date, activity: "other", title: "StairMaster", durationSeconds: 1200 },
    date,
  );
  assert.deepEqual(burnedToday(s, date), {
    kcal: 240,
    source: "training",
    estimated: true,
  });
  s.health.vitals = [{ date, activeEnergyKcal: 610 } as never];
  assert.deepEqual(burnedToday(s, date), {
    kcal: 610,
    source: "apple-health",
    estimated: false,
  });
  // Yesterday's active energy is not today's.
  s.health.vitals = [{ date: "2026-09-27", activeEnergyKcal: 610 } as never];
  assert.equal(burnedToday(s, date)?.source, "training");
});
