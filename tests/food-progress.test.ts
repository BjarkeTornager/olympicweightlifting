import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyJournal, today } from "../lib/domain";
import type { JournalState } from "../lib/model";
import { mealSchema, type Meal } from "../lib/nutrition";
import { applyGoals, planGoals } from "../lib/body-goals";
import { saveBodyFat } from "../lib/body-composition";
import { saveCheckin } from "../lib/health";
import { setDailyTargets } from "../lib/target-proposals";
import {
  belowMinimum,
  completeDayAverage,
  foodDay,
  LEAST_KCAL,
  macroRanges,
  MINIMUM_MARGIN_KCAL,
  minimumKcal,
  progressLine,
  VERY_LOW_KCAL,
} from "../lib/food-progress";
import { withSavedTargets } from "../lib/visual-targets";
import { hydrationTargetMl } from "../lib/hydration";
import { saveCardio } from "../lib/cardio";
import { dayForCoach, describeDay } from "../lib/journal-summary";
import { buildCoach, buildToday, buildTrends } from "../lib/native-api";
import { prepareAction } from "../lib/agent/actions";
import { systemPrompt } from "../lib/agent/knowledge";
import { foodProgressRule, lowTargetRule } from "../lib/agent/health-rules";
import {
  savedVisualSchema,
  visualSchema,
  type CoachVisual,
  type SavedVisual,
} from "../lib/coach-visuals";
import { FoodView } from "../components/views/food";

// Today on the clock FoodView reads, so the page shows the same day as the
// tests; every other date is counted back from it.
const day = today();
const before = (n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) - n * 86400000)
    .toISOString()
    .slice(0, 10);

function meal(
  date: string,
  calories: number,
  macros: { protein?: number; carbs?: number; fat?: number } = {},
  estimated = false,
): Meal {
  return mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: `${date}T12:00:00.000Z`,
    date,
    name: "Lunch",
    type: "lunch",
    source: "manual",
    estimated,
    notes: "",
    photoIds: [],
    items: [
      {
        name: "Food",
        portion: "1 plate",
        calories,
        protein: macros.protein ?? 0,
        carbs: macros.carbs ?? 0,
        fat: macros.fat ?? 0,
      },
    ],
  });
}

// A 30-year-old woman holding 60 kg: the plan gives about 2,150 kcal, and
// its least is about 1,420 kcal.
function athlete(age = 30) {
  const state = emptyJournal();
  applyGoals(
    state,
    {
      age,
      sex: "female",
      heightCm: 165,
      weightKg: 60,
      targetWeightKg: 60,
      targetDate: null,
      activity: "moderate",
      trainingDays: 3,
      sessionMinutes: 60,
      experience: "developing",
    },
    before(30),
  );
  return state;
}

// Her own targets, set by hand a week ago, below that least.
function lowTarget(state: JournalState, calories = 1300) {
  setDailyTargets(
    state,
    { goal: "lose", calories, protein: 110, carbs: 150, fat: 45 },
    before(7),
  );
  return state;
}

const everyText = (state: JournalState, date: string) => {
  const food = foodDay(state, date, day);
  return Object.values(food.progress)
    .map((p) => p.text)
    .join(" | ");
};

