import { z } from "zod";
import {
  createWorkout,
  days,
  EXERCISES,
  exerciseName,
  finishWorkout,
  uid,
} from "../domain";
import {
  journalSchema,
  workoutSchema,
  type JournalState,
  type Workout,
} from "../model";
import { startTemplate, templateFromWorkout } from "../training";
import { checkinPatchSchema, saveCheckin, type Checkin } from "../health";
import {
  mealInputSchema,
  dietTargetsSchema,
  totalNutrients,
  type Meal,
  type DietTargets,
} from "../nutrition";
const date = workoutSchema.shape.date;
const exerciseId = z
  .string()
  .refine(
    (id) => EXERCISES.some((e) => e.id === id),
    "Use an exercise from the catalogue",
  );
const set = z
  .object({
    weight: z.number().finite().min(0).max(1000),
    reps: z.number().int().min(1).max(1000),
    result: z.enum(["success", "miss"]),
    rpe: z.number().min(1).max(10).optional(),
  })
  .strict();
const training = z
  .object({
    title: z.string().trim().min(1).max(120),
    date,
    category: z.enum(["accessories", "weightlifting", "open"]),
    notes: z.string().max(2000).optional(),
    exercises: z
      .array(
        z.object({ exerciseId, sets: z.array(set).min(1).max(30) }).strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("record_checkin"), checkin: checkinPatchSchema })
    .strict(),
  z.object({ kind: z.literal("record_meal"), meal: mealInputSchema }).strict(),
  z
    .object({
      kind: z.literal("update_meal"),
      mealId: z.string().uuid(),
      meal: mealInputSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("set_diet_targets"), targets: dietTargetsSchema })
    .strict(),
  z.object({ kind: z.literal("record_session"), workout: training }).strict(),
  z.object({ kind: z.literal("plan_workout"), workout: training }).strict(),
  z
    .object({
      kind: z.literal("update_session"),
      sessionId: z.string().min(1).max(160),
      workout: training,
    })
    .strict(),
  z
    .object({
      kind: z.literal("log_sets"),
      exerciseId,
      sets: z.array(set).min(1).max(30),
    })
    .strict(),
  z.object({ kind: z.literal("finish_workout") }).strict(),
  z
    .object({
      kind: z.literal("start_programme"),
      dayId: z.string().max(160),
      date,
    })
    .strict(),
  z
    .object({
      kind: z.literal("repeat_session"),
      sessionId: z.string().max(160),
      date,
    })
    .strict(),
  z
    .object({
      kind: z.literal("save_routine"),
      sessionId: z.string().max(160),
      name: z.string().trim().min(1).max(120),
    })
    .strict(),
]);
// Provider-facing schema stays an object; the discriminated union above validates each action on the server.
export const actionToolSchema = z
  .object({
    kind: z.enum([
      "record_checkin",
      "record_meal",
      "update_meal",
      "set_diet_targets",
      "record_session",
      "plan_workout",
      "update_session",
      "log_sets",
      "finish_workout",
      "start_programme",
      "repeat_session",
      "save_routine",
    ]),
    workout: training.optional(),
    sessionId: z.string().max(160).optional(),
    exerciseId: exerciseId.optional(),
    sets: z.array(set).min(1).max(30).optional(),
    dayId: z.string().max(160).optional(),
    date: date.optional(),
    name: z.string().max(120).optional(),
    meal: mealInputSchema.optional(),
    mealId: z.string().uuid().optional(),
    targets: dietTargetsSchema.optional(),
    checkin: checkinPatchSchema.optional(),
  })
  .strict();
