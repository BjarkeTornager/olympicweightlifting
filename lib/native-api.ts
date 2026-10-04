import { supplementsForDay } from "./supplements";
import {
  burnText,
  burnedNote,
  burnedToday,
  cardioBurn,
  strengthBurn,
} from "./energy";
import { z } from "zod";
import { cardioActivities, cardioTitle, formatDuration } from "./cardio";
import { dailyHealth, formatSleepDuration, offsetDate } from "./health";
import {
  drinkKinds,
  formatLitres,
  formatTargetLitres,
  hydrationForDay,
  hydrationNote,
  hydrationTargetMl,
  usualHydrationTargets,
} from "./hydration";
import type { JournalState } from "./model";
import { nextTraining } from "./next-training";
import {
  dailyTarget,
  mealTypes,
  totalNutrients,
  type Nutrients,
} from "./nutrition";
import type { SavedVisual } from "./coach-visuals";
import { describeRoute, type RouteNote } from "./route-summary";
import {
  bodyFatByDate,
  bodyFatMethods,
  latestBodyFat,
  weightTrend,
} from "./body-composition";
import { notesForTargets, planForState } from "./body-goals";
import { localClock, timeZoneSchema } from "./reminders";
import { withoutEmDashes } from "./agent/coach-style";
import type { ActionPreview, PreviewEntry } from "./agent/actions";
import { exerciseName } from "./domain";
import { isValidLoggedSet } from "../js/progression.js";

// The iPhone app's contract. These schemas are the single description of
// /api/v1: route handlers build responses with them, and
// `scripts/openapi.ts` turns them into the OpenAPI document the Swift client
// is generated from. Responses are views shaped for the app, not the raw
// journal, so the journal's storage format can change without breaking
// installed builds. Optional fields are omitted rather than null.
export const nativeResponses = z.registry<{ id: string }>();
export const nativeRequests = z.registry<{ id: string }>();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.iso.datetime({ offset: true });
const uuid = z.string().uuid();
const int = z.number().int();

export const errorBody = z
  .object({ error: z.string() })
  .register(nativeResponses, { id: "ErrorBody" });

const voiceOption = z
  .object({
    provider: z.enum(["google", "elevenlabs"]),
    id: z.string(),
    name: z.string(),
    detail: z.string(),
    isDefault: z.boolean(),
    // A short sample per language, played when picking; absent before 3 Oct.
    samples: z
      .object({ en: z.string().optional(), da: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict()
  .register(nativeResponses, { id: "VoiceOption" });

export const nativeConfig = z
  .object({
    minimumBuild: int,
    voice: z.boolean(),
    // Which voices the app may offer; absent from servers before 30 Sept.
    voiceProviders: z.array(z.enum(["google", "elevenlabs"])).optional(),
    // The voices to pick from in Profile; absent before 2 October.
    voiceOptions: z.array(voiceOption).optional(),
    serverTime: instant,
  })
  .strict()
  .register(nativeResponses, { id: "NativeConfig" });

const drinkView = z
  .object({
    id: uuid,
    ml: int,
    kind: z.enum(drinkKinds),
    name: z.string(),
    at: instant,
    // A usual size, saved because the volume wasn't given. Absent before
    // 4 October.
    estimated: z.boolean().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "Drink" });
const supplementView = z
  .object({
    id: uuid,
    name: z.string(),
    amount: z.string(),
    at: instant,
  })
  .strict()
  .register(nativeResponses, { id: "Supplement" });
// Taken today, and usual ones (two of the last fourteen days) still to take.
const supplementsView = z
  .object({
    taken: z.array(supplementView),
    usual: z.array(
      z
        .object({ name: z.string(), amount: z.string() })
        .strict()
        .register(nativeResponses, { id: "UsualSupplement" }),
    ),
  })
  .strict()
  .register(nativeResponses, { id: "Supplements" });
const mealView = z
  .object({
    id: uuid,
    name: z.string(),
    type: z.enum(mealTypes),
    calories: z.number(),
    protein: z.number(),
    estimated: z.boolean(),
    createdAt: instant,
  })
  .strict()
  .register(nativeResponses, { id: "Meal" });
const activityView = z
  .object({
    id: z.string(),
    activity: z.enum(cardioActivities),
    title: z.string(),
    date: day,
    durationSeconds: int,
    durationText: z.string(),
    distanceKm: z.number().optional(),
    averageHeartRate: int.optional(),
    maxHeartRate: int.optional(),
    caloriesKcal: z.number().optional(),
    fromAppleHealth: z.boolean(),
    // A GPS route was recorded: GET /api/v1/activities/{id}/route draws it.
    hasRoute: z.boolean().optional(),
    // Where it went, such as "From Vesterbro out to Frederiksberg Have and back".
    routeText: z.string().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "Activity" });
const vitalsView = z
  .object({
    date: day,
    restingHeartRate: int.optional(),
    heartRateVariabilityMs: z.number().optional(),
    averageHeartRate: int.optional(),
    steps: int.optional(),
    activeEnergyKcal: int.optional(),
  })
  .strict()
  .register(nativeResponses, { id: "Vitals" });
const sleepView = z
  .object({
    hours: z.number().optional(),
    text: z.string().optional(),
    fromAppleHealth: z.boolean(),
    averageHours: z.number().optional(),
    nights: int,
  })
  .strict()
  .register(nativeResponses, { id: "Sleep" });
const checkinView = z
  .object({
    energy: int.optional(),
    soreness: int.optional(),
    bodyweight: z.number().optional(),
    notes: z.string(),
  })
  .strict()
  .register(nativeResponses, { id: "Checkin" });
const nutritionView = z
  .object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    targetCalories: z.number().optional(),
    targetProtein: z.number().optional(),
    meals: z.array(mealView),
  })
  .strict()
  .register(nativeResponses, { id: "Nutrition" });
// The target is for drinks, in quarter litres, with a range of about half a
// litre either side. The fields after drinks are absent before 4 October.
const hydrationView = z
  .object({
    totalMl: int,
    targetMl: int,
    estimatedTarget: z.boolean(),
    drinks: z.array(drinkView),
    targetLowMl: int.optional(),
    targetHighMl: int.optional(),
    // The athlete chose not to see a drinks target: no meter, no reminders.
    targetHidden: z.boolean().optional(),
    // For Account: a rest day's target and a lifting day's.
    restDayTargetMl: int.optional(),
    liftingDayTargetMl: int.optional(),
    // What the target rests on, and the everyday signs to go by.
    note: z.string().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "Hydration" });
const workoutView = z
  .object({
    id: z.string(),
    title: z.string(),
    date: day,
    exercises: int,
    loggedSets: int,
  })
  .strict()
  .register(nativeResponses, { id: "WorkoutSummary" });
const nextSessionView = z
  .object({
    programId: z.string(),
    programName: z.string(),
    dayId: z.string(),
    title: z.string(),
    position: int,
    count: int,
    exercises: int,
    canStart: z.boolean(),
    custom: z.boolean(),
  })
  .strict()
  .register(nativeResponses, { id: "NextSession" });
const priorityView = z
  .object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    reason: z.string(),
    action: z.string(),
  })
  .strict()
  .register(nativeResponses, { id: "Priority" });