test("a calorie target below the estimated minimum never shows above target", () => {
  const state = lowTarget(athlete());
  const minimum = minimumKcal(state, day);
  assert.ok(minimum > 1300 && minimum < 1500, `minimum ${minimum}`);
  // Well over every target, today and on a complete past day.
  state.nutrition.meals.push(
    meal(day, 2400, { protein: 200, carbs: 300, fat: 110 }, true),
    meal(before(1), 2400, { protein: 200, carbs: 300, fat: 110 }),
  );
  state.nutrition.completeDays = [before(1)];
  for (const date of [day, before(1)]) {
    const food = foodDay(state, date, day);
    assert.equal(food.hideOver, true);
    assert.equal(food.progress.calories.state, "over");
    assert.doesNotMatch(everyText(state, date), /above/);
    assert.match(food.belowMinimum!.note, /below your estimated minimum/);
    // Protein is reached, never "above".
    assert.equal(food.progress.protein.text, "Reached");
  }
  // The note rounds the minimum to 50 kcal.
  assert.match(
    foodDay(state, day, day).belowMinimum!.note,
    new RegExp(
      `about ${Math.round(minimum / 50) * 50}`.replace(
        /(\d)(\d{3})\b/,
        "$1,$2",
      ),
    ),
  );
  // The website: a note, and nothing above target.
  const html = renderToStaticMarkup(
    createElement(FoodView, {
      journal: { state, update: async () => {} } as never,
      go: () => {},
    }),
  );
  assert.match(html, /below your estimated minimum/);
  assert.doesNotMatch(html, /above/);
  // The iPhone: no status past the target, told to draw no marks past it.
  const phone = buildToday(state, 1, day, new Set()).nutrition;
  assert.equal(phone.hideOverTarget, true);
  assert.equal(phone.caloriesProgress?.status, undefined);
  assert.match(phone.targetNote!, /below your estimated minimum/);
  assert.doesNotMatch(JSON.stringify(phone), /above/);
  // Coach: the same words, the flag and the minimum the note gives.
  const coach = dayForCoach(state, day);
  assert.doesNotMatch(JSON.stringify(coach.eatenSoFar), /above/);
  assert.equal(coach.eatenSoFar.hideOverTarget, true);
  assert.equal(
    coach.calorieTargetBelowMinimum?.estimated_minimum_kcal,
    Math.round(minimum / 50) * 50,
  );
  assert.doesNotMatch(describeDay(coach), /above/);
  // Over the target, but within the band, it is about on target.
  state.nutrition.meals = [meal(day, 1390)];
  assert.equal(
    foodDay(state, day, day).progress.calories.text,
    "About on target",
  );
});

test("the same day over an ordinary target does say so, and under 18 it doesn't", () => {
  const state = athlete();
  state.nutrition.meals.push(
    meal(day, 2800, { protein: 200, carbs: 400, fat: 120 }),
  );
  const food = foodDay(state, day, day);
  assert.equal(food.hideOver, false);
  assert.equal(food.belowMinimum, null);
  assert.equal(food.progress.calories.text, "About 650\u00a0kcal above target");
  assert.match(food.progress.fat.text, /above the range/);
  // Carbohydrate is never said to be too much, though the bar is full.
  assert.equal(food.progress.carbs.state, "over");
  assert.equal(food.progress.carbs.text, "");
  assert.equal(dayForCoach(state, day).eatenSoFar.hideOverTarget, undefined);
  // A teenager's plan holds weight, and nothing reads above target.
  const teen = athlete(16);
  teen.nutrition.meals.push(
    meal(day, 3200, { protein: 200, carbs: 400, fat: 120 }),
  );
  const young = foodDay(teen, day, day);
  assert.equal(young.hideOver, true);
  assert.doesNotMatch(everyText(teen, day), /above/);
  // Coach is told too, with no note, as the target isn't low.
  const coach = dayForCoach(teen, day);
  assert.equal(coach.eatenSoFar.hideOverTarget, true);
  assert.equal(coach.calorieTargetBelowMinimum, undefined);
  assert.doesNotMatch(JSON.stringify(coach.eatenSoFar), /above/);
});

test("the note's minimum is always above the target, and Coach gets the same figure", () => {
  // Her least is about 1,420 kcal, which the note gives as 1,400.
  const state = athlete();
  const minimum = minimumKcal(state, day);
  assert.equal(minimum, 1420);
  // Round targets just under it are not called below "about 1,400".
  for (const calories of [1400, 1410, 1380, 1370])
    assert.equal(
      foodDay(lowTarget(state, calories), day, day).belowMinimum,
      null,
      `${calories}`,
    );
  const low = foodDay(lowTarget(state, 1360), day, day).belowMinimum!;
  assert.equal(low.minimumKcal, 1400);
  assert.match(low.note, /about 1,400\u00a0kcal a day/);
  assert.equal(
    dayForCoach(state, day).calorieTargetBelowMinimum?.estimated_minimum_kcal,
    1400,
  );
  // Whatever the target, a note never names a minimum at or under it.
  for (let calories = 1000; calories <= 1500; calories += 5) {
    const note = belowMinimum(calories, state, day);
    if (note) assert.ok(note.minimumKcal > calories, `${calories}`);
    assert.equal(
      note != null,
      calories < minimum - MINIMUM_MARGIN_KCAL,
      `${calories}`,
    );
  }
});

