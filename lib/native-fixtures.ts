import { createWorkout, days, emptyJournal } from "./domain";
import { cardioFromWorkout } from "./health-sync";
import { addDrink } from "./hydration";
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
  state.profile.name = "Alex";
  addDrink(state, { date, ml: 500, kind: "water" }, now).id =
    "1d9e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a14";
  addDrink(state, { date, ml: 250, kind: "coffee" }, now).id =
    "2e0f3f8e-2a51-4c1e-9d0b-0c1f7c1e2a15";
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
            },
          ],
        },
      ],
      now,
    ),
  };
}
