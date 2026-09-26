import { z } from "zod";
import { cardioActivities, cardioTitle, formatDuration } from "./cardio";
import { dailyHealth, formatSleepDuration, offsetDate } from "./health";
import { drinkKinds, hydrationForDay, hydrationTargetMl } from "./hydration";
import type { JournalState } from "./model";
import { nextTraining } from "./next-training";
import { mealTypes, totalNutrients } from "./nutrition";
import type { SavedVisual } from "./coach-visuals";
import { describeRoute, type RouteNote } from "./route-summary";
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

export const nativeConfig = z
  .object({
    minimumBuild: int,
    voice: z.boolean(),
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
  })
  .strict()
  .register(nativeResponses, { id: "Drink" });
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
const hydrationView = z
  .object({
    totalMl: int,
    targetMl: int,
    estimatedTarget: z.boolean(),
    drinks: z.array(drinkView),
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

export const todayView = z
  .object({
    date: day,
    revision: int,
    name: z.string().optional(),
    sleep: sleepView,
    vitals: vitalsView.optional(),
    checkin: checkinView.optional(),
    nutrition: nutritionView,
    hydration: hydrationView,
    activeWorkout: workoutView.optional(),
    nextSession: nextSessionView.optional(),
    strengthToday: z.array(workoutView),
    activities: z.array(activityView),
    sessionsThisWeek: int,
    priorities: z.array(priorityView),
  })
  .strict()
  .register(nativeResponses, { id: "Today" });
export type TodayView = z.infer<typeof todayView>;

const journalItem = z
  .object({
    id: z.string(),
    date: day,
    kind: z.enum(["strength", "cardio", "meal", "sleep", "checkin", "vitals"]),
    title: z.string(),
    detail: z.string(),
    fromAppleHealth: z.boolean(),
    hasRoute: z.boolean().optional(),
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

export const nativeAction = z
  .discriminatedUnion("kind", [
    logDrink,
    deleteDrink,
    recordCheckin,
    deleteCardio,
    startProgramme,
    logSets,
    finishWorkout,
    discardWorkout,
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

export function buildToday(
  state: JournalState,
  revision: number,
  date: string,
  fromAppleHealth: Set<string>,
  routes: Map<string, RouteNote> = new Map(),
): TodayView {
  const health = dailyHealth(state, date);
  const hydration = hydrationForDay(state, date);
  const meals = state.nutrition.meals.filter((m) => m.date === date);
  const vitals =
    state.health.vitals?.find((v) => v.date === date) ??
    state.health.vitals?.find((v) => v.date === offsetDate(date, -1));
  const checkin = health.checkin;
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
      nutrition: defined({
        ...totalNutrients(meals.flatMap((m) => m.items)),
        targetCalories: state.nutrition.targets?.calories,
        targetProtein: state.nutrition.targets?.protein,
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
      hydration: {
        totalMl: hydration.totalMl,
        targetMl: hydration.targetMl,
        estimatedTarget: hydration.estimated,
        drinks: hydration.drinks.map((d) => ({
          id: d.id,
          ml: d.ml,
          kind: d.kind,
          name: d.name,
          at: d.at,
        })),
      },
      activeWorkout: state.activeWorkout
        ? workoutSummary(state.activeWorkout)
        : undefined,
      nextSession: next
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
    }),
  );
}

const kmText = (km: number) =>
  `${km.toLocaleString("en-GB", { maximumFractionDigits: 2 })} km`;

// Everything recorded, newest day first, a fixed number of days per page.
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
      detail: `${s.exercises.length} exercises · ${loggedSets(s)} sets`,
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
      ]
        .filter(Boolean)
        .join(" · "),
      fromAppleHealth: fromAppleHealth.has(e.id),
      hasRoute: routes.has(e.id),
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
      });
  }
  const order = ["strength", "cardio", "meal", "sleep", "checkin", "vitals"];
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
  })
  .strict()
  .register(nativeResponses, { id: "CoachReceipt" });
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
  proposals?: {
    id: string;
    title: string;
    detail: string;
    status?: string;
    expiresAt: string;
  }[];
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
        reply: t.reply,
        visuals: (t.visuals ?? []).map((v) => defined(flattenVisual(v))),
        receipts: (t.proposals ?? []).map((p) => ({
          id: p.id,
          title: p.title,
          detail: p.detail,
          state:
            p.status === "saved" || p.status === "undone"
              ? p.status
              : new Date(p.expiresAt) < now
                ? "expired"
                : "pending",
        })),
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
  const rows = Array.from({ length: days }, (_, i) =>
    offsetDate(date, i - days + 1),
  ).map((d) => {
    const checkin = state.health.checkins.find((c) => c.date === d);
    const vitals = state.health.vitals?.find((v) => v.date === d);
    const meals = state.nutrition.meals.filter((m) => m.date === d);
    const food = totalNutrients(meals.flatMap((m) => m.items));
    const water = hydrationForDay(state, d);
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
      targetCalories: state.nutrition.targets?.calories,
      targetProtein: state.nutrition.targets?.protein,
      waterTargetMl: hydrationTargetMl(state, date).targetMl,
    }),
  );
}
