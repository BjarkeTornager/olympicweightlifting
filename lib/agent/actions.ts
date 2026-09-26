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
import type { Checkin } from "../health";
import type { Meal, DietTargets } from "../nutrition";
import { actionSchema, type AgentAction } from "./action-schema";
import {
  prepareDietTargets,
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
  entries?: PreviewEntry[];
  expiresAt: string;
  status?: "saved" | "undone";
  automatic?: boolean;
};
export type PreviewEntry = Pick<
  ActionPreview,
  | "title"
  | "detail"
  | "workout"
  | "meal"
  | "targets"
  | "checkin"
  | "cardio"
  | "memory"
  | "plan"
  | "training"
  | "liftingBrief"
  | "workoutReview"
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

function applyAction(
  next: JournalState,
  action: Exclude<AgentAction, { kind: "record_bundle" }>,
  before: JournalState,
  currentDate: string,
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
    case "finish_workout":
      return prepareFinishWorkout(next, currentDate);
    case "discard_workout":
      return prepareDiscardWorkout(next);
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
    case "save_routine":
      return prepareSaveRoutine(next, action);
  }
}

export function prepareAction(
  state: JournalState,
  raw: unknown,
  currentDate: string,
): PreparedAction {
  const parsed = actionSchema.parse(raw);
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
    for (const entry of parsed.entries) {
      const prepared = prepareAction(combined, entry, currentDate);
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
  const change = applyAction(next, action, state, currentDate);
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
    checkin: change.checkin,
    cardio: change.cardio,
    memory: change.memory,
    plan: change.plan,
    liftingBrief: change.liftingBrief,
    training: change.training,
    workoutReview,
    action,
  };
}