// Body composition at a glance: the latest body fat and weight, lean mass,
// and the goal's focus and targets.
const bodyView = z
  .object({
    bodyFatPercent: z.number().optional(),
    bodyFatDate: day.optional(),
    bodyFatMethod: z.string().optional(),
    bodyFatFromAppleHealth: z.boolean().optional(),
    bodyweight: z.number().optional(),
    bodyweightDate: day.optional(),
    // Average change a week over the last four weeks of weigh-ins.
    weeklyWeightChangeKg: z.number().optional(),
    leanMassKg: z.number().optional(),
    // lose_fat, build_muscle, recomposition or maintain.
    focus: z.string().optional(),
    targetWeightKg: z.number().optional(),
    targetBodyFatPercent: z.number().optional(),
    // The goal plan's notes, shown with the goals: why it holds weight or
    // loses more slowly, and who to talk to. When the saved daily targets
    // aren't the plan's, one line saying so instead. Optional, as new
    // fields are.
    goalNotes: z.array(z.string()).optional(),
  })
  .strict()
  .register(nativeResponses, { id: "Body" });

// Calories burned today: Apple Health's active energy, or the training
// total when that is missing. Never offsets the food target.
const burnedView = z
  .object({
    kcal: int,
    source: z.enum(["apple-health", "training"]),
    estimated: z.boolean(),
    note: z.string(),
  })
  .strict()
  .register(nativeResponses, { id: "Burned" });

// A new person's steps to a full day: Apple Health brings sleep and
// movement, a meal brings food, and goals give the rings their targets.
const firstStepsView = z
  .object({
    appleHealth: z.boolean(),
    meal: z.boolean(),
    goals: z.boolean(),
  })
  .strict()
  .register(nativeResponses, { id: "FirstSteps" });

export const todayView = z
  .object({
    date: day,
    revision: int,
    name: z.string().optional(),
    sleep: sleepView,
    vitals: vitalsView.optional(),
    checkin: checkinView.optional(),
    // Optional: builds from before body composition must still decode.
    body: bodyView.optional(),
    nutrition: nutritionView,
    hydration: hydrationView,
    // Optional: builds from before calories burned must still decode.
    burned: burnedView.optional(),
    // Optional: builds from before supplements must still decode.
    supplements: supplementsView.optional(),
    activeWorkout: workoutView.optional(),
    nextSession: nextSessionView.optional(),
    strengthToday: z.array(workoutView),
    activities: z.array(activityView),
    sessionsThisWeek: int,
    priorities: z.array(priorityView),
    // Only in a journal's first two weeks, until all three are done.
    firstSteps: firstStepsView.optional(),
    // The day the journal began, which Today's issue number counts from, so
    // it carries on across installs. Optional, as builds must still decode a
    // server from before it.
    journalStartDate: day.optional(),
  })
  .strict()
  .register(nativeResponses, { id: "Today" });
export type TodayView = z.infer<typeof todayView>;

const receiptLine = z
  .object({
    label: z.string(),
    // A portion or other detail shown under the label.
    note: z.string().optional(),
    value: z.string().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "CoachReceiptLine" });
const receiptEntry = z
  .object({
    title: z.string(),
    summary: z.string().optional(),
    date: day.optional(),
    lines: z.array(receiptLine),
    footnote: z.string().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "CoachReceiptEntry" });
const journalItem = z
  .object({
    id: z.string(),
    date: day,
    kind: z.enum([
      "strength",
      "cardio",
      "meal",
      "sleep",
      "checkin",
      "vitals",
      "body",
    ]),
    title: z.string(),
    detail: z.string(),
    fromAppleHealth: z.boolean(),
    hasRoute: z.boolean().optional(),
    // For cardio, the kind of activity, for its symbol.
    activity: z.enum(cardioActivities).optional(),
    // Everything recorded, shown when the athlete opens the item: in the
    // same shape as a Coach receipt's entries. Strength opens the session.
    details: receiptEntry.optional(),
  })
  .strict()
  .register(nativeResponses, { id: "JournalItem" });
export const journalFeed = z
  .object({
    revision: int,
    items: z.array(journalItem),
    // Pass as `before` to load the next, older page.
    nextBefore: day.optional(),
  })
  .strict()
  .register(nativeResponses, { id: "JournalFeed" });
export type JournalFeed = z.infer<typeof journalFeed>;

export const actionResult = z
  .object({
    id: uuid,
    status: z.enum(["saved", "duplicate"]),
    title: z.string(),
    detail: z.string(),
    revision: int,
  })
  .strict()
  .register(nativeResponses, { id: "ActionResult" });

export const healthSyncResult = z
  .object({
    revision: int,
    changed: z.boolean(),
    sleep: z.array(
      z
        .object({
          date: day,
          result: z.enum([
            "imported",
            "updated",
            "unchanged",
            "preserved",
            "failed",
          ]),
          hours: z.number().optional(),
          error: z.string().optional(),
        })
        .strict()
        .register(nativeResponses, { id: "SleepSyncResult" }),
    ),
    daysUpdated: int,
    bodyFatUpdated: int.optional(),
    workouts: z.array(
      z
        .object({
          id: uuid,
          result: z.enum([
            "imported",
            "updated",
            "matched",
            "unchanged",
            "preserved",
            "removed",
            "skipped",
          ]),
        })
        .strict()
        .register(nativeResponses, { id: "WorkoutSyncResult" }),
    ),
    // "pending" means the workout is not in the journal yet: send it again.
    routes: z
      .array(
        z
          .object({
            workoutId: uuid,
            result: z.enum(["saved", "unchanged", "skipped", "pending"]),
          })
          .strict()
          .register(nativeResponses, { id: "RouteSyncResult" }),
      )
      .optional(),
  })
  .strict()
  .register(nativeResponses, { id: "HealthSyncResult" });

// Requests. Each action mirrors one variant of the Coach action schema and is
// validated again by it on the server; the app sends only these kinds.
const logDrink = z
  .object({
    kind: z.literal("log_drink"),
    drink: z
      .object({
        date: day,
        ml: int.min(10).max(5000),
        kind: z.enum(drinkKinds),
        name: z.string().max(120).optional(),
      })
      .strict(),
  })
  .strict()
  .register(nativeRequests, { id: "LogDrinkAction" });
const deleteDrink = z
  .object({ kind: z.literal("delete_drink"), drinkId: uuid })
  .strict()
  .register(nativeRequests, { id: "DeleteDrinkAction" });
const logSupplement = z
  .object({
    kind: z.literal("log_supplement"),
    supplement: z
      .object({
        date: day,
        name: z.string().min(1).max(80),
        amount: z.string().max(40).optional(),
      })
      .strict(),
  })
  .strict()
  .register(nativeRequests, { id: "LogSupplementAction" });
const deleteSupplement = z
  .object({ kind: z.literal("delete_supplement"), supplementId: uuid })
  .strict()
  .register(nativeRequests, { id: "DeleteSupplementAction" });
