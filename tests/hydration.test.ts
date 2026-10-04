import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, days, emptyJournal } from "../lib/domain";
import {
  addDrink,
  drinkKinds,
  drinksForOlderApps,
  hydrationForCoach,
  hydrationForDay,
  hydrationNote,
  hydrationTargetMl,
  moveCheckinWater,
  removeDrink,
  retainDrinkDetails,
  trainingMinutes,
  usualHydrationTargets,
} from "../lib/hydration";
import { prepareAction } from "../lib/agent/actions";
import { saveCardio } from "../lib/cardio";
import { cardioFromWorkout } from "../lib/health-sync";
import { foodSnapshotForClient } from "../lib/food-compatibility";
import { journalSchema, type JournalState } from "../lib/model";
import { dayForCoach, describeDay } from "../lib/journal-summary";

const date = "2026-09-26";

// Only the body details the drinks target reads.
const withBody = (
  s: JournalState,
  sex: "male" | "female" | "unspecified",
  weightKg: number,
  extra: Record<string, unknown> = {},
) => {
  s.profile.body = { sex, weightKg, ...extra } as never;
  return s;
};

const meal = {
  date,
  name: "Glass of red wine",
  type: "dinner",
  items: [
    {
      name: "Red wine",
      portion: "150 ml",
      calories: 125,
      protein: 0,
      carbs: 4,
      fat: 0,
    },
  ],
  source: "text",
  estimated: true,
  notes: "",
  photoIds: [],
};

test("drinks add up through the day and can be removed", () => {
  const s = emptyJournal();
  const water = addDrink(s, { date, ml: 500, kind: "water" });
  addDrink(s, { date, ml: 250, kind: "coffee" });
  addDrink(s, { date: "2026-09-25", ml: 1000, kind: "water" });
  assert.equal(hydrationForDay(s, date).totalMl, 750);
  removeDrink(s, water.id);
  assert.equal(hydrationForDay(s, date).totalMl, 250);
  assert.throws(() => removeDrink(s, water.id), /not in your journal/);
  journalSchema.parse(s);
});

test("the target is a drinks target from weight and sex, in quarter litres", () => {
  // The worked cases: rest day, then a lifting day of 75 minutes.
  for (const [sex, kg, rest, lifting] of [
    ["female", 60, 1750, 2500],
    ["male", 88, 2250, 3000],
    ["male", 140, 2750, 3500],
    ["female", 49, 1750, 2500],
  ] as const) {
    const s = withBody(emptyJournal(), sex, kg, { sessionMinutes: 75 });
    assert.equal(hydrationTargetMl(s, date).targetMl, rest, `${sex} ${kg}`);
    assert.deepEqual(usualHydrationTargets(s, date), {
      restDayMl: rest,
      liftingDayMl: lifting,
    });
    s.sessions.push(createWorkout(s, days[0], date));
    assert.equal(hydrationTargetMl(s, date).targetMl, lifting, `${sex} ${kg}`);
  }
  // Without a weight, a general base, marked as an estimate.
  assert.deepEqual(hydrationTargetMl(emptyJournal(), date), {
    targetMl: 2000,
    lowMl: 1500,
    highMl: 2500,
    trainingMinutes: 0,
    estimated: true,
    hidden: false,
  });
  // A range of about half a litre either side, never below 1.5 L.
  const s = withBody(emptyJournal(), "male", 88);
  assert.deepEqual(
    [hydrationForDay(s, date).lowMl, hydrationForDay(s, date).highMl],
    [1750, 2750],
  );
});

test("targets stay within bounds for weights from 1 to 1,000 kg, on every weight path", () => {
  for (let kg = 1; kg <= 1000; kg += kg < 40 ? 1 : 7) {
    const paths = [
      // Settings accepts 0 to 1,000 kg.
      (s: JournalState) => (s.profile.bodyweight = kg),
      (s: JournalState) => withBody(s, "male", kg),
      (s: JournalState) =>
        s.health.checkins.push({
          date,
          sleepHours: null,
          energy: null,
          soreness: null,
          waterMl: null,
          bodyweight: kg,
          notes: "",
          updatedAt: new Date().toISOString(),
        }),
    ];
    for (const set of paths) {
      const s = emptyJournal();
      set(s);
      const rest = hydrationTargetMl(s, date);
      assert.ok(rest.targetMl >= 1500 && rest.targetMl <= 4500, `${kg} kg`);
      assert.equal(rest.targetMl % 250, 0);
      assert.ok(rest.lowMl >= 1500 && rest.highMl === rest.targetMl + 500);
      // Training adds at most 2 L on top.
      saveCardio(
        s,
        { activity: "cycling", date, durationSeconds: 6 * 3600 },
        date,
      );
      const busy = hydrationTargetMl(s, date);
      assert.ok(busy.targetMl <= rest.targetMl + 2000, `${kg} kg training`);
      assert.ok(busy.targetMl <= 6500);
    }
  }
});

