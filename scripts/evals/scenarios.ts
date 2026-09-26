// Coach eval scenarios. Regressions come from real failures seen in use on
// 26 September 2026; each checks the saved journal (outcome), how the coach
// got there (procedure) and, where wording matters, a model-graded rubric.
import { createWorkout, days } from "../../lib/domain";
import { addDrink, hydrationForDay } from "../../lib/hydration";
import { mealSchema } from "../../lib/nutrition";
import type { JournalState } from "../../lib/model";
import {
  called,
  check,
  coachText,
  setsOn,
  type Scenario,
  type Trial,
} from "./core";

const meal = (
  date: string,
  name: string,
  type: "breakfast" | "lunch" | "dinner" | "snack",
  items: [string, string, number, number][],
) =>
  mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    date,
    name,
    type,
    items: items.map(([n, portion, calories, protein]) => ({
      name: n,
      portion,
      calories,
      protein,
      carbs: 20,
      fat: 8,
    })),
    source: "text",
    estimated: true,
  });

const sleep = (s: JournalState, date: string, hours: number) =>
  s.health.checkins.push({
    date,
    sleepHours: hours,
    energy: null,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "",
    updatedAt: new Date().toISOString(),
  });

const session = (s: JournalState, date: string, sets: [number, number][]) => {
  const w = createWorkout(s, days[0], date);
  w.exercises = [
    {
      ...w.exercises[0],
      exerciseId: "snatch",
      sets: sets.map(([weight, reps]) => ({
        id: crypto.randomUUID(),
        weight,
        reps,
        rpe: "",
        result: "success" as const,
        logged: true,
        touched: true,
      })),
    },
  ];
  s.sessions.push({
    ...w,
    title: "Snatch",
    finishedAt: new Date().toISOString(),
  });
};

const fullDay = (s: JournalState, date: string) => {
  s.profile.bodyweight = 85;
  session(s, date, [
    [60, 2],
    [70, 2],
  ]);
  s.nutrition.meals.push(
    meal(date, "Oats with berries", "breakfast", [["Oats", "80 g", 300, 10]]),
    meal(date, "Chicken and rice", "lunch", [
      ["Chicken", "150 g", 250, 45],
      ["Rice", "250 g", 330, 6],
    ]),
  );
  sleep(s, date, 7.5);
  addDrink(s, { date, ml: 1500, kind: "water" });
};

// The coach may say goodbye only after the athlete's last scripted turn.
const endsOnlyAfter = (t: Trial, lastTurn: number) =>
  check(
    "does not hang up before the athlete is done",
    "procedure",
    t.endedAt === undefined || t.endedAt >= lastTurn,
    `ended after athlete turn ${t.endedAt} of ${lastTurn}`,
  );

