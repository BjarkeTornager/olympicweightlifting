import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { calculateImportedSleep } from "../lib/apple-health";
import { applySleepImport } from "../lib/apple-health-store";
import { emptyJournal, createWorkout, days } from "../lib/domain";
import { saveCheckin } from "../lib/health";
import { foodSnapshotForClient } from "../lib/food-compatibility";
import {
  missingReminderTopics,
  reminderDue,
  supportedPushEndpoint,
  reminderPreferencesSchema,
} from "../lib/reminders";

const now = new Date("2026-09-19T10:00:00Z");
const payload = (samples: unknown[]) => ({
  date: "2026-09-19",
  timezone: "Europe/Copenhagen",
  samples,
});
const sample = (start: string, end: string, value = "asleep") => ({
  start,
  end,
  value,
});

test("sleep import merges overlapping sources/stages without counting awake or in-bed time", () => {
  const sleep = calculateImportedSleep(
    payload([
      sample("2026-09-18T23:00:00+02:00", "2026-09-19T07:00:00+02:00", "inBed"),
      sample("2026-09-18T23:30:00+02:00", "2026-09-19T03:00:00+02:00", "core"),
      sample("2026-09-19T01:00:00+02:00", "2026-09-19T03:00:00+02:00", "deep"),
      sample("2026-09-19T03:00:00+02:00", "2026-09-19T03:30:00+02:00", "awake"),
      sample("2026-09-19T03:30:00+02:00", "2026-09-19T06:30:00+02:00", "rem"),
    ]),
    now,
  );
  assert.equal(sleep.hours, 6.5);
  assert.equal(sleep.date, "2026-09-19");
  assert.equal(sleep.intervals.length, 2);
});
test("sleep import takes one source per night, preferring an Apple Watch", () => {
  const from = (
    source: string,
    start: string,
    end: string,
    value = "core",
  ) => ({
    ...sample(start, end, value),
    source,
  });
  const watch = [
    from(
      "Apple Watch",
      "2026-09-18T23:30:00+02:00",
      "2026-09-19T03:00:00+02:00",
    ),
    from(
      "Apple Watch",
      "2026-09-19T03:00:00+02:00",
      "2026-09-19T03:20:00+02:00",
      "awake",
    ),
    from(
      "Apple Watch",
      "2026-09-19T03:20:00+02:00",
      "2026-09-19T06:30:00+02:00",
      "rem",
    ),
  ];
  // An app on the phone records a longer night, and the iPhone the time in bed.
  const app = from(
    "AutoSleep",
    "2026-09-18T22:30:00+02:00",
    "2026-09-19T07:00:00+02:00",
    "asleep",
  );
  const bed = from(
    "iPhone",
    "2026-09-18T22:00:00+02:00",
    "2026-09-19T07:30:00+02:00",
    "inBed",
  );
  const night = calculateImportedSleep(payload([app, bed, ...watch]), now);
  assert.equal(night.source, "Apple Watch");
  assert.equal(night.hours, 6 + 40 / 60, "the watch's night, not the union");
  assert.equal(night.start, "2026-09-18T21:30:00.000Z");
  // Without a watch, the source with the most time asleep.
  const other = from(
    "Pillow",
    "2026-09-18T23:00:00+02:00",
    "2026-09-19T05:00:00+02:00",
    "asleep",
  );
  const apps = calculateImportedSleep(payload([other, app, bed]), now);
  assert.equal(apps.source, "AutoSleep");
  assert.equal(apps.hours, 8.5);
  // The Shortcut and older apps name no source: their samples merge as before.
  const unnamed = calculateImportedSleep(
    payload([sample(app.start, app.end), sample(other.start, other.end)]),
    now,
  );
  assert.equal(unnamed.source, undefined);
  assert.equal(unnamed.hours, 8.5);
  assert.throws(
    () => calculateImportedSleep(payload([bed]), now),
    /No time asleep/,
  );
  assert.throws(() =>
    calculateImportedSleep(payload([{ ...app, source: "x".repeat(61) }]), now),
  );
});
test("a watch that recorded only part of the night gives way to a full one from an app", () => {
  const from = (source: string, start: string, end: string, value: string) => ({
    ...sample(start, end, value),
    source,
  });
  const ring = from(
    "Oura",
    "2026-09-18T23:00:00+02:00",
    "2026-09-19T07:00:00+02:00",
    "asleep",
  );
  // The watch ran flat at 01:30.
  const flat = calculateImportedSleep(
    payload([
      ring,
      from(
        "Apple Watch",
        "2026-09-18T23:00:00+02:00",
        "2026-09-19T01:30:00+02:00",
        "core",
      ),
    ]),
    now,
  );
  assert.equal(flat.source, "Oura");
  assert.equal(flat.hours, 8);
  // Only a 25-minute nap on the watch the afternoon before.
  const nap = calculateImportedSleep(
    payload([
      ring,
      from(
        "Apple Watch",
        "2026-09-18T15:00:00+02:00",
        "2026-09-18T15:25:00+02:00",
        "asleep",
      ),
    ]),
    now,
  );
  assert.equal(nap.source, "Oura");
  assert.equal(nap.hours, 8);
  // Three quarters of the ring's night is enough for the watch.
  const most = calculateImportedSleep(
    payload([
      ring,
      from(
        "Apple Watch",
        "2026-09-18T23:00:00+02:00",
        "2026-09-19T05:00:00+02:00",
        "core",
      ),
    ]),
    now,
  );
  assert.equal(most.source, "Apple Watch");
  assert.equal(most.hours, 6);
});
test("an imported night keeps its source, which older web clients don't see", () => {
  const night = calculateImportedSleep(
    payload([
      {
        ...sample("2026-09-18T23:00:00+02:00", "2026-09-19T06:00:00+02:00"),
        source: "Apple Watch",
      },
    ]),
    now,
  );
  const state = emptyJournal();
  const outcome = applySleepImport(state, undefined, night, now);
  assert.equal(outcome.result, "imported");
  const imported = state.health.checkins[0].sleepImport!;
  assert.equal(imported.source, "Apple Watch");
  // A night without a source keeps the digest it always had, so nights
  // imported before sources are not imported again.
  const { source, ...unnamed } = night;
  void source;
  const plain = applySleepImport(emptyJournal(), undefined, unnamed, now);
  assert.equal(
    plain.digest,
    createHash("sha256")
      .update(
        JSON.stringify({
          date: night.date,
          timezone: night.timezone,
          intervals: night.intervals,
        }),
      )
      .digest("hex"),
  );
  assert.notEqual(outcome.digest, plain.digest, "the source is in the digest");
  const snapshot = (version?: string) =>
    foodSnapshotForClient(
      new Request("https://journal.example.test/api/journal", {
        headers: version ? { "X-Sleep-Import-Version": version } : {},
      }),
      { state, revision: 1 },
    ).state.health.checkins[0].sleepImport;
  assert.equal(snapshot("2")?.source, "Apple Watch");
  assert.ok(snapshot("1"));
  assert.equal(snapshot("1")?.source, undefined);
  assert.equal(snapshot(), undefined);
  assert.equal(
    state.health.checkins[0].sleepImport?.source,
    "Apple Watch",
    "adapting a response leaves the stored night alone",
  );
});
test("sleep import uses elapsed time across daylight-saving changes", () => {
  for (const [date, start, end, hours] of [
    ["2026-03-29", "2026-03-28T23:00:00+01:00", "2026-03-29T07:00:00+02:00", 7],
    ["2026-10-25", "2026-10-24T23:00:00+02:00", "2026-10-25T07:00:00+01:00", 9],
  ] as const)
    assert.equal(
      calculateImportedSleep(
        { date, timezone: "Europe/Copenhagen", samples: [sample(start, end)] },
        new Date(`${date}T10:00:00Z`),
      ).hours,
      hours,
    );
});
test("sleep import rejects invalid, future, old, empty and out-of-window samples", () => {
  const valid = sample(
    "2026-09-18T23:00:00+02:00",
    "2026-09-19T07:00:00+02:00",
  );
  for (const input of [
    payload([]),
    payload([{ ...valid, value: "inBed" }]),
    payload([{ ...valid, value: "guess" }]),
    payload([{ ...valid, start: valid.end }]),
    payload([{ ...valid, start: "2026-09-18T11:00:00+02:00" }]),
    payload([{ ...valid, end: "2026-09-19T15:00:00+02:00" }]),
    { ...payload([valid]), date: "2026-09-20" },
    { ...payload([valid]), date: "2026-08-01" },
    { ...payload([valid]), timezone: "Not/AZone" },
    { ...payload([valid]), accountId: "other" },
  ])
    assert.throws(() => calculateImportedSleep(input, now));
});
test("manual sleep edits clear imported provenance; unrelated measurements preserve it", () => {
  const state = emptyJournal();
  const checkin = saveCheckin(
    state,
    { date: "2026-09-19", sleepHours: 8 },
    "2026-09-19",
  );
  checkin.sleepImport = {
    provider: "apple-health",
    digest: "a".repeat(64),
    start: "2026-09-18T21:00:00Z",
    end: "2026-09-19T05:00:00Z",
    importedAt: now.toISOString(),
  };
  saveCheckin(state, { date: "2026-09-19", energy: 4 }, "2026-09-19");
  assert.ok(state.health.checkins[0].sleepImport);
  const legacy = foodSnapshotForClient(
    new Request("https://journal.example.test/api/journal"),
    { state, revision: 1 },
  );
  assert.equal(legacy.state.health.checkins[0].sleepImport, undefined);
  assert.equal(legacy.state.health.checkins[0].sleepHours, 8);
  assert.ok(
    state.health.checkins[0].sleepImport,
    "Adapting an old client response must not mutate the stored source",
  );
  const current = foodSnapshotForClient(
    new Request("https://journal.example.test/api/journal", {
      headers: { "X-Sleep-Import-Version": "1" },
    }),
    { state, revision: 1 },
  );
  assert.ok(current.state.health.checkins[0].sleepImport);
  saveCheckin(state, { date: "2026-09-19", sleepHours: 8 }, "2026-09-19");
  assert.equal(state.health.checkins[0].sleepImport, undefined);
});
test("reminders respect local time, date, DST and a bounded catch-up window", () => {
  const preferences = reminderPreferencesSchema.parse({
    time: "20:00",
    timezone: "Europe/Copenhagen",
    topics: ["sleep"],
  });
  assert.equal(
    reminderDue(preferences, null, new Date("2026-09-19T17:59:00Z")),
    null,
  );
  assert.equal(
    reminderDue(preferences, null, new Date("2026-09-19T18:00:00Z")),
    "2026-09-19",
  );
  assert.equal(
    reminderDue(preferences, "2026-09-19", new Date("2026-09-19T18:02:00Z")),
    null,
  );
  assert.equal(
    reminderDue(preferences, null, new Date("2026-09-19T19:30:00Z")),
    null,
  );
  const rollback = { ...preferences, time: "02:30" };
  assert.equal(
    reminderDue(rollback, null, new Date("2026-10-25T00:30:00Z")),
    "2026-10-25",
  );
  assert.equal(
    reminderDue(rollback, "2026-10-25", new Date("2026-10-25T01:30:00Z")),
    null,
  );
});
test("missing records do not imply zero intake or a missed workout", () => {
  const state = emptyJournal();
  const topics = ["food", "sleep", "workout"] as const;
  assert.deepEqual(missingReminderTopics(state, "2026-09-19", [...topics]), [
    "food",
    "sleep",
  ]);
  saveCheckin(state, { date: "2026-09-19", sleepHours: 0 }, "2026-09-19");
  state.nutrition.completeDays = ["2026-09-19"];
  assert.deepEqual(missingReminderTopics(state, "2026-09-19", [...topics]), []);
  state.activeWorkout = createWorkout(state, days[0], "2026-09-19");
  assert.deepEqual(missingReminderTopics(state, "2026-09-19", [...topics]), [
    "workout",
  ]);
  assert.deepEqual(missingReminderTopics(state, "2026-09-20", ["workout"]), []);
});
test("push subscription destinations cannot target internal or arbitrary services", () => {
  for (const url of [
    "https://web.push.apple.com/Qabc",
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
  ])
    assert.equal(supportedPushEndpoint(url), true);
  for (const url of [
    "http://web.push.apple.com/abc",
    "https://web.push.apple.com.evil.test/abc",
    "https://127.0.0.1/abc",
    "https://railway.internal/abc",
    "https://web.push.apple.com:444/abc",
    "https://u:p@web.push.apple.com/abc",
  ])
    assert.equal(supportedPushEndpoint(url), false);
});