const recordBodyFat = z
  .object({
    kind: z.literal("record_body_fat"),
    bodyFat: z
      .object({
        date: day,
        percent: z.number().min(3).max(70),
        method: z.enum(bodyFatMethods).optional(),
      })
      .strict()
      .register(nativeRequests, { id: "BodyFatInput" }),
  })
  .strict()
  .register(nativeRequests, { id: "RecordBodyFatAction" });
const deleteBodyFat = z
  .object({ kind: z.literal("delete_body_fat"), date: day })
  .strict()
  .register(nativeRequests, { id: "DeleteBodyFatAction" });
const recordCheckin = z
  .object({
    kind: z.literal("record_checkin"),
    checkin: z
      .object({
        date: day,
        sleepHours: z.number().min(0).max(24).optional(),
        energy: int.min(1).max(5).optional(),
        soreness: int.min(1).max(5).optional(),
        bodyweight: z.number().min(20).max(500).optional(),
        notes: z.string().max(2000).optional(),
      })
      .strict(),
  })
  .strict()
  .register(nativeRequests, { id: "RecordCheckinAction" });
const deleteCardio = z
  .object({ kind: z.literal("delete_cardio"), cardioId: uuid })
  .strict()
  .register(nativeRequests, { id: "DeleteCardioAction" });
const startProgramme = z
  .object({
    kind: z.literal("start_programme"),
    dayId: z.string().max(160),
    date: day,
  })
  .strict()
  .register(nativeRequests, { id: "StartProgrammeAction" });