export type AgentAction = z.infer<typeof actionSchema>;
export type ActionPreview = {
  id: string;
  title: string;
  detail: string;
  workout: Workout | null;
  meal?: Meal;
  targets?: DietTargets;
  checkin?: Checkin;
  expiresAt: string;
  status?: "saved" | "undone";
};
function buildWorkout(
  input: z.infer<typeof training>,
  logged: boolean,
): Workout {
  return {
    id: uid(),
    title: input.title,
    date: input.date,
    programId: "personal",
    programDayId: input.category === "accessories" ? "gym_accessories" : "open",
    recovery: "auto",
    athleteNotes: input.notes ?? "",
    coachNotes: "",
    exercises: input.exercises.map((e) => ({
      id: uid(),
      exerciseId: e.exerciseId,
      loggingVersion: 1,
      completed: logged,
      athleteNotes: "",
      coachCue: "",
      prescribed: {},
      sets: e.sets.map((s) => ({
        id: uid(),
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe ?? "",
        result: logged ? s.result : "",
        logged,
        touched: logged,
      })),
    })),
  };
}
export function prepareAction(
  state: JournalState,
  raw: unknown,
  currentDate: string,
) {
  const action = actionSchema.parse(raw),
    next = structuredClone(state);
  let title = "",
    detail = "",
    workout: Workout | null = null;
  let meal: Meal | undefined, targets: DietTargets | undefined;
  let checkin: Checkin | undefined;
  const owned = (id: string) => {
    const w = next.sessions.find((s) => s.id === id);
    if (!w) throw Error("That session is not in your journal.");
    return w;
  };
  const requireNoDraft = () => {
    if (next.activeWorkout)
      throw Error(
        "An unfinished workout already exists. Resume or finish it first.",
      );
  };
  if (
    action.kind === "record_session" ||
    action.kind === "plan_workout" ||
    action.kind === "update_session"
  ) {
    const planned = action.kind === "plan_workout";
    if (!planned && action.workout.date > currentDate)
      throw Error(
        "Completed sessions cannot be dated in the future. Prepare a workout draft instead.",
      );
    if (planned) requireNoDraft();
    workout = buildWorkout(action.workout, !planned);
    if (action.kind === "update_session") {
      const existing = owned(action.sessionId);
      if (next.activeWorkout?.editingSessionId === existing.id)
        throw Error("Finish editing this session in Train first.");
      workout = {
        ...existing,
        title: workout.title,
        date: workout.date,
        programDayId:
          action.workout.category === "accessories"
            ? "gym_accessories"
            : existing.programDayId,
        athleteNotes: action.workout.notes ?? existing.athleteNotes,
        exercises: workout.exercises.map((entry) => {
          const original = existing.exercises.find(
            (e) => e.exerciseId === entry.exerciseId,
          );
          return original
            ? { ...original, sets: entry.sets, completed: true }
            : entry;
        }),
      };
      next.sessions = next.sessions.map((s) =>
        s.id === existing.id ? workout! : s,
      );
      title = "Replace session details";
      detail =
        "This replaces every exercise and set in the selected session. Review the complete session below.";
    } else if (planned) {
      next.activeWorkout = workout;
      title = "Start a workout draft";
      detail =
        "Every set starts unlogged. Your history stays as it is until you finish.";
    } else {
      next.sessions.push(workout);
      title = "Log a completed session";
      detail = next.sessions.some(
        (s) => s.id !== workout!.id && s.date === workout!.date,
      )
        ? "You already have training on this date. This creates an additional session."
        : "Adds this session to your training history.";
    }
  } else if (action.kind === "log_sets") {
    const draft = next.activeWorkout;
    if (!draft) throw Error("Start a workout before logging sets.");
    if (draft.date > currentDate)
      throw Error(
        "This workout is dated in the future. Check the training date first.",
      );
    let entry = draft.exercises.find((e) => e.exerciseId === action.exerciseId);
    if (!entry) {
      entry = {
        id: uid(),
        exerciseId: action.exerciseId,
        loggingVersion: 1,
        completed: false,
        athleteNotes: "",
        coachCue: "",
        prescribed: {},
        sets: [],
      };
      draft.exercises.push(entry);
    }
    for (const s of action.sets) {
      const pending = entry.sets.findIndex((s) => !s.logged && !s.result);
      const value = {
        id: pending >= 0 ? entry.sets[pending].id : uid(),
        ...s,
        logged: true,
        touched: true,
      };
      if (pending >= 0) entry.sets[pending] = value;
      else entry.sets.push(value);
    }
    entry.completed = entry.sets.every((s) => Boolean(s.logged || s.result));
    workout = draft;
    title = `Log ${action.sets.length} ${exerciseName(action.exerciseId)} sets`;
    detail =
      "Fills the next unlogged sets, then adds extra sets if needed. Previously logged sets are preserved.";
  } else if (action.kind === "finish_workout") {
    if (!next.activeWorkout) throw Error("There is no unfinished workout.");
    if (next.activeWorkout.date > currentDate)
      throw Error("Check this workout’s future training date first.");
    const finished = finishWorkout(next);
    Object.assign(next, finished);
    workout = next.sessions.at(-1) ?? null;
    title = "Finish your workout";
    detail =
      "Saves logged sets to History. Unlogged planned sets are left out.";
  } else if (action.kind === "start_programme") {
    requireNoDraft();
    const day = days.find((d) => d.id === action.dayId);
    if (!day) throw Error("Choose a programme day from the site catalogue.");
    workout = createWorkout(next, day, action.date);
    next.activeWorkout = workout;
    title = "Start your programme";
    detail =
      "Targets use the site’s progression rules and your recorded history. Sets start unlogged.";
  } else if (action.kind === "repeat_session") {
    requireNoDraft();
    workout = startTemplate(
      templateFromWorkout(owned(action.sessionId)),
      action.date,
    );
    next.activeWorkout = workout;
    title = "Repeat a session";
    detail =
      "Copies exercises, weights and reps into a fresh draft with every set unlogged.";
  } else if (action.kind === "record_checkin") {
    checkin = saveCheckin(next, action.checkin, currentDate);
    title = "Save your daily check-in";
    detail = `Updates your check-in for ${checkin.date}. Values you haven’t changed are kept. This records how you feel without changing your workout or diet targets.`;
  } else if (action.kind === "record_meal" || action.kind === "update_meal") {
    if (action.meal.date > currentDate)
      throw Error("Meals eaten cannot be dated in the future.");
    const existing =
      action.kind === "update_meal"
        ? next.nutrition.meals.find((m) => m.id === action.mealId)
        : undefined;
    if (action.kind === "update_meal" && !existing)
      throw Error("That meal is not in your food journal.");
    meal = {
      ...action.meal,
      id: existing?.id ?? uid(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    next.nutrition.meals = [
      ...next.nutrition.meals.filter((m) => m.id !== meal!.id),
      meal,
    ];
    const totals = totalNutrients(meal.items);
    title = existing ? "Update your meal" : "Log your meal";
    detail = `${totals.calories} kcal · ${totals.protein} g protein. ${meal.estimated ? "Estimated portions and nutrition. Check the assumptions below." : "Using the nutrition values you supplied."} You can correct this proposal in chat or edit the meal in Food after saving.`;
  } else if (action.kind === "set_diet_targets") {
    targets = action.targets;
    next.nutrition.targets = targets;
    title = "Update your daily nutrition targets";
    detail =
      "These are your chosen daily targets. They are not a calculated calorie prescription.";
  } else {
    const template = templateFromWorkout(owned(action.sessionId), action.name);
    next.templates = [...(next.templates ?? []), template];
    title = "Save a routine";
    detail = `“${template.name}” will be available in Train → Your routines.`;
    workout = startTemplate(template, currentDate);
  }
  next.updatedAt = new Date().toISOString();
  return {
    state: journalSchema.parse(next),
    title,
    detail,
    workout,
    meal,
    targets,
    checkin,
    action,
  };
}
