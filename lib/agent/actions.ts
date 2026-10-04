import type { WorkoutStatus } from "../workout-continuity";
import type { CoachMemory, CoachPlan } from "../coaching";
import type { LiftingBrief } from "../lifting-brief";
import type { CardioEntry } from "../cardio";
import {
  journalSchema,
  type JournalState,
  type Workout,
  type WorkoutTemplate,
} from "../model";
import type { TrainingProgram } from "../training-program-schema";
import { exerciseResolver } from "../exercises";
import { trainingPrograms } from "../training-programs";
import type { Checkin } from "../health";
import type { Meal, DietTargets } from "../nutrition";
import { actionSchema, type AgentAction } from "./action-schema";
import {
  prepareDietTargets,
  prepareBodyGoals,
  prepareBodyFat,
  prepareDeleteMeal,
  prepareDrink,
  prepareSupplement,
  prepareCardio,
  prepareCheckin,
  prepareMeal,
  prepareRepeatMeal,
} from "./prepare-records";
import {
  prepareLiftingBrief,
  prepareMemory,
  preparePlan,
  prepareRoutine,
  prepareTrainingProgram,
} from "./prepare-plans";
import {
  prepareAddExercise,
  prepareFinishWorkout,
  prepareDiscardWorkout,
  prepareLogSets,
  prepareMergeSessions,
  prepareRepeatSession,
  prepareSaveRoutine,
  prepareSession,
  prepareSetCorrection,
  prepareStartProgramme,
  prepareWorkoutProgress,
} from "./prepare-workouts";

export {
  actionSchema,
  actionToolSchema,
  loggingKinds,
  loggingToolSchema,
  type AgentAction,
} from "./action-schema";
export type TrainingReview =
  | { kind: "routine"; after: WorkoutTemplate; before?: WorkoutTemplate }
  | { kind: "program"; after: TrainingProgram; before?: TrainingProgram };
export type ActionPreview = {
  id: string;
  title: string;
  detail: string;
  workout: Workout | null;
  meal?: Meal;
  targets?: DietTargets;
  // The targets before this change, so the review can show what changes.
  targetsBefore?: DietTargets;
  checkin?: Checkin;
  cardio?: CardioEntry;
  memory?: CoachMemory;
  plan?: CoachPlan;
  training?: TrainingReview;
  liftingBrief?: LiftingBrief | null;
  workoutReview?: {
    status: WorkoutStatus;
    sources?: { id: string; title: string; date: string; sets: number }[];
  };
  // A drink logged or removed, with the day's total after it, and the
  // day's target unless the athlete hid it.
  drink?: {
    name: string;
    ml: number;
    date: string;
    removed?: boolean;
    estimated?: boolean;
    dayTotalMl: number;
    dayTargetMl?: number;
  };
  entries?: PreviewEntry[];
  expiresAt: string;
  status?: "saved" | "undone";
  automatic?: boolean;
};
// A change as the model asked for it (after the change guards), and the
// athlete's date it was asked on: enough to prepare it again, without a
// model call, against a journal that changed in the meantime.
export type RequestedChange = { action: AgentAction; date: string };
export type PreviewEntry = Pick<
  ActionPreview,
  | "title"
  | "detail"
  | "workout"
  | "meal"
  | "targets"
  | "targetsBefore"
  | "checkin"
  | "cardio"
  | "memory"
  | "plan"
  | "training"
  | "liftingBrief"
  | "workoutReview"
  | "drink"
>;
type PreparedAction = PreviewEntry & {
  state: JournalState;
  action: AgentAction;
  entries?: PreviewEntry[];
};
export type ActionOf<K extends AgentAction["kind"]> = Extract<
  AgentAction,
  { kind: K }
>;
// What one action handler reports after applying its change to the draft journal.
export type PreparedChange = Omit<PreviewEntry, "workout"> & {
  workout?: Workout | null;
};