const logSets = z
  .object({
    kind: z.literal("log_sets"),
    exerciseId: z.string().max(160),
    sets: z
      .array(
        z
          .object({
            weight: z.number().min(0).max(1000),
            reps: int.min(1).max(1000),
            result: z.enum(["success", "miss"]),
            rpe: z.number().min(1).max(10).optional(),
          })
          .strict()
          .register(nativeRequests, { id: "LoggedSet" }),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .register(nativeRequests, { id: "LogSetsAction" });
const finishWorkout = z
  .object({ kind: z.literal("finish_workout") })
  .strict()
  .register(nativeRequests, { id: "FinishWorkoutAction" });
const discardWorkout = z
  .object({ kind: z.literal("discard_workout") })
  .strict()
  .register(nativeRequests, { id: "DiscardWorkoutAction" });

const startTrainingDay = z
  .object({
    kind: z.literal("start_training_day"),
    trainingProgramId: uuid,
    dayId: uuid,
    date: day,
  })
  .strict()
  .register(nativeRequests, { id: "StartTrainingDayAction" });
const correctSet = z
  .object({
    kind: z.literal("correct_workout_set"),
    workoutId: z.string().max(160),
    entryId: z.string().max(160),
    setId: z.string().max(160),
    setChanges: z
      .object({
        weight: z.number().min(0).max(1000).optional(),
        reps: int.min(0).max(1000).optional(),
        result: z.enum(["success", "miss"]).optional(),
      })
      .strict()
      .register(nativeRequests, { id: "SetChanges" }),
  })
  .strict()
  .register(nativeRequests, { id: "CorrectSetAction" });
// A programme as the app edits it. The server fills a missing weight with
// null ("choose a load when training"), as the Coach schema requires.
const programmeInput = z
  .object({
    name: z.string().max(120),
    notes: z.string().max(2000).optional(),
    weeks: int.min(1).max(104).optional(),
    days: z
      .array(
        z
          .object({
            id: uuid.optional(),
            name: z.string().max(120),
            notes: z.string().max(2000).optional(),
            exercises: z
              .array(
                z
                  .object({
                    exerciseId: z.string().max(160),
                    sets: int.min(1).max(30),
                    reps: int.min(1).max(1000),
                    repsMax: int.min(1).max(1000).optional(),
                    weight: z.number().min(0).max(1000).optional(),
                    restSeconds: int.min(0).max(1800).optional(),
                    targetRpe: z.number().min(1).max(10).optional(),
                    notes: z.string().max(2000).optional(),
                  })
                  .strict()
                  .register(nativeRequests, { id: "ProgrammeExerciseInput" }),
              )
              .max(30),
          })
          .strict()
          .register(nativeRequests, { id: "ProgrammeDayInput" }),
      )
      .min(1)
      .max(28),
  })
  .strict()
  .register(nativeRequests, { id: "ProgrammeInput" });
const createProgramme = z
  .object({
    kind: z.literal("create_training_program"),
    trainingProgram: programmeInput,
  })
  .strict()
  .register(nativeRequests, { id: "CreateProgrammeAction" });
const updateProgramme = z
  .object({
    kind: z.literal("update_training_program"),
    trainingProgramId: uuid,
    programChanges: programmeInput,
  })
  .strict()
  .register(nativeRequests, { id: "UpdateProgrammeAction" });
const deleteProgramme = z
  .object({
    kind: z.literal("delete_training_program"),
    trainingProgramId: uuid,
  })
  .strict()
  .register(nativeRequests, { id: "DeleteProgrammeAction" });
// App-only: which programme Train follows. The website sets this directly.
const useProgramme = z
  .object({
    kind: z.literal("use_programme"),
    programmeId: z.string().max(160),
  })
  .strict()
  .register(nativeRequests, { id: "UseProgrammeAction" });
// App-only: whether Today shows a drinks target. The website sets this in
// Settings.
const setHydrationTarget = z
  .object({
    kind: z.literal("set_hydration_target"),
    hidden: z.boolean(),
  })
  .strict()
  .register(nativeRequests, { id: "SetHydrationTargetAction" });

export const nativeAction = z
  .discriminatedUnion("kind", [
    logDrink,
    deleteDrink,
    logSupplement,
    deleteSupplement,
    recordBodyFat,
    deleteBodyFat,
    recordCheckin,
    deleteCardio,
    startProgramme,
    logSets,
    finishWorkout,
    discardWorkout,
    startTrainingDay,
    correctSet,
    createProgramme,
    updateProgramme,
    deleteProgramme,
    useProgramme,
    setHydrationTarget,
  ])
  .register(nativeRequests, { id: "NativeAction" });
export const nativeActionKinds = nativeAction.options.map(
  (o) => o.shape.kind.value,
);
export const actionRequest = z
  .object({
    // Idempotency key: a retried request with the same ID is saved once.
    id: uuid,
    timezone: z.string().max(100),
    action: nativeAction,
  })
  .strict()
  .register(nativeRequests, { id: "ActionRequest" });

// ---- Views -----------------------------------------------------------------

const defined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], null> };

const loggedSets = (w: JournalState["sessions"][number]) =>
  w.exercises.reduce((n, e) => n + e.sets.filter(isValidLoggedSet).length, 0);
const workoutSummary = (w: JournalState["sessions"][number]) => ({
  id: w.id,
  title: w.title,
  date: w.date,
  exercises: w.exercises.length,
  loggedSets: loggedSets(w),
});

const routeText = (note?: RouteNote) => {
  const text = note ? describeRoute(note) : "";
  return text ? text[0]!.toUpperCase() + text.slice(1) : undefined;
};

function activity(
  e: JournalState["cardio"]["sessions"][number],
  fromAppleHealth: Set<string>,
  routes: Map<string, RouteNote>,
) {
  return defined({
    id: e.id,
    activity: e.activity,
    title: cardioTitle(e),
    date: e.date,
    durationSeconds: e.durationSeconds,
    durationText: formatDuration(e.durationSeconds),
    distanceKm: e.distanceKm,
    averageHeartRate: e.averageHeartRate,
    maxHeartRate: e.maxHeartRate,
    caloriesKcal: e.caloriesKcal,
    fromAppleHealth: fromAppleHealth.has(e.id),
    hasRoute: routes.has(e.id),
    routeText: routeText(routes.get(e.id)),
  });
}

function bodyForToday(state: JournalState, date: string) {
  const fat = latestBodyFat(state, date);
  const weights = state.health.checkins
    .filter(
      (c) =>
        c.bodyweight != null &&
        c.date <= date &&
        c.date >= offsetDate(date, -30),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const weight = weights.at(-1);
  const plan = planForState(state, date);
  // Shown beside the saved targets, so only notes that describe them.
  const notes = plan ? notesForTargets(plan, state.nutrition.targets) : [];
  const body = defined({
    bodyFatPercent: fat?.percent,
    bodyFatDate: fat?.date,
    bodyFatMethod: fat?.method ?? undefined,
    bodyFatFromAppleHealth: fat ? fat.source === "apple-health" : undefined,
    bodyweight: weight?.bodyweight ?? undefined,
    bodyweightDate: weight?.date,
    weeklyWeightChangeKg: weightTrend(state, date)?.kg_per_week ?? undefined,
    leanMassKg:
      fat && weight?.bodyweight
        ? Math.round(weight.bodyweight * (1 - fat.percent / 100) * 10) / 10
        : undefined,
    focus: plan?.focus,
    targetWeightKg: state.profile.body?.targetWeightKg,
    targetBodyFatPercent: plan?.targetBodyFatPercent ?? undefined,
    goalNotes: notes.length ? notes : undefined,
  });
  return Object.keys(body).length ? body : undefined;
}

// What a new journal has done of its first steps, for its first two weeks;
// undefined once they're all done or the journal is older.
export function firstSteps(state: JournalState, date: string) {
  if (offsetDate(state.createdAt.slice(0, 10), 13) < date) return undefined;
  const steps = {
    // Anything that only the Apple Health sync writes.
    appleHealth:
      state.health.checkins.some((c) => c.sleepImport) ||
      Boolean(state.health.vitals?.length) ||
      Boolean(state.health.bodyFat?.some((b) => b.source === "apple-health")),
    meal: state.nutrition.meals.length > 0,
    // Goals saved in pregnancy set no calorie target, and still count.
    goals:
      dailyTarget(state.nutrition.targets.calories) != null ||
      state.profile.goalChecks?.pregnancy === "pregnant",
  };
  return Object.values(steps).every(Boolean) ? undefined : steps;
}

// The day the journal began, in the athlete's time zone (the iPhone's, else
// the profile's, else Copenhagen's): the day it was created, or that of an
// earlier record logged by hand (from a backup brought in, say). What Apple
// Health brought is left out, wherever it falls: its first sync fills in the
// two weeks, and the workouts of the two months, before the journal began.
export function journalStartDate(
  state: JournalState,
  fromAppleHealth: Set<string>,
  timezone?: string,
) {
  const zone =
    [timezone, state.profile.timezone].find(
      (t) => timeZoneSchema.safeParse(t).success,
    ) ?? "Europe/Copenhagen";
  let first = localClock(new Date(state.createdAt), zone).date;
  for (const date of [
    ...state.sessions.map((s) => s.date),
    ...state.cardio.sessions
      .filter((s) => !fromAppleHealth.has(s.id))
      .map((s) => s.date),
    ...state.nutrition.meals.map((m) => m.date),
    ...state.health.checkins.filter((c) => !c.sleepImport).map((c) => c.date),
    ...(state.health.drinks ?? []).map((d) => d.date),
    ...(state.health.supplements ?? []).map((s) => s.date),
    ...(state.health.bodyFat ?? [])
      .filter((b) => b.source !== "apple-health")
      .map((b) => b.date),
  ])
    if (day.safeParse(date).success && date < first) first = date;
  return first;
}

export function buildToday(
  state: JournalState,
  revision: number,
  date: string,
  fromAppleHealth: Set<string>,
  routes: Map<string, RouteNote> = new Map(),
  // The iPhone's time zone, for the day the journal began.
  timezone?: string,
): TodayView {
  const health = dailyHealth(state, date);
  const hydration = hydrationForDay(state, date);
  const usual = usualHydrationTargets(state, date);
  const usualTargets = {
    restDayTargetMl: usual.restDayMl,
    liftingDayTargetMl: usual.liftingDayMl,
  };
  const meals = state.nutrition.meals.filter((m) => m.date === date);
  const vitals =
    state.health.vitals?.find((v) => v.date === date) ??
    state.health.vitals?.find((v) => v.date === offsetDate(date, -1));
  const checkin = health.checkin;
  const burned = burnedToday(state, date);
  const supplements = supplementsForDay(state, date);
  const next = state.activeWorkout ? null : nextTraining(state, date);
  return todayView.parse(
    defined({
      date,
      revision,
      name: state.profile.name,
      sleep: defined({
        hours: checkin?.sleepHours,
        text:
          checkin?.sleepHours != null
            ? formatSleepDuration(checkin.sleepHours)
            : undefined,
        fromAppleHealth: Boolean(checkin?.sleepImport),
        averageHours: health.sleepAverage,
        nights: health.sleepSamples,
      }),
      vitals: vitals
        ? defined({
            date: vitals.date,
            restingHeartRate: vitals.restingHeartRate,
            heartRateVariabilityMs: vitals.heartRateVariabilityMs,
            averageHeartRate: vitals.averageHeartRate,
            steps: vitals.steps,
            activeEnergyKcal: vitals.activeEnergyKcal,
          })
        : undefined,
      checkin:
        checkin &&
        (checkin.energy != null ||
          checkin.soreness != null ||
          checkin.bodyweight != null ||
          checkin.notes)
          ? defined({
              energy: checkin.energy,
              soreness: checkin.soreness,
              bodyweight: checkin.bodyweight,
              notes: checkin.notes,
            })
          : undefined,
      body: bodyForToday(state, date),
      nutrition: defined({
        ...totalNutrients(meals.flatMap((m) => m.items)),
        // A target of 0 is no target.
        targetCalories:
          dailyTarget(state.nutrition.targets?.calories) ?? undefined,
        targetProtein:
          dailyTarget(state.nutrition.targets?.protein) ?? undefined,
        meals: meals.map((m) => {
          const total = totalNutrients(m.items);
          return {
            id: m.id,
            name: m.name,
            type: m.type,
            calories: total.calories,
            protein: total.protein,
            estimated: m.estimated,
            createdAt: m.createdAt,
          };
        }),
      }),
      burned: burned ? { ...burned, note: burnedNote(burned) } : undefined,
      supplements: {
        taken: supplements.taken.map((s) => ({
          id: s.id,
          name: s.name,
          amount: s.amount,
          at: s.at,
        })),
        usual: supplements.usual,
      },
      hydration: {
        totalMl: hydration.totalMl,
        targetMl: hydration.targetMl,
        estimatedTarget: hydration.estimated,
        drinks: hydration.drinks.map((d) =>
          defined({
            id: d.id,
            ml: d.ml,
            kind: d.kind,
            name: d.name,
            at: d.at,
            estimated: d.estimated,
          }),
        ),
        targetLowMl: hydration.lowMl,
        targetHighMl: hydration.highMl,
        ...(hydration.hidden ? { targetHidden: true } : {}),
        ...usualTargets,
        note: hydrationNote(state, date),
      },
      activeWorkout: state.activeWorkout
        ? workoutSummary(state.activeWorkout)
        : undefined,
      // Only for someone who follows a programme; Train suggests one otherwise.
      nextSession: next?.following
        ? {
            programId: next.programId,
            programName: next.programName,
            dayId: next.dayId,
            title: next.title,
            position: next.position,
            count: next.count,
            exercises: next.exercises,
            canStart: next.canStart,
            custom: next.custom,
          }
        : undefined,
      strengthToday: state.sessions
        .filter((s) => s.date === date)
        .map(workoutSummary),
      activities: state.cardio.sessions
        .filter((s) => s.date === date)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((e) => activity(e, fromAppleHealth, routes)),
      sessionsThisWeek: health.sessionsThisWeek,
      priorities: health.priorities.map((p) => ({
        id: p.id,
        category: p.category,
        title: p.title,
        reason: p.reason,
        action: p.action,
      })),
      firstSteps: firstSteps(state, date),
      journalStartDate: journalStartDate(state, fromAppleHealth, timezone),
    }),
  );
}

const kmText = (km: number) =>
  `${km.toLocaleString("en-GB", { maximumFractionDigits: 2 })} km`;

// Everything recorded, newest day first, a fixed number of days per page.
// A night's sleep: how long, and when, if Apple Health measured it.
function sleepDetails(
  c: JournalState["health"]["checkins"][number],
  timezone = "Europe/Copenhagen",
): z.infer<typeof receiptEntry> {
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const night = c.sleepImport;
  return defined({
    title: "Sleep",
    date: c.date,
    lines: [
      { label: "Asleep", value: formatSleepDuration(c.sleepHours ?? 0) },
      ...(night
        ? [
            {
              label: "Night",
              value: `${time(night.start)} to ${time(night.end)}`,
            },
          ]
        : []),
    ],
    footnote: night ? "From Apple Health" : "Reported by you",
  });
}

export function buildJournal(
  state: JournalState,
  revision: number,
  before: string,
  days: number,
  fromAppleHealth: Set<string>,
  routes: Map<string, RouteNote> = new Map(),
): JournalFeed {
  const from = offsetDate(before, -days);
  const inRange = (d: string) => d < before && d >= from;
  const items: z.infer<typeof journalItem>[] = [];
  for (const s of state.sessions.filter((s) => inRange(s.date)))
    items.push({
      id: s.id,
      date: s.date,
      kind: "strength",
      title: s.title,
      detail: [
        `${s.exercises.length} exercises · ${loggedSets(s)} sets`,
        burnText(strengthBurn(state, s)),
      ]
        .filter(Boolean)
        .join(" · "),
      fromAppleHealth: false,
    });
  for (const e of state.cardio.sessions.filter((e) => inRange(e.date)))
    items.push({
      id: e.id,
      date: e.date,
      kind: "cardio",
      title: cardioTitle(e),
      detail: [
        formatDuration(e.durationSeconds),
        e.distanceKm != null ? kmText(e.distanceKm) : "",
        e.averageHeartRate != null ? `${e.averageHeartRate} bpm avg` : "",
        burnText(cardioBurn(state, e)),
      ]
        .filter(Boolean)
        .join(" · "),
      fromAppleHealth: fromAppleHealth.has(e.id),
      hasRoute: routes.has(e.id),
      activity: e.activity,
      details: receiptEntryView({ title: "", detail: "", cardio: e }),
    });
  for (const m of state.nutrition.meals.filter((m) => inRange(m.date))) {
    const total = totalNutrients(m.items);
    items.push({
      id: m.id,
      date: m.date,
      kind: "meal",
      title: m.name,
      detail: `${Math.round(total.calories)} kcal · ${Math.round(total.protein)} g protein${m.estimated ? " · estimated" : ""}`,
      fromAppleHealth: false,
      details: receiptEntryView({ title: "", detail: "", meal: m }),
    });
  }
  for (const c of state.health.checkins.filter((c) => inRange(c.date))) {
    if (c.sleepHours != null)
      items.push({
        id: `sleep-${c.date}`,
        date: c.date,
        kind: "sleep",
        title: "Sleep",
        detail: formatSleepDuration(c.sleepHours),
        fromAppleHealth: Boolean(c.sleepImport),
        details: sleepDetails(c, state.profile.timezone),
      });
    const reported = [
      c.energy != null ? `energy ${c.energy}/5` : "",
      c.soreness != null ? `soreness ${c.soreness}/5` : "",
      c.bodyweight != null ? `${c.bodyweight} kg` : "",
    ].filter(Boolean);
    if (reported.length || c.notes)
      items.push({
        id: `checkin-${c.date}`,
        date: c.date,
        kind: "checkin",
        title: "Check-in",
        detail: reported.join(" · ") || c.notes.slice(0, 120),
        fromAppleHealth: false,
        // Sleep has its own item.
        details: receiptEntryView({
          title: "",
          detail: "",
          checkin: { ...c, sleepHours: null },
        }),
      });
  }
  for (const v of (state.health.vitals ?? []).filter((v) => inRange(v.date))) {
    const detail = [
      v.restingHeartRate != null ? `resting ${v.restingHeartRate} bpm` : "",
      v.heartRateVariabilityMs != null
        ? `HRV ${Math.round(v.heartRateVariabilityMs)} ms`
        : "",
      v.steps != null ? `${v.steps.toLocaleString("en-GB")} steps` : "",
    ].filter(Boolean);
    if (detail.length)
      items.push({
        id: `vitals-${v.date}`,
        date: v.date,
        kind: "vitals",
        title: "Heart and movement",
        detail: detail.join(" · "),
        fromAppleHealth: true,
        details: {
          title: "Heart and movement",
          date: v.date,
          lines: [
            v.restingHeartRate != null && {
              label: "Resting heart rate",
              value: `${v.restingHeartRate} bpm`,
            },
            v.heartRateVariabilityMs != null && {
              label: "Heart rate variability",
              value: `${Math.round(v.heartRateVariabilityMs)} ms`,
            },
            v.averageHeartRate != null && {
              label: "Average heart rate",
              value: `${v.averageHeartRate} bpm`,
            },
            v.steps != null && {
              label: "Steps",
              value: v.steps.toLocaleString("en-GB"),
            },
            v.activeEnergyKcal != null && {
              label: "Active energy",
              value: `${v.activeEnergyKcal.toLocaleString("en-GB")} kcal`,
            },
          ].filter((line) => line !== false),
          footnote: "From Apple Health",
        },
      });
  }
  for (const b of bodyFatByDate(state, from, offsetDate(before, -1)))
    items.push({
      id: `body-fat-${b.date}`,
      date: b.date,
      kind: "body",
      title: "Body fat",
      detail: `${b.percent}%${b.method ? ` · ${b.method}` : ""}`,
      fromAppleHealth: b.source === "apple-health",
      details: defined({
        title: "Body fat",
        date: b.date,
        lines: [
          { label: "Body fat", value: `${b.percent} %` },
          ...(b.method
            ? [{ label: "Measured by", value: capitalised(b.method) }]
            : []),
        ],
        footnote:
          b.source === "apple-health" ? "From Apple Health" : "Reported by you",
      }),
    });
  const order = [
    "strength",
    "cardio",
    "meal",
    "sleep",
    "checkin",
    "body",
    "vitals",
  ];
  items.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      order.indexOf(a.kind) - order.indexOf(b.kind),
  );
  const older = [
    ...state.sessions.map((s) => s.date),
    ...state.cardio.sessions.map((s) => s.date),
    ...state.nutrition.meals.map((m) => m.date),
    ...state.health.checkins.map((c) => c.date),
  ].some((d) => d < from);
  return journalFeed.parse(
    defined({ revision, items, nextBefore: older ? from : undefined }),
  );
}

// ---- Existing endpoints the app also calls ----------------------------------

const identity = z
  .object({ id: z.string(), name: z.string(), email: z.string() })
  .register(nativeResponses, { id: "Identity" });
export const sessionInfo = z
  .object({
    user: identity.nullable(),
    canInvite: z.boolean(),
  })
  .register(nativeResponses, { id: "SessionInfo" });
export const tokenRequest = z
  .object({ code: z.string(), verifier: z.string() })
  .strict()
  .register(nativeRequests, { id: "TokenRequest" });
export const tokenResponse = z
  .object({ token: z.string(), expiresAt: instant, user: identity })
  .register(nativeResponses, { id: "TokenResponse" });
export const undoRequest = z
  .object({ id: uuid, undo: z.boolean() })
  .strict()
  .register(nativeRequests, { id: "ProposalRequest" });

const receipt = z
  .object({
    id: z.string(),
    title: z.string(),
    detail: z.string(),
    // pending: waits for the athlete to save it; saved; undone; expired.
    state: z.enum(["pending", "saved", "undone", "expired"]),
    // What was or will be saved, item by item, shown when the athlete opens
    // the receipt. Optional, as new response fields are.
    entries: z.array(receiptEntry).optional(),
  })
  .strict()
  .register(nativeResponses, { id: "CoachReceipt" });

// A saved proposal as stored with a Coach turn; older ones hold less.
type ReceiptSource = Pick<PreviewEntry, "title" | "detail"> &
  Partial<PreviewEntry>;
type StoredProposal = ReceiptSource &
  Pick<ActionPreview, "id" | "expiresAt"> & {
    status?: string;
    entries?: ReceiptSource[];
  };

const capitalised = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
const grams = (value: number) => `${Math.round(value)} g`;
const targetAmount = (value: number | null, key: keyof Nutrients) => {
  const target = dailyTarget(value);
  return target == null
    ? "No target"
    : key === "calories"
      ? `${Math.round(target)} kcal`
      : grams(target);
};
const dietGoalNames = {
  maintain: "Maintain weight",
  lose: "Lose weight",
  gain: "Gain weight",
};

// One saved or proposed entry as the app shows it: the same facts the
// website's review shows (meal items, sets, check-in values), as text.
export function receiptEntryView(
  entry: ReceiptSource,
): z.infer<typeof receiptEntry> {
  if (entry.meal) {
    const meal = entry.meal,
      total = totalNutrients(meal.items);
    return defined({
      title: `${capitalised(meal.type)}: ${meal.name}`,
      summary: `${Math.round(total.calories)} kcal · ${grams(total.protein)} protein · ${grams(total.carbs)} carbs · ${grams(total.fat)} fat`,
      date: meal.date,
      lines: meal.items.map((item) =>
        defined({
          label: item.name,
          note: item.portion || undefined,
          value: `${Math.round(item.calories)} kcal · ${grams(item.protein)} protein`,
        }),
      ),
      footnote:
        [
          meal.estimated ? "Estimated nutrition" : "Nutrition as given",
          meal.notes,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    });
  }
  if (entry.workout) {
    const workout = entry.workout;
    return defined({
      title: workout.title,
      summary: entry.workoutReview
        ? entry.workoutReview.status === "ongoing"
          ? "In progress · continue in Train"
          : "Completed · in your training history"
        : undefined,
      date: workout.date,
      lines: workout.exercises.map((e) => ({
        label: exerciseName(e.exerciseId),
        value:
          e.sets
            .filter((s) => s.weight !== "" && s.reps !== "")
            .map(
              (s) =>
                `${s.weight} kg × ${s.reps}${s.result === "miss" ? " (miss)" : ""}`,
            )
            .join(", ") || "No sets yet",
      })),
      footnote: workout.athleteNotes || undefined,
    });
  }
  if (entry.checkin) {
    const c = entry.checkin;
    return defined({
      title: "Check-in",
      date: c.date,
      lines: [
        c.sleepHours != null && {
          label: "Sleep",
          value: formatSleepDuration(c.sleepHours),
        },
        c.energy != null && { label: "Energy", value: `${c.energy}/5` },
        c.soreness != null && { label: "Soreness", value: `${c.soreness}/5` },
        c.bodyweight != null && {
          label: "Bodyweight",
          value: `${c.bodyweight} kg`,
        },
      ].filter((line) => line !== false),
      footnote: c.notes || undefined,
    });
  }
  if (entry.cardio) {
    const c = entry.cardio;
    return defined({
      title: cardioTitle(c),
      date: c.date,
      lines: [
        { label: "Duration", value: formatDuration(c.durationSeconds) },
        c.distanceKm != null && {
          label: "Distance",
          value: `${c.distanceKm} km`,
        },
        c.averageHeartRate != null && {
          label: "Average heart rate",
          value: `${c.averageHeartRate} bpm`,
        },
        c.maxHeartRate != null && {
          label: "Maximum heart rate",
          value: `${c.maxHeartRate} bpm`,
        },
        c.elevationGainM != null && {
          label: "Elevation gain",
          value: `${Math.round(c.elevationGainM)} m`,
        },
        c.caloriesKcal != null && {
          label: "Energy",
          value: `${Math.round(c.caloriesKcal)} kcal`,
        },
        c.effort != null && { label: "Effort", value: `${c.effort}/10` },
      ].filter((line) => line !== false),
      footnote: c.notes || undefined,
    });
  }
  if (entry.drink) {
    const d = entry.drink;
    return {
      title: d.removed ? "Drink removed" : "Drink",
      date: d.date,
      lines: [
        {
          label: capitalised(d.name),
          value: `${d.estimated ? "about " : ""}${d.ml} ml`,
        },
      ],
      footnote: `${formatLitres(d.dayTotalMl)}${d.dayTargetMl != null ? ` of about ${formatTargetLitres(d.dayTargetMl)}` : ""} that day`,
    };
  }
  if (entry.targets) {
    // The goal and all four targets, with the old value under any that
    // changes, so a target cleared shows as plainly as a new one.
    const t = entry.targets,
      before = entry.targetsBefore;
    const line = (label: string, key: keyof Nutrients) => {
      const value = targetAmount(t[key], key),
        was = before && targetAmount(before[key], key);
      return defined({
        label,
        note: was && was !== value ? `Was ${was}` : undefined,
        value,
      });
    };
    return {
      title: entry.title,
      lines: [
        defined({
          label: "Goal",
          note:
            before && before.goal !== t.goal
              ? `Was ${dietGoalNames[before.goal].toLowerCase()}`
              : undefined,
          value: dietGoalNames[t.goal],
        }),
        line("Energy", "calories"),
        line("Protein", "protein"),
        line("Carbs", "carbs"),
        line("Fat", "fat"),
      ],
    };
  }
  if (entry.memory)
    return {
      title: entry.title,
      summary: entry.memory.text,
      lines: [],
    };
  if (entry.plan)
    return defined({
      title: entry.plan.title,
      summary: entry.plan.notes || undefined,
      lines: [{ label: "Follow up", value: entry.plan.followUpDate }],
    });
  return { title: entry.title, summary: entry.detail, lines: [] };
}

const structured = (entry: ReceiptSource) =>
  Boolean(
    entry.meal ||
    entry.workout ||
    entry.checkin ||
    entry.cardio ||
    entry.targets ||
    entry.memory ||
    entry.plan ||
    entry.drink,
  );

// A short name for an entry in a batch's one-line summary.
const entryName = (entry: ReceiptSource) =>
  entry.meal?.name ??
  entry.workout?.title ??
  (entry.cardio && cardioTitle(entry.cardio)) ??
  (entry.drink && `${entry.drink.ml} ml ${entry.drink.name}`) ??
  (entry.checkin ? "Check-in" : entry.detail.split(". ")[0].replace(/\.$/, ""));

export function receiptView(
  p: StoredProposal,
  now: Date,
): z.infer<typeof receipt> {
  const state =
    p.status === "saved" || p.status === "undone"
      ? p.status
      : new Date(p.expiresAt) < now
        ? "expired"
        : "pending";
  const batch = p.entries?.length ? p.entries : null;
  return defined({
    id: p.id,
    // A batch reads "Review 3 entries … nothing is saved until you confirm"
    // while it waits; once decided, it says what it holds.
    title:
      batch && state !== "pending"
        ? `${batch.length} entries ${state === "undone" ? "undone" : "saved"}`
        : p.title,
    detail:
      batch && state !== "pending" ? batch.map(entryName).join(", ") : p.detail,
    state,
    entries: batch
      ? batch.map(receiptEntryView)
      : structured(p)
        ? [receiptEntryView(p)]
        : undefined,
  });
}
// A Coach visual flattened into one shape the app decodes tolerantly: the
// kind says which fields are present. Unknown kinds are skipped by the app.
const coachVisual = z
  .object({
    id: z.string(),
    kind: z.enum([
      "table",
      "bar_chart",
      "diagram",
      "photo_gallery",
      "route_map",
      "line_chart",
      "progress",
      "stats",
      "comparison",
      "split",
      "calendar",
      "recipe",
    ]),
    title: z.string(),
    caption: z.string().optional(),
    columns: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())).optional(),
    unit: z.string().optional(),
    points: z
      .array(
        z
          .object({ label: z.string(), value: z.number() })
          .strict()
          .register(nativeResponses, { id: "ChartPoint" }),
      )
      .optional(),
    nodes: z
      .array(
        z
          .object({ id: z.string(), label: z.string() })
          .strict()
          .register(nativeResponses, { id: "DiagramNode" }),
      )
      .optional(),
    edges: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string(),
            label: z.string().optional(),
          })
          .strict()
          .register(nativeResponses, { id: "DiagramEdge" }),
      )
      .optional(),
    imageIds: z.array(z.string()).optional(),
    activity: z.string().optional(),
    distanceKm: z.number().optional(),
    durationSeconds: int.optional(),
    loop: z.boolean().optional(),
    recorded: z.boolean().optional(),
    path: z.array(z.array(z.number())).optional(),
    stops: z
      .array(
        z
          .object({ lat: z.number(), lng: z.number(), label: z.string() })
          .strict()
          .register(nativeResponses, { id: "RouteStop" }),
      )
      .optional(),
    // line_chart: up to three lines over the same labels, and a target line.
    series: z
      .array(
        z
          .object({
            name: z.string(),
            points: z.array(
              z.object({ label: z.string(), value: z.number() }).strict(),
            ),
          })
          .strict()
          .register(nativeResponses, { id: "VisualSeries" }),
      )
      .optional(),
    target: z.number().optional(),
    // progress: amounts against their targets.
    targets: z
      .array(
        z
          .object({
            label: z.string(),
            value: z.number(),
            target: z.number(),
            unit: z.string(),
          })
          .strict()
          .register(nativeResponses, { id: "VisualTarget" }),
      )
      .optional(),
    // stats: headline numbers.
    stats: z
      .array(
        z
          .object({
            label: z.string(),
            value: z.string(),
            unit: z.string().optional(),
            change: z.string().optional(),
            trend: z.enum(["up", "down", "flat"]).optional(),
          })
          .strict()
          .register(nativeResponses, { id: "VisualStat" }),
      )
      .optional(),
    // comparison: one period against another.
    beforeLabel: z.string().optional(),
    afterLabel: z.string().optional(),
    comparisons: z
      .array(
        z
          .object({
            label: z.string(),
            before: z.number(),
            after: z.number(),
            unit: z.string().optional(),
            higherIsBetter: z.boolean().optional(),
          })
          .strict()
          .register(nativeResponses, { id: "VisualComparison" }),
      )
      .optional(),
    // split: parts of a whole, in unit.
    parts: z
      .array(
        z
          .object({ label: z.string(), value: z.number() })
          .strict()
          .register(nativeResponses, { id: "VisualPart" }),
      )
      .optional(),
    // calendar: days with a level from 0 to 3.
    days: z
      .array(
        z
          .object({
            date: day,
            level: int,
            label: z.string().optional(),
          })
          .strict()
          .register(nativeResponses, { id: "VisualDay" }),
      )
      .optional(),
    legend: z.string().optional(),
    // recipe: servings, time, every ingredient with its amount, steps (none
    // for a quick idea) and estimated nutrition per serving.
    servings: int.optional(),
    minutes: int.optional(),
    ingredients: z
      .array(
        z
          .object({ item: z.string(), amount: z.string().optional() })
          .strict()
          .register(nativeResponses, { id: "RecipeIngredient" }),
      )
      .optional(),
    steps: z.array(z.string()).optional(),
    nutrition: z
      .object({
        kcal: z.number().optional(),
        protein: z.number().optional(),
        carbs: z.number().optional(),
        fat: z.number().optional(),
      })
      .strict()
      .register(nativeResponses, { id: "RecipeNutrition" })
      .optional(),
    // A picture of the dish the server drew, once there is one.
    pictureId: z.string().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "CoachVisual" });