// A strength workout from the Apple Watch, as HealthSync imports it.
const watchStrength = (minutes: number, start = `${date}T08:00:00+02:00`) =>
  cardioFromWorkout(
    {
      id: crypto.randomUUID(),
      kind: "strength",
      name: "Strength Training",
      start,
      end: new Date(Date.parse(start) + minutes * 60000).toISOString(),
      durationSeconds: minutes * 60,
    },
    "Europe/Copenhagen",
    new Date(`${date}T18:00:00Z`),
  );

test("the training add-on uses real durations: lifting, activities and imported strength", () => {
  const s = withBody(emptyJournal(), "male", 88, { sessionMinutes: 90 });
  const rest = hydrationTargetMl(s, date).targetMl;
  // A two-hour session counts as two hours, not the usual 90 minutes.
  const lifting = createWorkout(s, days[0], date);
  lifting.startedAt = `${date}T08:00:00.000Z`;
  lifting.finishedAt = `${date}T10:00:00.000Z`;
  s.sessions.push(lifting);
  assert.equal(trainingMinutes(s, date), 120);
  assert.equal(hydrationTargetMl(s, date).targetMl, rest + 1250);
  // A run counts too.
  saveCardio(s, { activity: "running", date, durationSeconds: 30 * 60 }, date);
  assert.equal(trainingMinutes(s, date), 150);
  assert.equal(hydrationTargetMl(s, date).trainingMinutes, 150);
  // 3 h 30 min would be 2.1 L; four hours or more stops at 2 L.
  saveCardio(s, { activity: "walking", date, durationSeconds: 3600 }, date);
  assert.equal(trainingMinutes(s, date), 210);
  assert.equal(
    hydrationTargetMl(s, date).targetMl,
    Math.round((2276 + 2000) / 250) * 250,
  );
  // A strength workout from Apple Health arrives as an activity, and on a
  // day without logged lifting it is the day's lifting.
  const w = withBody(emptyJournal(), "male", 88, { sessionMinutes: 90 });
  w.cardio.sessions.push(watchStrength(45));
  assert.equal(trainingMinutes(w, date), 45);
  // A session without a finish counts as the usual session length.
  const t = withBody(emptyJournal(), "male", 88, { sessionMinutes: 90 });
  t.sessions.push(createWorkout(t, days[0], date));
  assert.equal(trainingMinutes(t, date), 90);
  // Training on another day does not count.
  assert.equal(trainingMinutes(s, "2026-09-25"), 0);
});

test("a watch strength workout imported before the same session is logged counts once", () => {
  // The worked case: an 88 kg man lifts for 75 minutes, wearing his Watch.
  const s = withBody(emptyJournal(), "male", 88, { sessionMinutes: 75 });
  assert.equal(hydrationTargetMl(s, date).targetMl, 2250);
  // He stops the Watch before tapping Finish, or tells Coach about the
  // session in the evening, so the Watch workout is imported first.
  s.cardio.sessions.push(watchStrength(75));
  assert.equal(trainingMinutes(s, date), 75);
  assert.equal(hydrationTargetMl(s, date).targetMl, 3000);
  // Then the same session lands in the journal: still one session.
  const lifting = createWorkout(s, days[0], date);
  lifting.startedAt = `${date}T06:00:00.000Z`;
  lifting.finishedAt = `${date}T07:15:00.000Z`;
  s.sessions.push(lifting);
  assert.equal(trainingMinutes(s, date), 75);
  assert.deepEqual(
    [hydrationTargetMl(s, date).targetMl, hydrationTargetMl(s, date).lowMl],
    [3000, 2500],
  );
  // The longer of the two counts: an untimed session is the usual length.
  const untimed = withBody(emptyJournal(), "male", 88, { sessionMinutes: 60 });
  untimed.cardio.sessions.push(watchStrength(80));
  untimed.sessions.push(createWorkout(untimed, days[0], date));
  assert.equal(trainingMinutes(untimed, date), 80);
  // The Watch's core and functional strength workouts count towards that
  // one session too, and other activities add on.
  const core = watchStrength(30);
  core.title = "Core Training";
  untimed.cardio.sessions.push(core);
  assert.equal(trainingMinutes(untimed, date), 110);
  saveCardio(
    untimed,
    { activity: "other", title: "Yoga", date, durationSeconds: 1800 },
    date,
  );
  assert.equal(trainingMinutes(untimed, date), 140);
});

