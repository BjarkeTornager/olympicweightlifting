import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionSchema } from "../lib/agent/action-schema";
import { requireCurrentCoach } from "../lib/agent/http";
import { createWorkout, days, emptyJournal } from "../lib/domain";
import {
  applyVitals,
  applyWorkout,
  cardioFromWorkout,
  entryDigest,
  healthSyncSchema,
  type HealthWorkout,
} from "../lib/health-sync";
import { addDrink } from "../lib/hydration";
import { journalSchema } from "../lib/model";
import {
  actionRequest,
  buildCoach,
  buildJournal,
  buildToday,
  buildTrends,
  nativeAction,
} from "../lib/native-api";
import { nativeClient } from "../lib/native-client";
import { nativeFixtures } from "../lib/native-fixtures";
import { fixturesPath, openApiPath, openApiText } from "../lib/native-openapi";

const date = "2026-09-26";
const now = new Date("2026-09-26T18:00:00Z");
const tz = "Europe/Copenhagen";
const withClient = (value?: string, extra: Record<string, string> = {}) =>
  new Request("https://example.test/api", {
    headers: { ...(value ? { "X-Client": value } : {}), ...extra },
  });

test("the committed OpenAPI document matches the server's schemas", () => {
  assert.equal(
    readFileSync(openApiPath, "utf8"),
    openApiText(),
    "Run `npm run openapi` and commit the result.",
  );
  for (const [name, value] of Object.entries(nativeFixtures()))
    assert.deepEqual(
      JSON.parse(readFileSync(`${fixturesPath}/${name}`, "utf8")),
      value,
      `${name} is stale. Run \`npm run openapi\`.`,
    );
  const schemas = JSON.parse(openApiText()).components.schemas;
  // Field names are never mistaken for schema keywords.
  assert.ok(schemas.ActionRequest.required.includes("id"));
  assert.ok(schemas.HealthWorkout.required.includes("id"));
});

test("installed builds are recognised and gated by build number, not web headers", () => {
  assert.deepEqual(nativeClient(withClient("ios/0.1/7")), {
    platform: "ios",
    version: "0.1",
    build: 7,
  });
  assert.equal(nativeClient(withClient("ios/0.1")), null);
  assert.equal(nativeClient(withClient("android/0.1/7")), null);
  // A supported build needs none of the website's feature headers.
  assert.doesNotThrow(() => requireCurrentCoach(withClient("ios/0.1/1")));
  assert.throws(() => requireCurrentCoach(withClient()), /Refresh the website/);
  assert.doesNotThrow(() =>
    requireCurrentCoach(
      withClient(undefined, {
        "X-Coach-Journal-Version": "1",
        "X-Training-Programs-Version": "2",
      }),
    ),
  );
});

test("every action the app can send is a valid journal action", () => {
  const examples = [
    { kind: "log_drink", drink: { date, ml: 250, kind: "water" } },
    { kind: "delete_drink", drinkId: crypto.randomUUID() },
    { kind: "record_checkin", checkin: { date, energy: 4, soreness: 2 } },
    { kind: "delete_cardio", cardioId: crypto.randomUUID() },
    { kind: "start_programme", dayId: days[0].id, date },
    {
      kind: "log_sets",
      exerciseId: "snatch",
      sets: [{ weight: 60, reps: 2, result: "success" }],
    },
    { kind: "finish_workout" },
    { kind: "discard_workout" },
  ];
  assert.equal(examples.length, nativeAction.options.length);
  for (const action of examples) {
    actionRequest.parse({ id: crypto.randomUUID(), timezone: tz, action });
    assert.doesNotThrow(() => actionSchema.parse(action), action.kind);
  }
});