test("the plan's own target at its floor gets no note in a heavier week", () => {
  // A 30-year-old woman, 160 cm, 77 kg at 45 % body fat by DEXA, cutting
  // to 68 kg with 5 hours of training a week: the plan saves its floor.
  const state = emptyJournal();
  saveBodyFat(state, { date: before(10), percent: 45, method: "dexa" }, day);
  applyGoals(
    state,
    {
      age: 30,
      sex: "female",
      heightCm: 160,
      weightKg: 77,
      targetWeightKg: 68,
      targetDate: null,
      activity: "low",
      trainingDays: 5,
      sessionMinutes: 60,
      experience: "experienced",
    },
    before(5),
  );
  const saved = state.nutrition.targets.calories!;
  assert.equal(state.profile.targetHistory?.at(-1)?.source, "plan");
  // Worked out again today, and as her weigh-ins average half a kilo, a
  // kilo, two kilos more, the floor sits a little above that target.
  for (const more of [0, 0.5, 1, 2]) {
    if (more)
      for (const n of [3, 2, 1, 0])
        saveCheckin(state, { date: before(n), bodyweight: 77 + more }, day);
    assert.ok(minimumKcal(state, day) > saved, `${more} kg`);
    const food = foodDay(state, day, day);
    assert.equal(food.belowMinimum, null, `${more} kg`);
    assert.equal(food.hideOver, false);
    assert.equal(dayForCoach(state, day).calorieTargetBelowMinimum, undefined);
  }
});

test("a very low target has its own note, and without goals the least is 1,200 kcal", () => {
  const state = emptyJournal();
  assert.equal(minimumKcal(state, day), LEAST_KCAL);
  assert.equal(belowMinimum(1500, state, day), null);
  assert.equal(belowMinimum(null, state, day), null);
  assert.equal(belowMinimum(0, state, day), null);
  const low = belowMinimum(1000, state, day)!;
  assert.equal(low.veryLow, false);
  assert.match(low.note, /below about 1,200\u00a0kcal a day/);
  const veryLow = belowMinimum(VERY_LOW_KCAL - 100, state, day)!;
  assert.equal(veryLow.veryLow, true);
  assert.match(veryLow.note, /very-low-energy range/);
  assert.match(veryLow.note, /doctor or dietitian/);
});

test("whole numbers, about, protein reached, ranges, and under target once the day is over", () => {
  const state = athlete();
  // 2,150 kcal, 110 g protein, 295 g carbohydrate, 60 g fat.
  const targets = state.nutrition.targets;
  assert.deepEqual(
    [targets.calories, targets.protein, targets.carbs, targets.fat],
    [2150, 110, 295, 60],
  );
  state.nutrition.meals.push(
    meal(day, 1234.6, { protein: 112.4, carbs: 180.4, fat: 70.2 }, true),
  );
  const food = foodDay(state, day, day);
  assert.deepEqual(food.eaten, {
    calories: 1235,
    protein: 112,
    carbs: 180,
    fat: 70,
  });
  assert.equal(food.estimated, true);
  const p = food.progress;
  assert.equal(p.calories.targetText, "about 2,150\u00a0kcal");
  // 915 kcal short, to the 50 kcal.
  assert.equal(p.calories.text, "About 900\u00a0kcal remaining");
  assert.equal(p.protein.targetText, "at least 110\u00a0g");
  assert.equal(p.protein.text, "Reached");
  assert.equal(p.protein.state, "reached");
  // Fat a quarter of energy up to 35 %, to the 5 g inside 35 %;
  // carbohydrate down from its target by a tenth of energy.
  assert.deepEqual(p.fat.range, { low: 55, high: 80 });
  assert.equal(p.fat.targetText, "about 55 to 80\u00a0g");
  assert.equal(p.fat.text, "In range");
  assert.deepEqual(p.carbs.range, { low: 240, high: 295 });
  assert.equal(p.carbs.text, "About 60\u00a0g remaining");
  assert.equal(
    progressLine(food, "calories"),
    "~1,235\u00a0kcal of about 2,150\u00a0kcal, about 900\u00a0kcal remaining",
  );
  // Marked complete, the same day is under target, not remaining.
  state.nutrition.completeDays = [day];
  const done = foodDay(state, day, day).progress;
  assert.equal(done.calories.text, "About 900\u00a0kcal under target");
  assert.equal(done.carbs.text, "About 60\u00a0g under the range");
  // So is a day already over, marked complete or not.
  state.nutrition.meals.push(meal(before(2), 1000, { protein: 60 }));
  const past = foodDay(state, before(2), day).progress;
  assert.equal(past.calories.text, "About 1,150\u00a0kcal under target");
  assert.equal(past.protein.text, "About 50\u00a0g under target");
  // Close to the target is about on target: within 100 kcal or a tenth.
  state.nutrition.meals = [meal(day, 2000)];
  assert.equal(
    foodDay(state, day, day).progress.calories.text,
    "About on target",
  );
});