const coachTurn = z
  .object({
    id: z.string(),
    question: z.string(),
    fromVoice: z.boolean(),
    photoIds: z.array(z.string()),
    createdAt: instant,
    status: z.enum(["running", "done", "failed"]),
    reply: z.string().optional(),
    receipts: z.array(receipt),
    // Optional: builds released before visuals must still decode a turn.
    visuals: z.array(coachVisual).optional(),
  })
  .strict()
  .register(nativeResponses, { id: "CoachTurn" });
// Spoken calls with the voice coach, for the Coach thread (their own
// endpoint, so builds that decode CoachHistory strictly are unaffected).
const voiceCallLine = z
  .object({ role: z.enum(["you", "coach"]), text: z.string() })
  .strict()
  .register(nativeResponses, { id: "VoiceCallLine" });
const voiceCall = z
  .object({
    id: z.string(),
    startedAt: instant,
    endedAt: instant,
    lines: z.array(voiceCallLine),
  })
  .strict()
  .register(nativeResponses, { id: "VoiceCall" });
export const voiceCallsResponse = z
  .object({ calls: z.array(voiceCall) })
  .strict()
  .register(nativeResponses, { id: "VoiceCalls" });
export const coachHistory = z
  .object({ turns: z.array(coachTurn) })
  .strict()
  .register(nativeResponses, { id: "CoachHistory" });