test("Today and the journal feed describe the day for the app", () => {
  const state = emptyJournal();
  addDrink(state, { date, ml: 500, kind: "water" }, now);
  state.health.vitals = [
    {
      date,
      restingHeartRate: 52,
      heartRateVariabilityMs: 61.4,
      averageHeartRate: 71,
      steps: 9120,
      activeEnergyKcal: 540,
      source: "apple-health",
      updatedAt: now.toISOString(),
    },
  ];
  const run = cardioFromWorkout(workout(), tz, now);
  state.cardio.sessions.push(run);
  state.activeWorkout = createWorkout(state, days[0], date);
  journalSchema.parse(state);
  const today = buildToday(state, 3, date, new Set([run.id]));
  assert.equal(today.hydration.totalMl, 500);
  assert.equal(today.vitals?.restingHeartRate, 52);
  assert.equal(today.activities[0].fromAppleHealth, true);
  assert.equal(today.activities[0].averageHeartRate, 148);
  assert.equal(today.activeWorkout?.title, days[0].title);
  assert.equal(today.nextSession, undefined);
  assert.equal("checkin" in today, false, "absent values are omitted");
  const feed = buildJournal(state, 3, "2026-09-27", 14, new Set([run.id]));
  assert.deepEqual(
    feed.items.map((i) => i.kind),
    ["cardio", "vitals"],
  );
  assert.match(feed.items[0].detail, /10 km · 148 bpm avg/);
  assert.equal(feed.nextBefore, undefined);
});

test("Coach history shows voice turns and each save's state", () => {
  const view = buildCoach(
    [
      {
        id: "a",
        question: "[voice] Logged my run",
        photoIds: [],
        createdAt: now.toISOString(),
        status: "done",
        reply: "Saved.",
        proposals: [
          {
            id: "p1",
            title: "Run",
            detail: "10 km",
            status: "saved",
            expiresAt: now.toISOString(),
          },
          {
            id: "p2",
            title: "Meal",
            detail: "Oats",
            expiresAt: "2026-09-25T00:00:00Z",
          },
        ],
      },
    ],
    now,
  );
  assert.equal(view.turns[0].question, "Logged my run");
  assert.equal(view.turns[0].fromVoice, true);
  assert.deepEqual(
    view.turns[0].receipts.map((r) => r.state),
    ["saved", "expired"],
  );
});

function workout(overrides: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    id: "6f0a3f8e-2a51-4c1e-9d0b-0c1f7c1e2a10",
    kind: "running",
    name: "Outdoor Run",
    start: "2026-09-26T06:30:00+02:00",
    end: "2026-09-26T07:20:00+02:00",
    durationSeconds: 3000,
    distanceKm: 10.0004,
    caloriesKcal: 612.4,
    averageHeartRate: 148,
    maxHeartRate: 171,
    ...overrides,
  };
}

test("Apple Health workouts import once, update until edited, and respect deletion", () => {
  const state = emptyJournal();
  const imported = new Set<string>();
  const first = applyWorkout(state, workout(), undefined, imported, tz, now);
  assert.equal(first.result, "imported");
  assert.equal(state.cardio.sessions.length, 1);
  const entry = state.cardio.sessions[0];
  assert.equal(entry.id, workout().id);
  assert.equal(entry.distanceKm, 10);
  assert.equal(entry.caloriesKcal, 612);
  assert.equal(entry.date, date);
  const receipt = { userId: "u", ...first.receipt! };
  // The same workout again changes nothing.
  assert.equal(
    applyWorkout(state, workout(), receipt, imported, tz, now).result,
    "unchanged",
  );
  // A corrected workout replaces an untouched import.
  const corrected = applyWorkout(
    state,
    workout({ distanceKm: 10.2 }),
    receipt,
    imported,
    tz,
    now,
  );
  assert.equal(corrected.result, "updated");
  assert.equal(state.cardio.sessions[0].distanceKm, 10.2);
  // Once the athlete edits it, their version wins.
  const edited = { userId: "u", ...corrected.receipt! };
  state.cardio.sessions[0] = { ...state.cardio.sessions[0], title: "Easy run" };
  assert.equal(
    applyWorkout(
      state,
      workout({ distanceKm: 10.3 }),
      edited,
      imported,
      tz,
      now,
    ).result,
    "preserved",
  );
  assert.equal(state.cardio.sessions[0].title, "Easy run");
  // Deleted from the journal: a later delivery does not bring it back.
  state.cardio.sessions = [];
  assert.equal(
    applyWorkout(
      state,
      workout({ distanceKm: 10.4 }),
      edited,
      imported,
      tz,
      now,
    ).result,
    "preserved",
  );
  assert.equal(state.cardio.sessions.length, 0);
  assert.equal(entryDigest(cardioFromWorkout(workout(), tz, now)).length, 64);
});