test("fat and carbohydrate ranges always hold the target, and carbohydrate keeps its floor", () => {
  for (const calories of [1200, 1800, 2500, 3600])
    for (const fat of [33, 50, 61, 100])
      for (const carbs of [90, 131, 222, 400]) {
        const ranges = macroRanges({
          goal: "maintain",
          calories,
          protein: 120,
          carbs,
          fat,
        });
        assert.ok(ranges.fat!.low <= fat && fat <= ranges.fat!.high);
        assert.ok(ranges.carbs!.low <= carbs && carbs <= ranges.carbs!.high);
        assert.ok(ranges.carbs!.low >= Math.min(carbs, 130) - 5);
        for (const r of [ranges.fat!, ranges.carbs!])
          assert.ok(r.low % 5 === 0 && r.high % 5 === 0);
      }
  // Without a calorie target or protein, fat runs 40 % over its target and
  // carbohydrate a fifth under.
  assert.deepEqual(
    macroRanges({
      goal: "maintain",
      calories: null,
      protein: null,
      carbs: 200,
      fat: 50,
    }),
    { fat: { low: 50, high: 70 }, carbs: { low: 160, high: 200 } },
  );
  // While breastfeeding, carbohydrate stays at 210 g or more.
  assert.equal(
    macroRanges(
      { goal: "lose", calories: 2100, protein: 100, carbs: 230, fat: 60 },
      210,
    ).carbs!.low,
    210,
  );
  // A fat target above 35 % of energy runs up a tenth more from it.
  assert.deepEqual(
    macroRanges({
      goal: "maintain",
      calories: 2000,
      protein: 100,
      carbs: 100,
      fat: 100,
    }).fat,
    { low: 100, high: 125 },
  );
});