export const scenarios: Scenario[] = [
  {
    id: "voice-complete-day",
    title: "A fully logged day is acknowledged, not asked about again",
    coach: "voice",
    type: "regression",
    seed: fullDay,
    athlete: ["Hi coach.", "No, that's all for today. Bye."],
    checks: (t) => [
      check(
        "saves nothing new",
        "procedure",
        !t.calls.some((c) => /^log_|^update_|^delete_/.test(c.name)),
        t.calls.map((c) => c.name).join(", "),
      ),
      check("no errors", "procedure", !t.error, t.error),
    ],
    judge: [
      "In its first reply, does the coach mention something that was already logged today (the snatch session, a meal, sleep or water)?",
      "Does the coach avoid asking the athlete to report training, food, sleep or drinks that were already logged?",
    ],
  },
  {
    id: "voice-english",
    title:
      "A reply transcribed as Spanish does not switch the coach's language",
    coach: "voice",
    type: "regression",
    athlete: [
      "¿Qué fue?",
      "Sorry, I mean I did snatches today, three doubles at 70 kilos, all made.",
      "That's everything, thanks.",
    ],
    checks: (t, today) => [
      check(
        "saves the three doubles",
        "outcome",
        JSON.stringify(setsOn(t.after, today, "snatch")) ===
          JSON.stringify([
            [70, 2, true],
            [70, 2, true],
            [70, 2, true],
          ]),
        JSON.stringify(setsOn(t.after, today, "snatch")),
      ),
    ],
    judge: ["Is every coach reply in English?"],
  },
  {
    id: "voice-add-to-meal",
    title: "Food added to a meal already logged updates that meal",
    coach: "voice",
    type: "regression",
    seed: (s, date) => {
      session(s, date, [[60, 2]]);
      sleep(s, date, 7);
      s.nutrition.meals.push(
        meal(date, "Brunch with eggs and toast", "breakfast", [
          ["Scrambled eggs", "2 eggs", 180, 12],
          ["Sourdough toast", "2 slices", 220, 8],
        ]),
      );
    },
    athlete: [
      "I forgot, I also had two small sausages and a yogurt with my brunch.",
      "Yes, that's right.",
      "That's all, bye.",
    ],
    checks: (t, today) => {
      const meals = t.after.nutrition.meals.filter((m) => m.date === today);
      const brunch = meals.find((m) => /brunch/i.test(m.name));
      const names = (brunch?.items ?? []).map((i) => i.name.toLowerCase());
      return [
        check(
          "still one meal",
          "outcome",
          meals.length === 1,
          `${meals.length} meals`,
        ),
        check(
          "keeps the eggs and toast and adds sausages and yogurt",
          "outcome",
          names.some((n) => n.includes("egg")) &&
            names.some((n) => n.includes("toast")) &&
            names.some((n) => n.includes("sausage")) &&
            names.some((n) => n.includes("yog")),
          names.join(", "),
        ),
        check(
          "uses update_meal",
          "procedure",
          called(t, "update_meal").length > 0,
        ),
      ];
    },
  },
  {
    id: "voice-inconsistent-sets",
    title: "Numbers that do not add up are clarified before saving",
    coach: "voice",
    type: "regression",
    seed: (s, date) => sleep(s, date, 7),
    athlete: [
      "Clean and jerk today: five sets of two at 40, 50, 60 and 80 kilos, all made.",
      "Two of the sets were at 80.",
      "That's all for training.",
      "No, nothing else. Bye.",
    ],
    checks: (t, today) => [
      check(
        "asks before saving",
        "procedure",
        !t.calls.some((c) => c.name === "log_training" && c.afterTurn < 2),
        "saved training before the athlete clarified",
      ),
      check(
        "saves five doubles 40-50-60-80-80",
        "outcome",
        JSON.stringify(
          setsOn(t.after, today, "clean_and_jerk").map((x) => x[0]),
        ) === "[40,50,60,80,80]",
        JSON.stringify(setsOn(t.after, today, "clean_and_jerk")),
      ),
    ],
  },
  {
    id: "voice-not-yet",
    title: "A short 'not yet' does not end the call",
    coach: "voice",
    type: "regression",
    seed: (s, date) => {
      session(s, date, [[60, 2]]);
      sleep(s, date, 7);
    },
    athlete: [
      "Hi.",
      "Not yet.",
      "Actually, I had a chicken salad for lunch.",
      "Nothing else. Bye.",
    ],
    checks: (t) => [
      endsOnlyAfter(t, 4),
      check(
        "logs the salad",
        "outcome",
        t.after.nutrition.meals.some((m) => /salad/i.test(m.name)),
      ),
    ],
  },
  {
    id: "voice-old-workout",
    title: "An old unfinished workout neither blocks nor gets silently cleared",
    coach: "voice",
    type: "regression",
    seed: (s) => {
      s.activeWorkout = createWorkout(s, days[0], "2026-09-20");
    },
    athlete: [
      "I did back squats today, 100 kilos for three sets of five.",
      "That's all.",
    ],
    checks: (t, today) => [
      check(
        "saves the squats",
        "outcome",
        JSON.stringify(setsOn(t.after, today, "back_squat")) ===
          JSON.stringify([
            [100, 5, true],
            [100, 5, true],
            [100, 5, true],
          ]),
        JSON.stringify(setsOn(t.after, today, "back_squat")),
      ),
      check(
        "leaves the old workout unless it says so",
        "procedure",
        called(t, "clear_unfinished_workout").length === 0 ||
          /unfinished|old workout|september 20|20 september/i.test(
            coachText(t),
          ),
        "cleared without telling the athlete",
      ),
    ],
  },
  {
    id: "voice-drinks",
    title: "Drinks add up, and a drink with energy is also food",
    coach: "voice",
    type: "regression",
    seed: (s, date) => {
      session(s, date, [[60, 2]]);
      sleep(s, date, 7);
      s.nutrition.meals.push(
        meal(date, "Oats", "breakfast", [["Oats", "80 g", 300, 10]]),
      );
    },
    athlete: [
      "I had a 500 ml bottle of water and a can of Red Bull.",
      "That's all.",
    ],
    checks: (t, today) => {
      const water = hydrationForDay(t.after, today);
      return [
        check(
          "logs both drinks",
          "outcome",
          water.drinks.length === 2 && water.totalMl >= 700,
          `${water.drinks.length} drinks, ${water.totalMl} ml`,
        ),
        check(
          "logs the energy drink as food too",
          "outcome",
          t.after.nutrition.meals.some((m) => /red bull|energy/i.test(m.name)),
        ),
      ];
    },
  },
  {
    id: "voice-goals",
    title: "Goals are collected without guessing and saved as the app's plan",
    coach: "voice",
    type: "capability",
    purpose: "goals",
    athlete: {
      goal: "Set up your goals. You are 34, male, 182 cm tall and weigh 88 kg. You want to get down to 81 kg, no deadline. You have a desk job, can train 4 days a week for about 75 minutes, and have been lifting for two years. Only give each fact when asked.",
      maxTurns: 14,
    },
    checks: (t) => {
      const body = t.after.profile.body;
      return [
        check(
          "saves the stated details",
          "outcome",
          body?.age === 34 &&
            body.heightCm === 182 &&
            body.weightKg === 88 &&
            body.targetWeightKg === 81 &&
            body.trainingDays === 4,
          JSON.stringify(body),
        ),
        check(
          "sets daily targets from the plan",
          "outcome",
          (t.after.nutrition.targets.calories ?? 0) > 1800,
          JSON.stringify(t.after.nutrition.targets),
        ),
      ];
    },
    judge: [
      "When the coach states the daily calories, do they match the saved plan in the coach's action results rather than a figure it made up?",
    ],
  },
  {
    id: "voice-memory",
    title: "The coach remembers an earlier conversation",
    coach: "voice",
    type: "capability",
    seed: fullDay,
    memory: [
      [
        "My left knee hurts when I squat deep.",
        "Let's keep squats above parallel this week and see how it feels.",
      ],
    ],
    athlete: ["Have we talked about my knee before?", "Thanks, that's all."],
    checks: () => [],
    judge: [
      "Does the coach correctly say they discussed the athlete's left knee hurting in deep squats, and the advice to keep squats above parallel?",
    ],
  },
  {
    id: "voice-simulated-day",
    title: "A busy athlete logs a whole day in a natural conversation",
    coach: "voice",
    type: "capability",
    athlete: {
      goal: "Log today: snatch, three doubles at 70 kg all made; lunch was chicken and rice; you slept six and a half hours; you drank about two litres of water. You are in a hurry and answer briefly.",
      maxTurns: 14,
    },
    checks: (t, today) => [
      check(
        "saves the snatches",
        "outcome",
        setsOn(t.after, today, "snatch").length === 3,
        JSON.stringify(setsOn(t.after, today, "snatch")),
      ),
      check(
        "saves lunch",
        "outcome",
        t.after.nutrition.meals.some((m) => /chicken|rice/i.test(m.name)),
      ),
      check(
        "saves sleep",
        "outcome",
        t.after.health.checkins.some(
          (c) => c.date === today && c.sleepHours === 6.5,
        ),
      ),
      check(
        "saves water",
        "outcome",
        hydrationForDay(t.after, today).totalMl >= 1500,
        `${hydrationForDay(t.after, today).totalMl} ml`,
      ),
    ],
  },
  // Typed Coach. These use the production OpenRouter budget; run with --text.
  {
    id: "text-status",
    title: "Typed Coach answers today's status from what it already knows",
    coach: "text",
    type: "regression",
    seed: fullDay,
    athlete: ["What is the status for today?"],
    checks: (t) => [
      check(
        "needs no lookups for today",
        "procedure",
        t.calls.length === 0,
        t.calls.map((c) => c.name).join(", "),
      ),
    ],
    judge: [
      "Does the reply correctly list the snatch session, both meals, 7.5 hours of sleep and 1.5 litres of water?",
    ],
  },
  {
    id: "text-drink",
    title: "Typed Coach adds a drink to the day's total",
    coach: "text",
    type: "regression",
    seed: (s, date) => {
      s.profile.bodyweight = 85;
      addDrink(s, { date, ml: 1000, kind: "water" });
    },
    athlete: ["I just had another 500 ml of water."],
    checks: (t, today) => [
      check(
        "total is 1.5 litres",
        "outcome",
        hydrationForDay(t.after, today).totalMl === 1500,
        `${hydrationForDay(t.after, today).totalMl} ml`,
      ),
    ],
  },
  {
    id: "text-save-and-answer",
    title: "Typed Coach saves and also answers a question in the same message",
    coach: "text",
    type: "capability",
    athlete: [
      "I slept 7 hours last night. Also, how many sets of snatch should I do when I'm tired?",
    ],
    checks: (t, today) => [
      check(
        "saves the sleep",
        "outcome",
        t.after.health.checkins.some(
          (c) => c.date === today && c.sleepHours === 7,
        ),
      ),
    ],
    judge: [
      "Does the coach answer the question about how many snatch sets to do when tired?",
    ],
  },
];
