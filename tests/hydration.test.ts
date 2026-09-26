import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, days, emptyJournal } from "../lib/domain";
import {
  addDrink,
  hydrationForDay,
  hydrationTargetMl,
  removeDrink,
} from "../lib/hydration";
import { prepareAction } from "../lib/agent/actions";
import { journalSchema } from "../lib/model";
import { dayForCoach, describeDay } from "../lib/journal-summary";

const date = "2026-09-26";

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

test("an older check-in water total still counts on days without drinks", () => {
  const s = emptyJournal();
  s.health.checkins.push({
    date,
    sleepHours: null,
    energy: null,
    soreness: null,
    waterMl: 1800,
    bodyweight: null,
    notes: "",
    updatedAt: new Date().toISOString(),
  });
  assert.equal(hydrationForDay(s, date).totalMl, 1800);
  assert.equal(hydrationForDay(s, date).recorded, true);
  addDrink(s, { date, ml: 500, kind: "water" });
  // Once drinks are logged they are the record; nothing is counted twice.
  assert.equal(hydrationForDay(s, date).totalMl, 500);
});

test("the target follows bodyweight and adds for training that day", () => {
  const s = emptyJournal();
  assert.deepEqual(hydrationTargetMl(s, date), {
    targetMl: 2500,
    estimated: true,
  });
  s.profile.bodyweight = 88;
  assert.equal(hydrationTargetMl(s, date).targetMl, 3100);
  const w = createWorkout(s, days[0], date);
  s.sessions.push(w);
  // 75 minutes of training adds about 750 ml.
  assert.equal(hydrationTargetMl(s, date).targetMl, 3850);
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
  assert.match(logged.detail, /500 ml water\. 0\.5 L of about 3\.1 L/);
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
            date,
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
            source: "text",
            estimated: true,
            notes: "",
            photoIds: [],
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
  // Both coaches see the day's drinks and the total against the target.
  const day = dayForCoach(bundle.state, date);
  assert.deepEqual(day.hydration, {
    totalMl: 1000,
    targetMl: 3100,
    recorded: true,
  });
  assert.equal(day.drinks.length, 2);
  assert.match(describeDay(day), /Drinks: 1 L of about 3\.1 L/);
});