test("the plan's fat range stays within a quarter and 35 % of energy, and carbohydrate at its floor keeps its room", () => {
  let plans = 0;
  let atFloor = 0;
  for (const sex of ["female", "male"] as const)
    for (const age of [16, 25, 45, 65])
      for (const heightCm of [155, 165, 175, 185])
        for (const weightKg of [50, 60, 70, 85, 100, 120])
          for (const activity of ["low", "moderate", "high"] as const)
            for (const trainingDays of [0, 3, 5])
              for (const goal of [0.85, 1, 1.1]) {
                const plan = planGoals(
                  {
                    age,
                    sex,
                    heightCm,
                    weightKg,
                    targetWeightKg: Math.round(weightKg * goal),
                    targetDate: null,
                    activity,
                    trainingDays,
                    sessionMinutes: 60,
                    experience: "developing",
                  },
                  day,
                );
                if (!plan.dailyTargets || plan.carbs == null) continue;
                plans++;
                const kcal = plan.calories;
                const { fat, carbs } = macroRanges({
                  goal: "maintain",
                  calories: kcal,
                  protein: plan.protein,
                  carbs: plan.carbs,
                  fat: plan.fat,
                });
                const share = (g: number) => (g * 9) / kcal;
                const at = `${sex} ${age} ${weightKg} kg ${kcal} kcal`;
                assert.ok(fat!.low <= plan.fat! && plan.fat! <= fat!.high, at);
                // Never over 35 %, and a quarter of energy is in range.
                assert.ok(share(fat!.high) <= 0.355, at);
                assert.ok(share(fat!.low) <= 0.25, at);
                assert.ok(
                  carbs!.low <= plan.carbs && plan.carbs <= carbs!.high,
                );
                assert.ok(carbs!.low >= 125, at);
                // Never narrower than a tenth of energy, to the 5 g.
                assert.ok(carbs!.high - carbs!.low >= kcal / 40 - 5, at);
                if (carbs!.low === 130) atFloor++;
              }
  assert.ok(plans > 1000 && atFloor > 0, `${plans} plans, ${atFloor}`);
  // 2,000 kcal: a quarter of energy (56 g) is in range on a complete day.
  const state = emptyJournal();
  state.nutrition.targets = {
    goal: "maintain",
    calories: 2000,
    protein: 120,
    carbs: 255,
    fat: 60,
  };
  state.nutrition.meals.push(
    meal(day, 2000, { protein: 120, carbs: 255, fat: 56 }),
  );
  state.nutrition.completeDays = [day];
  const fat = foodDay(state, day, day).progress.fat;
  assert.equal(fat.targetText, "about 55 to 75\u00a0g");
  assert.equal(fat.text, "In range");
});

test("carbohydrate held at its floor runs up, and is never called too much", () => {
  // A 45-year-old woman, 160 cm, 60 kg going to 51, low activity: about
  // 1,370 kcal, with carbohydrate held at about 130 g.
  const state = emptyJournal();
  applyGoals(
    state,
    {
      age: 45,
      sex: "female",
      heightCm: 160,
      weightKg: 60,
      targetWeightKg: 51,
      targetDate: null,
      activity: "low",
      trainingDays: 0,
      sessionMinutes: 60,
      experience: "developing",
    },
    before(5),
  );
  const t = state.nutrition.targets;
  assert.ok(t.carbs! <= 135, `${t.carbs} g`);
  state.nutrition.meals.push(
    meal(day, t.calories!, { protein: t.protein!, carbs: 145, fat: t.fat! }),
  );
  state.nutrition.completeDays = [day];
  const carbs = foodDay(state, day, day).progress.carbs;
  assert.equal(carbs.range!.low, 130);
  assert.ok(carbs.range!.high - 130 >= t.calories! / 40 - 5);
  assert.equal(carbs.text, "In range");
  // Far over the range, nothing is said.
  state.nutrition.meals = [meal(day, t.calories!, { carbs: 400 })];
  const over = foodDay(state, day, day).progress.carbs;
  assert.equal(over.state, "over");
  assert.equal(over.text, "");
});

test("averages ignore today until it is complete, and count only complete days", () => {
  const state = athlete();
  // A full day before, marked complete; a partly logged day before that;
  // and today, under way.
  state.nutrition.meals.push(
    meal(before(1), 2100, { protein: 120 }),
    meal(before(2), 600, { protein: 30 }),
    meal(day, 400, { protein: 20 }),
  );
  state.nutrition.completeDays = [before(1)];
  const week = completeDayAverage(state, day, day);
  assert.equal(week.days, 1);
  assert.equal(week.calories, 2100);
  assert.equal(week.state, "on_target");
  assert.equal(
    week.text,
    "1 complete day in the last 7: 2,100\u00a0kcal and 120\u00a0g protein a day on average, about on target.",
  );
  // The iPhone's Trends: today not complete, and the same words.
  let trends = buildTrends(state, day, 7);
  assert.equal(trends.days.at(-1)!.foodComplete, undefined);
  assert.equal(trends.days.at(-2)!.foodComplete, true);
  assert.equal(trends.foodWeek?.text, week.text);
  // Once today is marked complete, it counts.
  state.nutrition.meals.push(meal(day, 1700, { protein: 100 }));
  state.nutrition.completeDays.push(day);
  const both = completeDayAverage(state, day, day);
  assert.equal(both.days, 2);
  assert.equal(both.calories, 2100);
  trends = buildTrends(state, day, 7);
  assert.equal(trends.days.at(-1)!.foodComplete, true);
  // A day marked complete after the end date doesn't count.
  assert.equal(completeDayAverage(state, before(1), day).days, 1);
  // None complete: the average waits, never counting partial days.
  state.nutrition.completeDays = [];
  const none = completeDayAverage(state, day, day);
  assert.equal(none.days, 0);
  assert.equal(none.calories, null);
  assert.match(none.text, /^No complete days in the last 7/);
  // Coach reads the same; the iPhone is told where days are marked.
  assert.equal(dayForCoach(state, day).foodWeek, none.text);
  assert.match(
    buildTrends(state, day, 7).foodWeek!.text,
    /on the website's Food page/,
  );
});