// The exercise ids already in the record an action changes: the workout in
// progress, or the history session, routine or programme it edits.
function changedRecord(state: JournalState, a: AgentAction) {
  const ids = (exercises: { exerciseId: string }[] = []) =>
    exercises.map((e) => e.exerciseId);
  const session = (id?: string) =>
    state.sessions.find((s) => s.id === id)?.exercises;
  switch (a.kind) {
    case "log_sets":
    case "add_workout_exercise":
      return ids(state.activeWorkout?.exercises);
    case "log_workout_progress":
      return ids(
        a.sessionId ? session(a.sessionId) : state.activeWorkout?.exercises,
      );
    case "update_session":
      return ids(session(a.sessionId));
    case "update_routine":
      return ids(state.templates.find((t) => t.id === a.routineId)?.exercises);
    case "update_training_program":
      return ids(
        trainingPrograms(state)
          .find((p) => p.id === a.trainingProgramId)
          ?.days.flatMap((d) => d.exercises),
      );
    default:
      return [];
  }
}

// Every exercise an action names, as the journal knows it, so Coach, voice
// and the iPhone app save one id per movement: custom:Back squat is
// back_squat, another spelling of the athlete's own exercise is the one
// they already use, and an id the journal or the changed record already
// holds stays as it is (lib/exercises.ts). Resolving again changes nothing.
function resolveExercises(state: JournalState, action: AgentAction) {
  const resolve = exerciseResolver(state);
  const visit = (a: AgentAction) => {
    if (a.kind === "record_bundle") return a.entries.forEach(visit);
    const record = changedRecord(state, a);
    const each = (exercises: { exerciseId: string }[] = []) => {
      for (const e of exercises) e.exerciseId = resolve(e.exerciseId, record);
    };
    if ("exerciseId" in a) a.exerciseId = resolve(a.exerciseId, record);
    if ("workout" in a) each(a.workout.exercises);
    if ("routine" in a) each(a.routine.exercises);
    if ("trainingProgram" in a)
      for (const day of a.trainingProgram.days) each(day.exercises);
    if ("programChanges" in a)
      for (const day of a.programChanges.days ?? []) each(day.exercises);
  };
  visit(action);
  return action;
}

function applyAction(
  next: JournalState,
  action: Exclude<AgentAction, { kind: "record_bundle" }>,
  before: JournalState,
  currentDate: string,
  mealDates: ReadonlySet<string>,
): PreparedChange {
  switch (action.kind) {
    case "set_lifting_brief":
      return prepareLiftingBrief(next, action);
    case "create_routine":
    case "update_routine":
    case "delete_routine":
    case "start_routine":
      return prepareRoutine(next, action);
    case "create_training_program":
    case "update_training_program":
    case "delete_training_program":
    case "start_training_day":
      return prepareTrainingProgram(next, action);
    case "save_memory":
    case "forget_memory":
      return prepareMemory(next, action);
    case "save_plan":
    case "delete_plan":
    case "dismiss_plan":
      return preparePlan(next, action, currentDate);
    case "repeat_meal":
      return prepareRepeatMeal(next, action, currentDate);
    case "merge_sessions":
      return prepareMergeSessions(next, action);
    case "log_workout_progress":
      return prepareWorkoutProgress(next, action, currentDate);
    case "record_session":
    case "plan_workout":
    case "update_session":
      return prepareSession(next, action, currentDate);
    case "correct_workout_set":
      return prepareSetCorrection(next, action, currentDate);
    case "log_sets":
      return prepareLogSets(next, action, currentDate);
    case "add_workout_exercise":
      return prepareAddExercise(next, action);
    case "finish_workout":
      return prepareFinishWorkout(next, currentDate, action.workoutId);
    case "discard_workout":
      return prepareDiscardWorkout(next, action.workoutId);
    case "start_programme":
      return prepareStartProgramme(next, action);
    case "repeat_session":
      return prepareRepeatSession(next, action);
    case "record_cardio":
    case "update_cardio":
    case "delete_cardio":
      return prepareCardio(next, action, before, currentDate);
    case "record_checkin":
      return prepareCheckin(next, action, currentDate);
    case "record_meal":
    case "update_meal":
      return prepareMeal(next, action, currentDate);
    case "set_diet_targets":
      return prepareDietTargets(next, action);
    case "log_drink":
    case "delete_drink":
      return prepareDrink(next, action, currentDate, mealDates);
    case "log_supplement":
    case "delete_supplement":
      return prepareSupplement(next, action, currentDate);
    case "delete_meal":
      return prepareDeleteMeal(next, action);
    case "set_body_goals":
      return prepareBodyGoals(next, action, currentDate);
    case "record_body_fat":
    case "delete_body_fat":
      return prepareBodyFat(next, action, currentDate);
    case "save_routine":
      return prepareSaveRoutine(next, action);
  }
}