type HistoryTurn = {
  id: string;
  question: string;
  photoIds: string[];
  createdAt: string;
  status: string;
  reply?: string;
  proposals?: StoredProposal[];
  visuals?: SavedVisual[];
};

export function flattenVisual({ id, content }: SavedVisual) {
  const { kind, title, caption } = content;
  const common = { id, kind, title, caption };
  switch (content.kind) {
    case "table":
      return { ...common, columns: content.columns, rows: content.rows };
    case "bar_chart":
      return { ...common, unit: content.unit, points: content.points };
    case "diagram":
      return { ...common, nodes: content.nodes, edges: content.edges };
    case "photo_gallery":
      return { ...common, imageIds: content.imageIds };
    case "route_map":
      return {
        ...common,
        activity: content.activity,
        distanceKm: content.distanceKm,
        durationSeconds: content.durationSeconds,
        loop: content.loop,
        recorded: content.recorded,
        path: content.path.map(([lat, lng]) => [lat, lng]),
        stops: content.stops,
      };
    // The newer kinds use the same field names in the app as in Coach's
    // tool, so they pass through as they are.
    default:
      return { id, ...content };
  }
}

export function buildCoach(turns: HistoryTurn[], now = new Date()) {
  const voice = "[voice] ";
  return coachHistory.parse({
    turns: turns.map((t) =>
      defined({
        id: t.id,
        question: t.question.startsWith(voice)
          ? t.question.slice(voice.length)
          : t.question,
        fromVoice: t.question.startsWith(voice),
        photoIds: t.photoIds,
        createdAt: new Date(t.createdAt).toISOString(),
        status: ["running", "done", "failed"].includes(t.status)
          ? t.status
          : "done",
        reply: t.reply && withoutEmDashes(t.reply),
        visuals: (t.visuals ?? []).map((v) => defined(flattenVisual(v))),
        receipts: (t.proposals ?? []).map((p) => receiptView(p, now)),
      }),
    ),
  });
}