test("an older check-in water total moves once into a drink", () => {
  const s = emptyJournal();
  const checkin = (d: string, waterMl: number, sleepHours: number | null) => ({
    date: d,
    sleepHours,
    energy: null,
    soreness: null,
    waterMl,
    bodyweight: null,
    notes: "",
    updatedAt: `${d}T20:00:00.000Z`,
  });
  s.health.checkins.push(
    checkin(date, 1800, null),
    checkin("2026-09-25", 2000, 7.5),
    checkin("2026-09-24", 12000, null),
    checkin("2026-09-23", 900, null),
  );
  // On a day with drinks, they were the record; the check-in total is cleared.
  addDrink(s, { date: "2026-09-23", ml: 500, kind: "water" });
  const moved = moveCheckinWater(s);
  assert.equal(hydrationForDay(moved, date).totalMl, 1800);
  assert.deepEqual(
    hydrationForDay(moved, date).drinks.map((d) => [d.kind, d.name, d.ml]),
    [["water", "From check-in", 1800]],
  );
  // A check-in that held only water is gone; one with sleep keeps it.
  assert.deepEqual(
    moved.health.checkins.map((c) => [c.date, c.waterMl, c.sleepHours]),
    [["2026-09-25", null, 7.5]],
  );
  assert.equal(hydrationForDay(moved, "2026-09-25").totalMl, 2000);
  // A drink holds at most 5 L, so a larger total is split.
  assert.deepEqual(
    hydrationForDay(moved, "2026-09-24").drinks.map((d) => d.ml),
    [4000, 4000, 4000],
  );
  assert.equal(hydrationForDay(moved, "2026-09-23").totalMl, 500);
  journalSchema.parse(moved);
  // The source is unchanged, and moving again changes nothing.
  assert.equal(s.health.checkins.length, 4);
  assert.deepEqual(moveCheckinWater(moved), moved);
  // An older copy synced later gives the same drink, not a second one; a
  // changed total replaces it.
  const stale = structuredClone(moved);
  stale.health.checkins.push(checkin(date, 2100, null));
  const again = moveCheckinWater(stale);
  assert.equal(hydrationForDay(again, date).totalMl, 2100);
  assert.equal(hydrationForDay(again, date).drinks.length, 1);
});

test("Coach logs drinks, bundles a drink with energy as a meal too, and removes one", () => {
  const s = emptyJournal();
  s.profile.bodyweight = 88;
  const logged = prepareAction(
    s,
    { kind: "log_drink", drink: { date, ml: 500, kind: "water" } },
    date,
  );
  assert.equal(logged.title, "Log a drink");
  assert.match(logged.detail, /500 ml water\. 0\.5 L of about 2\.25 L/);
  const bundle = prepareAction(
    logged.state,
    {
      kind: "record_bundle",
      entries: [
        {
          kind: "log_drink",
          drink: { date, ml: 500, kind: "energy drink", name: "Alien lychee" },
        },
        {
          kind: "record_meal",
          meal: {
            ...meal,
            name: "Alien lychee energy drink",
            type: "snack",
            items: [
              {
                name: "Energy drink",
                portion: "500 ml",
                calories: 230,
                protein: 0,
                carbs: 57,
                fat: 0,
              },
            ],
          },
        },
      ],
    },
    date,
  );
  assert.equal(hydrationForDay(bundle.state, date).totalMl, 1000);
  assert.equal(bundle.state.nutrition.meals.length, 1);
  const id = bundle.state.health.drinks![0].id;
  const removed = prepareAction(
    bundle.state,
    { kind: "delete_drink", drinkId: id },
    date,
  );
  assert.equal(hydrationForDay(removed.state, date).totalMl, 500);
  assert.throws(
    () =>
      prepareAction(
        s,
        {
          kind: "log_drink",
          drink: { date: "2026-12-01", ml: 250, kind: "tea" },
        },
        date,
      ),
    /future/,
  );
  // Both coaches see the day's drinks and the total against the range.
  const day = dayForCoach(bundle.state, date);
  assert.deepEqual(day.hydration, {
    totalMl: 1000,
    recorded: true,
    targetMl: 2250,
    lowMl: 1750,
    highMl: 2750,
  });
  assert.equal(day.drinks.length, 2);
  assert.match(describeDay(day), /Drinks: 1 L of about 2\.25 L/);
});

