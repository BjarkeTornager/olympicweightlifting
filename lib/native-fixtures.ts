import { createWorkout, days, emptyJournal } from "./domain";
import { cardioFromWorkout } from "./health-sync";
import { buildTraining } from "./native-training";
import { addDrink } from "./hydration";
import type { CoachVisual } from "./coach-visuals";
import { addSupplement } from "./supplements";
import {
  buildCoach,
  buildJournal,
  buildToday,
  buildTrends,
} from "./native-api";

// Synthetic server responses, committed next to the Swift tests and used by
// the app's previews. The Swift tests decode them with the generated client,
// so a response the app cannot read fails a test on either side.
const now = new Date("2026-09-26T18:00:00Z");
const date = "2026-09-26";
const tz = "Europe/Copenhagen";

export function nativeFixtures() {
  const state = emptyJournal();
  // A journal started two days before, so Today includes its first steps.
  state.createdAt = "2026-09-24T07:00:00.000Z";
  state.profile.name = "Alex";
  addDrink(state, { date, ml: 500, kind: "water" }, now).id =
    "1d9e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a14";
  addDrink(state, { date, ml: 250, kind: "coffee" }, now).id =
    "2e0f3f8e-2a51-4c1e-9d0b-0c1f7c1e2a15";
  // Creatine daily, so it is a usual one; vitamin D already taken today.
  for (const d of ["2026-09-24", "2026-09-25"])
    addSupplement(state, { date: d, name: "Creatine", amount: "5 g" }, now);
  addSupplement(state, { date, name: "Vitamin D", amount: "1000 IU" }, now).id =
    "3f1a4f8e-2a51-4c1e-9d0b-0c1f7c1e2a16";
  state.health.checkins.push({
    date,
    sleepHours: 7.5,
    energy: 4,
    soreness: 2,
    waterMl: null,
    bodyweight: 81.4,
    notes: "",
    updatedAt: now.toISOString(),
    sleepImport: {
      provider: "apple-health",
      digest: "0".repeat(64),
      start: "2026-09-25T21:10:00.000Z",
      end: "2026-09-26T04:40:00.000Z",
      importedAt: now.toISOString(),
    },
  });
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
  state.nutrition.meals.push({
    id: "5b7f0c43-7a57-4a53-9a4c-2f8cf2f0c001",
    date,
    name: "Oats with berries",
    type: "breakfast",
    items: [
      {
        name: "Oats",
        portion: "80 g",
        calories: 300,
        protein: 11,
        carbs: 54,
        fat: 5,
      },
    ],
    source: "text",
    estimated: true,
    notes: "",
    photoIds: [],
    createdAt: now.toISOString(),
  });
  const run = cardioFromWorkout(
    {
      id: "6f0a3f8e-2a51-4c1e-9d0b-0c1f7c1e2a10",
      kind: "running",
      name: "Outdoor Run",
      start: "2026-09-26T06:30:00+02:00",
      end: "2026-09-26T07:20:00+02:00",
      durationSeconds: 3000,
      distanceKm: 10,
      caloriesKcal: 612,
      averageHeartRate: 148,
      maxHeartRate: 171,
    },
    tz,
    now,
  );
  state.cardio.sessions.push(run);
  const lift = createWorkout(state, days[0], "2026-09-25");
  lift.id = "7a1c3f8e-2a51-4c1e-9d0b-0c1f7c1e2a11";
  state.sessions.push(lift);
  const imported = new Set([run.id]);
  return {
    "today.json": buildToday(state, 12, date, imported),
    "journal.json": buildJournal(state, 12, "2026-09-27", 14, imported),
    "trends.json": buildTrends(state, date, 7),
    "training.json": buildTraining(state, 12, date),
    "coach.json": buildCoach(
      [
        {
          id: "8b2d3f8e-2a51-4c1e-9d0b-0c1f7c1e2a12",
          question: "I had oats with berries for breakfast",
          photoIds: [],
          createdAt: now.toISOString(),
          status: "done",
          reply:
            "### Breakfast saved\n\n**About 300 kcal** and 11 g protein.\n\n- Oats, 80 g\n- Berries\n  - estimated portion\n\n| Meal | kcal |\n| --- | --- |\n| Breakfast | 300 |",
          visuals: [
            {
              id: "0d4e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a16",
              content: {
                kind: "bar_chart",
                title: "Protein this week",
                unit: "g",
                points: [
                  { label: "Mon", value: 120 },
                  { label: "Tue", value: 95 },
                ],
              },
            },
          ],
          proposals: [
            {
              id: "9c3e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a13",
              title: "Log breakfast",
              detail: "Oats with berries · about 300 kcal",
              status: "saved",
              expiresAt: "2026-09-27T18:00:00.000Z",
              meal: {
                id: "9c3e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a14",
                createdAt: "2026-09-26T07:10:00.000Z",
                date: "2026-09-26",
                type: "breakfast",
                name: "Oats with berries",
                items: [
                  {
                    name: "Oats",
                    portion: "80 g",
                    calories: 250,
                    protein: 9,
                    carbs: 45,
                    fat: 5,
                  },
                  {
                    name: "Berries",
                    portion: "100 g",
                    calories: 50,
                    protein: 1,
                    carbs: 12,
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
        {
          id: "8b2d3f8e-2a51-4c1e-9d0b-0c1f7c1e2a20",
          question: "How is my week going?",
          photoIds: [],
          createdAt: now.toISOString(),
          status: "done",
          reply: "Steady: bodyweight is drifting down and sleep held up.",
          // One of each kind the app draws natively.
          visuals: (
            [
              {
                kind: "line_chart",
                title: "Bodyweight",
                unit: "kg",
                series: [
                  {
                    name: "Bodyweight",
                    points: [
                      { label: "Sep 21", value: 88.1 },
                      { label: "Sep 28", value: 87.7 },
                    ],
                  },
                ],
                target: 85,
              },
              {
                kind: "progress",
                title: "Today so far",
                targets: [
                  { label: "Protein", value: 116, target: 180, unit: "g" },
                ],
              },
              {
                kind: "stats",
                title: "This week",
                stats: [
                  {
                    label: "Sleep",
                    value: "7 h 24",
                    change: "+18 min",
                    trend: "up",
                  },
                ],
              },
              {
                kind: "comparison",
                title: "Against last week",
                beforeLabel: "Last week",
                afterLabel: "This week",
                comparisons: [
                  {
                    label: "Sleep",
                    before: 7.1,
                    after: 7.4,
                    unit: "h",
                    higherIsBetter: true,
                  },
                ],
              },
              {
                kind: "split",
                title: "Today's calories",
                unit: "kcal",
                parts: [
                  { label: "Protein", value: 464 },
                  { label: "Carbs", value: 604 },
                ],
              },
              {
                kind: "calendar",
                title: "Training days",
                days: [{ date: "2026-09-21", level: 3, label: "Snatch" }],
                legend: "Darker is more training",
              },
            ] satisfies CoachVisual[]
          ).map((content, i) => ({
            id: `0d4e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a3${i}`,
            content,
          })),
          proposals: [],
        },
        {
          id: "8b2d3f8e-2a51-4c1e-9d0b-0c1f7c1e2a22",
          question: "Set my calorie target to 2400",
          photoIds: [],
          createdAt: now.toISOString(),
          status: "done",
          reply: "Here is the new calorie target to review.",
          visuals: [],
          // Calories only: the other targets and the goal are kept.
          proposals: [
            {
              id: "9c3e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a23",
              title: "Update your daily nutrition targets",
              detail:
                "These are your chosen daily targets. They are not a calculated calorie prescription.",
              expiresAt: "2026-09-27T18:00:00.000Z",
              workout: null,
              targets: {
                goal: "lose",
                calories: 2400,
                protein: 176,
                carbs: 253,
                fat: 70,
              },
              targetsBefore: {
                goal: "lose",
                calories: 2350,
                protein: 176,
                carbs: 253,
                fat: 70,
              },
            },
          ],
        },
        {
          id: "8b2d3f8e-2a51-4c1e-9d0b-0c1f7c1e2a21",
          question:
            "Can you give me a high-protein dinner with salmon for two, and show me what it looks like?",
          photoIds: [],
          createdAt: now.toISOString(),
          status: "done",
          reply:
            "A salmon rice bowl: about 25 minutes, with roughly 37 g of protein each.",
          visuals: [
            {
              id: "0d4e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a40",
              content: {
                kind: "recipe",
                title: "Salmon rice bowl",
                caption: "Fits today's protein target.",
                servings: 2,
                minutes: 25,
                ingredients: [
                  { item: "Salmon fillet", amount: "250 g" },
                  { item: "Jasmine rice", amount: "150 g" },
                  { item: "Edamame beans", amount: "100 g" },
                  { item: "Cucumber", amount: "1/2" },
                  { item: "Soy sauce", amount: "2 tbsp" },
                  { item: "Sesame seeds", amount: "1 tbsp" },
                  { item: "Spring onion" },
                ],
                steps: [
                  "Cook the rice as the packet says.",
                  "Roast the salmon at 200 °C for 12 to 15 minutes.",
                  "Boil the edamame for 3 minutes and slice the cucumber.",
                  "Flake the salmon over the rice and top with the vegetables, sliced spring onion, soy sauce and sesame seeds.",
                ],
                nutrition: { kcal: 625, protein: 37, carbs: 66, fat: 21 },
                // An AI picture of the dish (GET api/coach/pictures/{id}).
                pictureId: "5a0c9e1d-7b3f-4e62-8d14-2f6a9c3b7e58",
              } satisfies CoachVisual,
            },
          ],
          proposals: [],
        },
      ],
      now,
    ),
  };
}
