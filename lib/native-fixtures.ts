import { createWorkout, days, emptyJournal } from "./domain";
import { cardioFromWorkout } from "./health-sync";
import { buildTraining, workoutView } from "./native-training";
import { addDrink } from "./hydration";
import type { CoachVisual } from "./coach-visuals";
import { addSupplement } from "./supplements";
import { prepareBodyGoals } from "./agent/prepare-records";
import { offsetDate } from "./health";
import { applyGoals } from "./body-goals";
import { setDailyTargets } from "./target-proposals";
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
  // The athlete's own exercise, which the iPhone lists under Your exercises.
  lift.exercises.push({
    ...structuredClone(lift.exercises[0]),
    id: "own-entry",
    exerciseId: "custom:Standing cable reverse fly",
    prescribed: {},
    sets: [
      {
        ...structuredClone(lift.exercises[0].sets[0]),
        id: "own-set",
        weight: "15",
        reps: "10",
        result: "success",
        logged: true,
      },
    ],
  });
  state.sessions.push(lift);
  const imported = new Set([run.id]);
  // Goals for a 16-year-old who wants to lose weight, as the real plan
  // reviews them: held at maintenance, with its note.
  const goals = prepareBodyGoals(
    emptyJournal(),
    {
      kind: "set_body_goals",
      bodyGoals: {
        age: 16,
        sex: "female",
        heightCm: 165,
        weightKg: 60,
        targetWeightKg: 55,
        targetDate: null,
        activity: "moderate",
        trainingDays: 3,
        sessionMinutes: 60,
        experience: "new",
      },
    },
    date,
  );
  // Six reported nights of 6 hours before last night's 7 h 30 min from
  // Apple Health: short sleep, so Today carries Coach's note on it.
  const shortSleep = structuredClone(state);
  for (const day of [1, 2, 3, 4, 5, 6])
    shortSleep.health.checkins.push({
      date: offsetDate(date, -day),
      sleepHours: 6,
      energy: null,
      soreness: null,
      waterMl: null,
      bodyweight: null,
      notes: "",
      updatedAt: now.toISOString(),
    });
  // Goals saved on 1 September at 88 kg, heading for 81 kg, and calories
  // lowered by hand on 23 September. A week of weigh-ins around 81 kg since
  // reaches the goal, so the plan suggests holding the weight there: Today
  // carries the suggestion, and Trends the targets in force each day.
  const reached = emptyJournal();
  reached.createdAt = "2026-08-30T07:00:00.000Z";
  const stamp = (at: string) =>
    (reached.profile.targetHistory = reached.profile.targetHistory!.map(
      (r, i, all) => (i === all.length - 1 ? { ...r, setAt: at } : r),
    ));
  applyGoals(
    reached,
    {
      age: 34,
      sex: "male",
      heightCm: 182,
      weightKg: 88,
      targetWeightKg: 81,
      targetDate: null,
      activity: "moderate",
      trainingDays: 4,
      sessionMinutes: 75,
      experience: "developing",
    },
    "2026-09-01",
  );
  reached.profile.body!.updatedAt = "2026-09-01T07:00:00.000Z";
  stamp("2026-09-01T07:00:00.000Z");
  setDailyTargets(
    reached,
    { ...reached.nutrition.targets, calories: 2550 },
    "2026-09-23",
  );
  stamp("2026-09-23T07:00:00.000Z");
  for (const [day, kg] of [
    [-6, 81.6],
    [-4, 81.2],
    [-2, 80.9],
    [0, 81],
  ] as const)
    reached.health.checkins.push({
      date: offsetDate(date, day),
      sleepHours: null,
      energy: null,
      soreness: null,
      waterMl: null,
      bodyweight: kg,
      notes: "",
      updatedAt: `${offsetDate(date, day)}T06:30:00.000Z`,
    });
  // Goals saved on 1 September at 62 kg, to hold it, and a week of
  // weigh-ins around 63.1 kg since: the plan suggests a gentle loss back to
  // it, a deficit with no answers to the low-energy questions, which Today
  // asks first.
  const drifted = emptyJournal();
  drifted.createdAt = "2026-08-30T07:00:00.000Z";
  applyGoals(
    drifted,
    {
      age: 30,
      sex: "female",
      heightCm: 168,
      weightKg: 62,
      targetWeightKg: 62,
      targetDate: null,
      activity: "moderate",
      trainingDays: 4,
      sessionMinutes: 75,
      experience: "developing",
    },
    "2026-09-01",
  );
  drifted.profile.body!.updatedAt = "2026-09-01T07:00:00.000Z";
  drifted.profile.targetHistory = drifted.profile.targetHistory!.map((r) => ({
    ...r,
    setAt: "2026-09-01T07:00:00.000Z",
  }));
  for (const [day, kg] of [
    [-5, 63],
    [-2, 63.2],
    [0, 63.1],
  ] as const)
    drifted.health.checkins.push({
      date: offsetDate(date, day),
      sleepHours: null,
      energy: null,
      soreness: null,
      waterMl: null,
      bodyweight: kg,
      notes: "",
      updatedAt: `${offsetDate(date, day)}T06:30:00.000Z`,
    });
  // Goals saved on 29 August at 88 kg, heading for 81 kg, and four weeks of
  // weigh-ins coming down about 1 kg a week since, faster than the plan's
  // 0.44 kg and above 1 % of bodyweight a week for 3 weeks: Today's Body
  // carries the trend, this week's average against last week's, the trend
  // against the plan and an amber note.
  const falling = emptyJournal();
  falling.createdAt = "2026-08-27T07:00:00.000Z";
  applyGoals(
    falling,
    {
      age: 34,
      sex: "male",
      heightCm: 182,
      weightKg: 88,
      targetWeightKg: 81,
      targetDate: null,
      activity: "moderate",
      trainingDays: 4,
      sessionMinutes: 75,
      experience: "developing",
    },
    "2026-08-29",
  );
  falling.profile.body!.updatedAt = "2026-08-29T07:00:00.000Z";
  falling.profile.targetHistory = falling.profile.targetHistory!.map((r) => ({
    ...r,
    setAt: "2026-08-29T07:00:00.000Z",
  }));
  const wiggle = [0.2, -0.1, 0.1, -0.2, 0, 0.15, -0.15];
  [-27, -25, -23, -21, -19, -17, -15, -13, -11, -9, -7, -5, -3, -1, 0].forEach(
    (day, i) =>
      falling.health.checkins.push({
        date: offsetDate(date, day),
        sleepHours: null,
        energy: null,
        soreness: null,
        waterMl: null,
        bodyweight:
          Math.round((88 + (day + 27) * (-1 / 7) + wiggle[i % 7]!) * 10) / 10,
        notes: "",
        updatedAt: `${offsetDate(date, day)}T06:30:00.000Z`,
      }),
  );
  return {
    "workout.json": workoutInProgress(state),
    "today.json": buildToday(state, 12, date, imported),
    "today-short-sleep.json": buildToday(shortSleep, 12, date, imported),
    "today-targets.json": buildToday(reached, 12, date, new Set()),
    "today-targets-check.json": buildToday(drifted, 12, date, new Set()),
    "today-weight-trend.json": buildToday(falling, 12, date, new Set()),
    "trends-targets.json": buildTrends(reached, date, 7),
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
          id: "8b2d3f8e-2a51-4c1e-9d0b-0c1f7c1e2a24",
          question: "I'm 16 and want to get down to 55 kg",
          photoIds: [],
          createdAt: now.toISOString(),
          status: "done",
          reply: "Here is your plan to review.",
          visuals: [],
          proposals: [
            {
              id: "9c3e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a25",
              title: goals.title,
              detail: goals.detail,
              expiresAt: "2026-09-27T18:00:00.000Z",
              workout: null,
              targets: goals.targets,
              targetsBefore: goals.targetsBefore,
              notes: goals.notes,
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

// Monday's programme in progress for a 16-year-old after a 5 h 30 min night:
// the snatch waits for a coach's technique check, the snatch pull proposes a
// reset after two sessions with a miss, and one set carries an RPE.
function workoutInProgress(journal: ReturnType<typeof emptyJournal>) {
  const state = structuredClone(journal);
  const monday = days.find((d) => d.id === "monday")!;
  state.profile.age = 16;
  state.health.checkins[0].sleepHours = 5.5;
  for (const [i, sessionDate] of ["2026-09-14", "2026-09-21"].entries()) {
    const done = createWorkout(state, monday, sessionDate);
    done.id = `monday-${i + 1}`;
    done.finishedAt = `${sessionDate}T18:00:00.000Z`;
    done.exercises = done.exercises.slice(0, 2);
    for (const [weight, entry] of [60, 80].map(
      (w, j) => [w, done.exercises[j]] as const,
    )) {
      entry.prescribed.targetWeight = weight;
      entry.sets.forEach((s) => {
        Object.assign(s, {
          weight: String(weight),
          rpe: "8",
          result: "success",
          logged: true,
        });
      });
    }
    done.exercises[1].sets[3].result = "miss";
    state.sessions.push(done);
  }
  const active = createWorkout(state, monday, date);
  active.id = "0e5f3f8e-2a51-4c1e-9d0b-0c1f7c1e2a17";
  active.exercises.forEach((entry, i) => {
    entry.id = `entry-${i + 1}`;
    entry.sets.forEach((s, j) => (s.id = `set-${i + 1}-${j + 1}`));
  });
  Object.assign(active.exercises[2].sets[0], {
    weight: "100",
    result: "success",
    logged: true,
    rpe: 7,
  });
  state.activeWorkout = active;
  return workoutView(active, false, state);
}