test("a workout already logged by hand is enriched rather than duplicated", () => {
  const state = emptyJournal();
  const manual = cardioFromWorkout(
    workout({
      id: crypto.randomUUID(),
      durationSeconds: 3120,
      averageHeartRate: undefined,
      maxHeartRate: undefined,
      caloriesKcal: undefined,
    }),
    tz,
    now,
  );
  manual.title = "Morning run";
  state.cardio.sessions.push(manual);
  const outcome = applyWorkout(state, workout(), undefined, new Set(), tz, now);
  assert.equal(outcome.result, "matched");
  assert.equal(state.cardio.sessions.length, 1);
  assert.equal(state.cardio.sessions[0].title, "Morning run");
  assert.equal(state.cardio.sessions[0].averageHeartRate, 148);
  assert.equal(state.cardio.sessions[0].caloriesKcal, 612);
});

test("strength workouts on a logged lifting day are skipped; future workouts wait", () => {
  const state = emptyJournal();
  state.sessions.push({ ...createWorkout(state, days[0], date) });
  const strength = workout({
    id: crypto.randomUUID(),
    kind: "strength",
    name: "Traditional Strength Training",
    distanceKm: undefined,
  });
  assert.equal(
    applyWorkout(state, strength, undefined, new Set(), tz, now).result,
    "skipped",
  );
  const tomorrow = workout({
    id: crypto.randomUUID(),
    start: "2026-09-27T06:30:00+02:00",
    end: "2026-09-27T07:20:00+02:00",
  });
  const later = applyWorkout(state, tomorrow, undefined, new Set(), tz, now);
  assert.equal(later.result, "skipped");
  assert.equal(later.receipt, undefined, "retried on the next sync");
  assert.equal(state.cardio.sessions.length, 0);
});

test("daily heart-rate summaries replace the day's previous summary", () => {
  const state = emptyJournal();
  assert.equal(applyVitals(state, { date, restingHeartRate: 54 }, now), true);
  assert.equal(applyVitals(state, { date, restingHeartRate: 54 }, now), false);
  assert.equal(
    applyVitals(state, { date, restingHeartRate: 53, steps: 8000 }, now),
    true,
  );
  assert.equal(applyVitals(state, { date: "2026-09-25" }, now), false);
  assert.equal(state.health.vitals?.length, 1);
  assert.equal(state.health.vitals?.[0].restingHeartRate, 53);
  journalSchema.parse(state);
  assert.throws(() =>
    healthSyncSchema.parse({ timezone: tz, days: [{ date, extra: 1 }] }),
  );
});

test("trends give one row per day, oldest first, with gaps left empty", () => {
  const state = emptyJournal();
  applyVitals(state, { date, restingHeartRate: 51, steps: 9000 }, now);
  addDrink(state, { date: "2026-09-25", ml: 750, kind: "water" }, now);
  state.cardio.sessions.push(cardioFromWorkout(workout(), tz, now));
  const trends = buildTrends(state, date, 3);
  assert.deepEqual(
    trends.days.map((d) => d.date),
    ["2026-09-24", "2026-09-25", "2026-09-26"],
  );
  assert.equal(trends.days[0].restingHeartRate, undefined);
  assert.equal(trends.days[1].waterMl, 750);
  assert.equal(trends.days[2].restingHeartRate, 51);
  assert.equal(trends.days[2].cardioMinutes, 50);
  assert.equal(trends.days[2].waterMl, undefined, "no drinks is not 0 ml");
});