test("wine is logged with an energy prompt, unless its meal comes with it", () => {
  assert.ok(
    ["beer", "wine", "spirits"].every((k) => drinkKinds.includes(k as never)),
  );
  const s = emptyJournal();
  const wine = prepareAction(
    s,
    { kind: "log_drink", drink: { date, ml: 150, kind: "wine" } },
    date,
  );
  assert.match(wine.detail, /Wine has energy too: log it in Food as well\./);
  // It counts towards the drinks total at its volume.
  assert.equal(hydrationForDay(wine.state, date).totalMl, 150);
  const both = prepareAction(
    s,
    {
      kind: "record_bundle",
      entries: [
        { kind: "log_drink", drink: { date, ml: 150, kind: "wine" } },
        { kind: "record_meal", meal },
      ],
    },
    date,
  );
  assert.doesNotMatch(both.entries![0].detail, /energy/);
  // A meal on another day is not this drink's.
  const elsewhere = prepareAction(
    s,
    {
      kind: "record_bundle",
      entries: [
        { kind: "log_drink", drink: { date, ml: 330, kind: "beer" } },
        { kind: "record_meal", meal: { ...meal, date: "2026-09-25" } },
      ],
    },
    date,
  );
  assert.match(elsewhere.entries![0].detail, /Beer has energy too/);
  // Water never asks.
  assert.doesNotMatch(
    prepareAction(
      s,
      { kind: "log_drink", drink: { date, ml: 250, kind: "water" } },
      date,
    ).detail,
    /energy/,
  );
});

test("a usual size saved because the volume wasn't given is marked as an estimate", () => {
  const s = emptyJournal();
  const glass = prepareAction(
    s,
    {
      kind: "log_drink",
      drink: { date, ml: 250, kind: "water", estimated: true },
    },
    date,
  );
  assert.equal(glass.state.health.drinks![0].estimated, true);
  assert.match(glass.detail, /^about 250 ml water\./);
  assert.equal(glass.drink?.estimated, true);
  assert.equal(dayForCoach(glass.state, date).drinks[0].estimated, true);
  // An exact volume carries no flag at all.
  const exact = addDrink(s, { date, ml: 330, kind: "water", estimated: false });
  assert.equal("estimated" in exact, false);
});

test("a hidden target is not shown to the athlete or the coaches, and drinks still count", () => {
  const s = emptyJournal();
  s.profile.bodyweight = 88;
  s.preferences.hideHydrationTarget = true;
  journalSchema.parse(s);
  const logged = prepareAction(
    s,
    { kind: "log_drink", drink: { date, ml: 500, kind: "water" } },
    date,
  );
  assert.equal(logged.detail, `500 ml water. 0.5 L on ${date}.`);
  assert.equal(logged.drink?.dayTargetMl, undefined);
  assert.deepEqual(hydrationForCoach(logged.state, date), {
    totalMl: 500,
    recorded: true,
    targetHidden: true,
  });
  assert.match(
    describeDay(dayForCoach(logged.state, date)),
    /Drinks: 0\.5 L\./,
  );
  assert.equal(hydrationForDay(logged.state, date).hidden, true);
});

test("the note says what the target rests on, with thirst as a weaker guide after 50", () => {
  const s = emptyJournal();
  assert.match(
    hydrationNote(s, date),
    /^A general estimate until your weight is known/,
  );
  s.profile.bodyweight = 70;
  assert.match(
    hydrationNote(s, date),
    /^An estimate from your weight and the day's training, not a minimum\. Thirst and pale urine/,
  );
  s.profile.age = 58;
  assert.match(
    hydrationNote(s, date),
    /after about 50 thirst is a weaker guide/,
  );
});

test("an older cached app gets alcohol as other and no estimates, and saving them back keeps both", () => {
  const s = emptyJournal();
  const wine = addDrink(s, { date, ml: 150, kind: "wine" });
  const glass = addDrink(s, { date, ml: 250, kind: "water", estimated: true });
  const old = drinksForOlderApps(s.health.drinks!);
  assert.deepEqual(
    old.map((d) => [d.kind, d.name, "estimated" in d]),
    [
      ["other", "Wine", false],
      ["water", "", false],
    ],
  );
  const kept = retainDrinkDetails(old, s.health.drinks!);
  assert.deepEqual(kept, [wine, glass]);
  // A drink the older app changed is its own.
  const edited = retainDrinkDetails([{ ...old[0], ml: 175 }], s.health.drinks!);
  assert.equal(edited[0].kind, "other");
  const snapshot = { state: s, revision: 1 };
  const older = foodSnapshotForClient(new Request("http://x"), snapshot);
  assert.equal(older.state.health.drinks![0].kind, "other");
  assert.equal(s.health.drinks![0].kind, "wine", "the stored record stays");
  const current = foodSnapshotForClient(
    new Request("http://x", { headers: { "x-drinks-version": "1" } }),
    snapshot,
  );
  assert.equal(current.state.health.drinks![0].kind, "wine");
});
