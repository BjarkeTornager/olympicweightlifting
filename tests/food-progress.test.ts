import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyJournal } from "../lib/domain";
import type { JournalState } from "../lib/model";
import { mealSchema, type Meal } from "../lib/nutrition";
import { applyGoals } from "../lib/body-goals";
import { setDailyTargets } from "../lib/target-proposals";
import {
  belowMinimum,
  completeDayAverage,
  foodDay,
  LEAST_KCAL,
  macroRanges,
  minimumKcal,
  progressLine,
  VERY_LOW_KCAL,
} from "../lib/food-progress";
import { withSavedTargets } from "../lib/visual-targets";
import { hydrationTargetMl } from "../lib/hydration";
import { saveCardio } from "../lib/cardio";
import { dayForCoach, describeDay } from "../lib/journal-summary";
import { buildToday, buildTrends } from "../lib/native-api";
import { prepareAction } from "../lib/agent/actions";
import { systemPrompt } from "../lib/agent/knowledge";
import { foodProgressRule, lowTargetRule } from "../lib/agent/health-rules";
import { visualSchema, type CoachVisual } from "../lib/coach-visuals";
import { FoodView } from "../components/views/food";

const day = "2026-10-10";
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
  const today = buildToday(state, 1, day, new Set());
  assert.equal(today.nutrition.hideOverTarget, true);
  assert.equal(today.nutrition.caloriesProgress?.status, undefined);
  assert.match(today.nutrition.targetNote!, /below your estimated minimum/);
  assert.doesNotMatch(JSON.stringify(today.nutrition), /above/);
  // Coach: the same words, the flag and the minimum.
  const coach = dayForCoach(state, day);
  assert.doesNotMatch(JSON.stringify(coach.eatenSoFar), /above/);
  assert.equal(
    coach.calorieTargetBelowMinimum?.estimated_minimum_kcal,
    minimum,
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
  // A teenager's plan holds weight, and nothing reads above target.
  const teen = athlete(16);
  teen.nutrition.meals.push(
    meal(day, 3200, { protein: 200, carbs: 400, fat: 120 }),
  );
  const young = foodDay(teen, day, day);
  assert.equal(young.hideOver, true);
  assert.doesNotMatch(everyText(teen, day), /above/);
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
  // Fat a quarter of energy up to 35 %; carbohydrate down by the same.
  assert.deepEqual(p.fat.range, { low: 60, high: 85 });
  assert.equal(p.fat.targetText, "about 60 to 85\u00a0g");
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
      [295, false],
      [60, false],
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
    fat: "~0\u00a0g of about 60 to 85\u00a0g, about 60\u00a0g remaining",
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
  const today = buildToday(state, 1, day, new Set()).nutrition;
  assert.equal(today.complete, true);
  assert.equal(today.estimated, false);
  assert.deepEqual(today.caloriesProgress, {
    target: "about 2,150\u00a0kcal",
    status: "About on target",
  });
  assert.deepEqual(today.proteinProgress, {
    target: "at least 110\u00a0g",
    status: "Reached",
  });
  assert.equal(today.carbsProgress?.status, "About 240\u00a0g under the range");
  assert.equal(today.hideOverTarget, undefined);
  assert.equal(today.targetNote, undefined);
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