export const imageUpload = z
  .object({
    id: uuid,
    label: z.string().max(160),
    date: day,
    autoTag: z.boolean(),
    // Answer once saved and tag the image afterwards (Coach photos).
    tagInBackground: z.boolean().optional(),
    purpose: z.enum(["meal-photo"]).optional(),
    // Base64 JPEG, at most about 2 MB once decoded.
    image: z.string(),
  })
  .strict()
  .register(nativeRequests, { id: "ImageUpload" });

// ---- Trends ------------------------------------------------------------------

const trendDay = z
  .object({
    date: day,
    sleepHours: z.number().optional(),
    sleepFromAppleHealth: z.boolean(),
    restingHeartRate: int.optional(),
    heartRateVariabilityMs: z.number().optional(),
    steps: int.optional(),
    activeEnergyKcal: int.optional(),
    waterMl: int.optional(),
    calories: z.number().optional(),
    protein: z.number().optional(),
    bodyweight: z.number().optional(),
    bodyFatPercent: z.number().optional(),
    cardioMinutes: int,
    strengthSessions: int,
  })
  .strict()
  .register(nativeResponses, { id: "TrendDay" });
export const trendsView = z
  .object({
    days: z.array(trendDay),
    targetCalories: z.number().optional(),
    targetProtein: z.number().optional(),
    waterTargetMl: int,
    // The athlete hid the drinks target; absent before 4 October.
    waterTargetHidden: z.boolean().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "Trends" });