test("Food's week reads the complete days' average against the target", () => {
  const state = athlete();
  state.nutrition.meals.push(
    meal(before(1), 1500, { protein: 100 }, true),
    meal(before(3), 1600, { protein: 110 }),
    meal(before(2), 300),
  );
  state.nutrition.completeDays = [before(1), before(3)];
  const week = completeDayAverage(state, before(0), day);
  assert.equal(week.calories, 1550);
  assert.equal(week.estimated, true);
  assert.match(week.text, /^2 complete days in the last 7: about 1,550/);
  assert.match(week.text, /about 600\u00a0kcal under target\.$/);
});

test("Coach's progress visual shows the athlete's own daily targets", () => {
  const state = athlete();
  const visual = (targets: object[]) =>
    visualSchema.parse({ kind: "progress", title: "Today", targets });
  const shown = withSavedTargets(
    visual([
      // The goals plan's recalculation, not the saved target.
      { label: "Calories", value: 1200, target: 2300, unit: "kcal" },
      { label: "Protein", value: 80, target: 130, unit: "g" },
      { label: "Carbs", value: 150, target: 260, unit: "g" },
      { label: "Fat", value: 40, target: 70, unit: "g" },
      { label: "Water", value: 1.2, target: 3, unit: "L" },
      { label: "Steps", value: 6000, target: 10000, unit: "steps" },
    ]),
    state,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  // The day's drinks target, in the unit Coach gave.
  const water = hydrationTargetMl(state, day).targetMl / 1000;
  assert.deepEqual(
    shown.targets.map((t) => [t.target, t.suggested ?? false]),
    [
      [2150, false],
      [110, false],
      // Carbohydrate and fat to the top of their ranges, as Food draws them.
      [295, false],
      [80, false],
      [water, false],
      [10000, true],
    ],
  );
  assert.equal(water, 1.75);
  // A week's total or a meal's share is not a daily target: it stays as
  // Coach gave it, marked as its suggestion.
  const week = withSavedTargets(
    visual([
      { label: "Protein this week", value: 600, target: 770, unit: "g" },
      { label: "Protein at lunch", value: 30, target: 40, unit: "g" },
      { label: "Protein", value: 600, target: 770, unit: "g" },
    ]),
    state,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.deepEqual(
    week.targets.map((t) => [t.target, t.suggested]),
    [
      [770, true],
      [40, true],
      [770, true],
    ],
  );
  // A daily calorie target of Coach's own below the minimum is refused.
  const none = emptyJournal();
  assert.throws(
    () =>
      withSavedTargets(
        visual([{ label: "Energy", value: 500, target: 1000, unit: "kcal" }]),
        none,
        day,
      ),
    /below the athlete's estimated minimum of about 1200 kcal/,
  );
  // Above it, with no saved target, it is shown as Coach's suggestion.
  const suggested = withSavedTargets(
    visual([{ label: "Energy", value: 500, target: 2000, unit: "kcal" }]),
    none,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.equal(suggested.targets[0].suggested, true);
  // The athlete's own low target is theirs to see.
  const low = lowTarget(athlete());
  const own = withSavedTargets(
    visual([{ label: "Calories", value: 900, target: 1250, unit: "kcal" }]),
    low,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.equal(own.targets[0].target, 1300);
  assert.equal(own.targets[0].suggested, undefined);
  // Energy burned, a balance or a part of a nutrient is never the food
  // target: shown as Coach gave it, as its suggestion, and never refused.
  const spent = withSavedTargets(
    visual([
      { label: "Calories burned", value: 820, target: 1000, unit: "kcal" },
      { label: "Active energy", value: 450, target: 600, unit: "kcal" },
      { label: "Move goal", value: 450, target: 600, unit: "kcal" },
      { label: "Daily deficit", value: 300, target: 500, unit: "kcal" },
      { label: "Saturated fat", value: 18, target: 24, unit: "g" },
      { label: "Calories out", value: 2200, target: 2400, unit: "kcal" },
    ]),
    state,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.deepEqual(
    spent.targets.map((t) => [t.target, t.suggested]),
    [
      [1000, true],
      [600, true],
      [600, true],
      [500, true],
      [24, true],
      [2400, true],
    ],
  );
  // An active energy goal near the food target is still not replaced.
  const active = withSavedTargets(
    visual([
      { label: "Active energy", value: 820, target: 1300, unit: "kcal" },
    ]),
    state,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.equal(active.targets[0].target, 1300);
  assert.equal(active.targets[0].suggested, true);
  // A card titled for a meal is that meal's, whatever its labels say.
  const dinner = withSavedTargets(
    visualSchema.parse({
      kind: "progress",
      title: "Dinner",
      targets: [
        { label: "Calories", value: 400, target: 800, unit: "kcal" },
        { label: "Protein", value: 30, target: 70, unit: "g" },
      ],
    }),
    state,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.deepEqual(
    dinner.targets.map((t) => [t.target, t.suggested]),
    [
      [800, true],
      [70, true],
    ],
  );
  // A card about energy burned leaves its kcal items alone too.
  const moved = withSavedTargets(
    visualSchema.parse({
      kind: "progress",
      title: "Today",
      caption: "What your training burned so far",
      targets: [{ label: "Energy", value: 300, target: 500, unit: "kcal" }],
    }),
    state,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.deepEqual(moved.targets[0], {
    label: "Energy",
    value: 300,
    target: 500,
    unit: "kcal",
    suggested: true,
  });
  // "Calories per day" is a daily target.
  const perDay = withSavedTargets(
    visual([
      { label: "Calories per day", value: 1200, target: 2300, unit: "kcal" },
    ]),
    state,
    day,
  ) as Extract<CoachVisual, { kind: "progress" }>;
  assert.equal(perDay.targets[0].target, 2150);
  // Other kinds pass through.
  const table = visualSchema.parse({
    kind: "table",
    title: "T",
    columns: ["a"],
    rows: [["1"]],
  });
  assert.equal(withSavedTargets(table, state, day), table);
});

test("Coach's own target review carries the note below the minimum, and still saves it", () => {
  const state = athlete();
  const prepared = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { calories: 1300 } },
    day,
  );
  assert.equal(prepared.state.nutrition.targets.calories, 1300);
  assert.match(prepared.detail, /below your estimated minimum/);
  assert.equal(prepared.notes?.length, 1);
  const fine = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { calories: 2000 } },
    day,
  );
  assert.equal(fine.notes, undefined);
  assert.doesNotMatch(fine.detail, /minimum/);
});

test("both coaches are told to use the app's words, and only typed Coach sets targets", () => {
  const prompt = systemPrompt();
  assert.ok(prompt.includes(foodProgressRule));
  assert.ok(prompt.includes(lowTargetRule));
  assert.match(foodProgressRule, /protein is a minimum that is reached/);
  assert.match(foodProgressRule, /never call a day above target/);
  assert.match(foodProgressRule, /complete days only/);
  const state = athlete();
  state.nutrition.meals.push(meal(day, 1000, { protein: 50 }, true));
  const coach = dayForCoach(state, day);
  assert.deepEqual(coach.eatenSoFar.progress, {
    calories:
      "~1,000\u00a0kcal of about 2,150\u00a0kcal, about 1,150\u00a0kcal remaining",
    protein: "~50\u00a0g of at least 110\u00a0g, about 60\u00a0g remaining",
    carbs: "~0\u00a0g of about 240 to 295\u00a0g, about 240\u00a0g remaining",
    fat: "~0\u00a0g of about 55 to 80\u00a0g, about 55\u00a0g remaining",
  });
  assert.equal(coach.eatenSoFar.estimated, true);
  assert.equal(coach.calorieTargetBelowMinimum, undefined);
  assert.match(
    describeDay(coach),
    /Eaten so far: ~1,000\u00a0kcal of about 2,150\u00a0kcal, about 1,150\u00a0kcal remaining; protein ~50\u00a0g of at least 110\u00a0g/,
  );
});

test("the iPhone's Today carries the same words, and none without targets", () => {
  const state = athlete();
  state.nutrition.meals.push(meal(day, 2100, { protein: 120 }));
  state.nutrition.completeDays = [day];
  const phone = buildToday(state, 1, day, new Set()).nutrition;
  assert.equal(phone.complete, true);
  assert.equal(phone.estimated, false);
  assert.deepEqual(phone.caloriesProgress, {
    target: "about 2,150\u00a0kcal",
    status: "About on target",
  });
  assert.deepEqual(phone.proteinProgress, {
    target: "at least 110\u00a0g",
    status: "Reached",
  });
  assert.equal(phone.carbsProgress?.status, "About 240\u00a0g under the range");
  assert.equal(phone.hideOverTarget, undefined);
  assert.equal(phone.targetNote, undefined);
  const bare = emptyJournal();
  bare.nutrition.meals.push(meal(day, 500));
  const plain = buildToday(bare, 1, day, new Set()).nutrition;
  assert.equal(plain.caloriesProgress, undefined);
  assert.equal(plain.proteinProgress, undefined);
});

test("Trends rows carry each day's own drinks target, and none while it is hidden", () => {
  const state = athlete();
  // An hour's ride two days ago raises that day's target only.
  saveCardio(
    state,
    { activity: "cycling", date: before(2), durationSeconds: 3600 },
    day,
  );
  const rows = buildTrends(state, day, 7).days;
  const targets = rows.map((d) => d.waterTargetMl!);
  const rest = targets.at(-1)!;
  assert.ok(rest > 0);
  assert.deepEqual(
    rows.filter((d) => d.waterTargetMl !== rest).map((d) => d.date),
    [before(2)],
  );
  assert.ok(targets[rows.length - 3] > rest);
  state.preferences.hideHydrationTarget = true;
  const hidden = buildTrends(state, day, 7);
  assert.ok(hidden.days.every((d) => d.waterTargetMl === undefined));
  assert.equal(hidden.waterTargetHidden, true);
});

test("a saved progress card with a target field this version doesn't know still reads", () => {
  // As a newer version might save it: an extra field on a target.
  const saved = {
    id: crypto.randomUUID(),
    content: {
      kind: "progress",
      title: "Today so far",
      targets: [
        {
          label: "Protein",
          value: 80,
          target: 110,
          unit: "g",
          suggested: false,
          hidden: true,
        },
      ],
    },
  };
  const web = savedVisualSchema.parse(saved);
  assert.deepEqual(
    (web.content as Extract<CoachVisual, { kind: "progress" }>).targets,
    [{ label: "Protein", value: 80, target: 110, unit: "g", suggested: false }],
  );
  const phone = buildCoach([
    {
      id: crypto.randomUUID(),
      question: "How am I doing?",
      photoIds: [],
      createdAt: new Date().toISOString(),
      status: "done",
      reply: "Protein is on its way.",
      visuals: [saved as unknown as SavedVisual],
    },
  ]);
  assert.deepEqual(phone.turns[0].visuals?.[0].targets, [
    { label: "Protein", value: 80, target: 110, unit: "g", suggested: false },
  ]);
});