export function prepareAction(
  state: JournalState,
  raw: unknown,
  currentDate: string,
  // Dates a bundle also logs food on, so a drink with energy beside its
  // meal is not asked for one.
  mealDates: ReadonlySet<string> = new Set(),
): PreparedAction {
  const parsed = resolveExercises(state, actionSchema.parse(raw));
  if (parsed.kind === "record_bundle") {
    const checkinDates = parsed.entries.flatMap((e) =>
      e.kind === "record_checkin" ? [e.checkin.date] : [],
    );
    if (new Set(checkinDates).size !== checkinDates.length)
      throw Error("Combine fields for the same check-in date into one entry.");
    const workoutDates = parsed.entries.flatMap((e) =>
      e.kind === "record_session" || e.kind === "log_workout_progress"
        ? [e.workout.date]
        : [],
    );
    if (new Set(workoutDates).size !== workoutDates.length)
      throw Error(
        "Combine all exercises from one workout into one training entry. Log separate same-date workouts in separate reviews.",
      );
    let combined = structuredClone(state);
    const entries: PreviewEntry[] = [];
    const foodDates = new Set(
      parsed.entries.flatMap((e) =>
        e.kind === "record_meal"
          ? [e.meal.date]
          : e.kind === "repeat_meal"
            ? [e.date]
            : [],
      ),
    );
    for (const entry of parsed.entries) {
      const prepared = prepareAction(combined, entry, currentDate, foodDates);
      combined = prepared.state;
      entries.push({
        title: prepared.title,
        detail: prepared.detail,
        workout: prepared.workout,
        ...(prepared.workoutReview
          ? { workoutReview: prepared.workoutReview }
          : {}),
        ...(prepared.meal ? { meal: prepared.meal } : {}),
        ...(prepared.checkin ? { checkin: prepared.checkin } : {}),
        ...(prepared.cardio ? { cardio: prepared.cardio } : {}),
        ...(prepared.drink ? { drink: prepared.drink } : {}),
      });
    }
    return {
      state: combined,
      action: parsed,
      title: `Review ${entries.length} entries`,
      detail:
        "Check each entry below. Save all together, or ask Coach to correct anything first. Nothing is saved until you confirm.",
      workout: null,
      entries,
    };
  }
  const action = parsed,
    next = structuredClone(state);
  const change = applyAction(next, action, state, currentDate, mealDates);
  const workout = change.workout ?? null;
  const workoutReview: ActionPreview["workoutReview"] =
    change.workoutReview ??
    (workout
      ? {
          status:
            next.activeWorkout?.id === workout.id ? "ongoing" : "completed",
        }
      : undefined);
  next.updatedAt = new Date().toISOString();
  return {
    state: journalSchema.parse(next),
    title: change.title,
    detail: change.detail,
    workout,
    meal: change.meal,
    targets: change.targets,
    targetsBefore: change.targetsBefore,
    checkin: change.checkin,
    cardio: change.cardio,
    memory: change.memory,
    plan: change.plan,
    liftingBrief: change.liftingBrief,
    training: change.training,
    drink: change.drink,
    workoutReview,
    action,
  };
}