export type TrendsView = z.infer<typeof trendsView>;

// One row per day, oldest first, for the app's charts. Absent values mean
// nothing was recorded, not zero.
export function buildTrends(
  state: JournalState,
  date: string,
  days: number,
): TrendsView {
  const drinksTarget = hydrationTargetMl(state, date);
  const rows = Array.from({ length: days }, (_, i) =>
    offsetDate(date, i - days + 1),
  ).map((d) => {
    const checkin = state.health.checkins.find((c) => c.date === d);
    const vitals = state.health.vitals?.find((v) => v.date === d);
    const meals = state.nutrition.meals.filter((m) => m.date === d);
    const food = totalNutrients(meals.flatMap((m) => m.items));
    const water = hydrationForDay(state, d);
    const fat = bodyFatByDate(state, d, d)[0];
    return defined({
      date: d,
      sleepHours: checkin?.sleepHours,
      sleepFromAppleHealth: Boolean(checkin?.sleepImport),
      restingHeartRate: vitals?.restingHeartRate,
      heartRateVariabilityMs: vitals?.heartRateVariabilityMs,
      steps: vitals?.steps,
      activeEnergyKcal: vitals?.activeEnergyKcal,
      waterMl: water.recorded ? water.totalMl : undefined,
      calories: meals.length ? food.calories : undefined,
      protein: meals.length ? food.protein : undefined,
      bodyweight: checkin?.bodyweight ?? undefined,
      bodyFatPercent: fat?.percent,
      cardioMinutes: Math.round(
        state.cardio.sessions
          .filter((s) => s.date === d)
          .reduce((n, s) => n + s.durationSeconds, 0) / 60,
      ),
      strengthSessions: state.sessions.filter((s) => s.date === d).length,
    });
  });
  return trendsView.parse(
    defined({
      days: rows,
      targetCalories:
        dailyTarget(state.nutrition.targets?.calories) ?? undefined,
      targetProtein: dailyTarget(state.nutrition.targets?.protein) ?? undefined,
      waterTargetMl: drinksTarget.targetMl,
      ...(drinksTarget.hidden ? { waterTargetHidden: true } : {}),
    }),
  );
}
