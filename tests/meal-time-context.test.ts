import { test } from "node:test";
import assert from "node:assert/strict";
import { imageTiming, localClock } from "../lib/agent/time-context";

test("meal timing uses the athlete's local date and clock across midnight and fractional offsets", () => {
  const at = "2026-09-07T22:30:00Z";
  assert.deepEqual(localClock(at, "Europe/Copenhagen"), {
    date: "2026-09-08",
    time: "00:30",
    timezone: "Europe/Copenhagen",
  });
  assert.deepEqual(localClock(at, "America/Los_Angeles"), {
    date: "2026-09-07",
    time: "15:30",
    timezone: "America/Los_Angeles",
  });
  assert.deepEqual(localClock(at, "Asia/Kolkata"), {
    date: "2026-09-08",
    time: "04:00",
    timezone: "Asia/Kolkata",
  });
});

test("meal timing respects daylight-saving transitions instead of a fixed UTC offset", () => {
  assert.equal(
    localClock("2026-03-29T00:30:00Z", "Europe/Copenhagen").time,
    "01:30",
  );
  assert.equal(
    localClock("2026-03-29T01:30:00Z", "Europe/Copenhagen").time,
    "03:30",
  );
  assert.equal(
    localClock("2026-10-25T00:30:00Z", "Europe/Copenhagen").time,
    "02:30",
  );
  assert.equal(
    localClock("2026-10-25T01:30:00Z", "Europe/Copenhagen").time,
    "02:30",
  );
});

test("a backdated meal photo does not inherit the hour it was uploaded", () => {
  const timing = imageTiming(
    { date: "2026-09-07", createdAt: "2026-09-08T06:15:00Z" },
    "Europe/Copenhagen",
  );
  assert.equal(timing.libraryDate, "2026-09-07");
  assert.equal(timing.uploadedLocal.date, "2026-09-08");
  assert.equal(timing.uploadedLocal.time, "08:15");
  assert.equal(timing.mealTimeHint, null);
});

test("same-local-day upload time remains a weak meal hint, including around UTC midnight", () => {
  const timing = imageTiming(
    { date: "2026-09-08", createdAt: "2026-09-07T22:30:00Z" },
    "Europe/Copenhagen",
  );
  assert.equal(timing.mealTimeHint, "00:30");
  assert.equal(timing.uploadedAt, "2026-09-07T22:30:00.000Z");
  assert.match(timing.timingNote, /not a confirmed eating or capture time/);
});
