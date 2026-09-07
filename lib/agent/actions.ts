import {
  appendWorkoutSets,
  mergeWorkoutSessions,
  type WorkoutStatus,
} from "../workout-continuity";
import {
  memoryInputSchema,
  planInputSchema,
  coachSettings,
  type CoachMemory,
  type CoachPlan,
} from "../coaching";
import { repeatMeal } from "../nutrition";
import { z } from "zod";
import {
  cardioInputSchema,
  cardioPatchSchema,
  saveCardio,
  cardioTitle,
  type CardioEntry,
} from "../cardio";
import {
  createWorkout,
  days,
  exerciseName,
  finishWorkout,
  uid,
} from "../domain";
import {
  journalSchema,
  workoutSchema,
  type JournalState,
  type Workout,
  type WorkoutTemplate,
} from "../model";
import {
  routineInputSchema,
  trainingProgramInputSchema,
  trainingProgramPatchSchema,
  trainingExerciseId,
  type TrainingProgram,
} from "../training-program-schema";
import {
  ownedProgram,
  saveTrainingProgram,
  startTrainingDay,
} from "../training-programs";
import { startTemplate, templateFromWorkout } from "../training";
import { checkinPatchSchema, saveCheckin, type Checkin } from "../health";
import {
  mealInputSchema,
  dietTargetsSchema,
  totalNutrients,
  retainFoodClassifications,
  type Meal,
  type DietTargets,
} from "../nutrition";
const date = workoutSchema.shape.date;
const exerciseId = trainingExerciseId;
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
const repeatMealActionSchema = z
  .object({ kind: z.literal("repeat_meal"), mealId: z.string().uuid(), date })
  .strict();
const recordCardioSchema = z
  .object({ kind: z.literal("record_cardio"), cardio: cardioInputSchema })
  .strict();
const recordCheckinSchema = z
  .object({ kind: z.literal("record_checkin"), checkin: checkinPatchSchema })
  .strict();
const recordMealSchema = z
  .object({ kind: z.literal("record_meal"), meal: mealInputSchema })
  .strict();
const recordSessionSchema = z
  .object({
    kind: z.literal("record_session"),
    workout: training,
    separateSession: z.boolean().optional(),
  })
  .strict();
const progressSchema = z
  .object({
    kind: z.literal("log_workout_progress"),
    workout: training.describe(
      "Only NEW performed sets from this message, not all previously saved sets or future targets.",
    ),
    completion: z
      .enum(["ongoing", "completed"])
      .describe(
        "Ongoing unless the person explicitly says the whole workout is finished.",
      ),
    sessionId: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe(
        "Read an existing history session first to append to it or reopen it. Omit for the current draft or a new ongoing workout.",
      ),
    separateSession: z.boolean().optional(),
  })
  .strict();
const bundleEntrySchema = z.discriminatedUnion("kind", [
  recordCardioSchema,
  recordCheckinSchema,
  recordMealSchema,
  recordSessionSchema,
  progressSchema,
  repeatMealActionSchema,
]);
const singleActionSchema = z.discriminatedUnion("kind", [
  progressSchema,
  z
    .object({
      kind: z.literal("merge_sessions"),
      sessionIds: z.array(z.string().min(1).max(160)).min(2).max(10),
      name: z.string().trim().min(1).max(120),
      completion: z.enum(["ongoing", "completed"]),
    })
    .strict(),
  z
    .object({ kind: z.literal("create_routine"), routine: routineInputSchema })
    .strict(),
  z
    .object({
      kind: z.literal("update_routine"),
      routineId: z.string().min(1).max(160),
      routine: routineInputSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("delete_routine"),
      routineId: z.string().min(1).max(160),
    })
    .strict(),
  z
    .object({
      kind: z.literal("start_routine"),
      routineId: z.string().min(1).max(160),
      date,
    })
    .strict(),
  z
    .object({
      kind: z.literal("create_training_program"),
      trainingProgram: trainingProgramInputSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("update_training_program"),
      trainingProgramId: z.string().uuid(),
      programChanges: trainingProgramPatchSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("delete_training_program"),
      trainingProgramId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("start_training_day"),
      trainingProgramId: z.string().uuid(),
      dayId: z.string().uuid(),
      date,
    })
    .strict(),
  z
    .object({ kind: z.literal("dismiss_plan"), planId: z.string().uuid() })
    .strict(),
  repeatMealActionSchema,
  z
    .object({
      kind: z.literal("save_memory"),
      memoryId: z.string().uuid().optional(),
      memory: memoryInputSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("forget_memory"), memoryId: z.string().uuid() })
    .strict(),
  z
    .object({
      kind: z.literal("save_plan"),
      planId: z.string().uuid().optional(),
      plan: planInputSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("delete_plan"), planId: z.string().uuid() })
    .strict(),
  z
    .object({ kind: z.literal("record_cardio"), cardio: cardioInputSchema })
    .strict(),
  z
    .object({
      kind: z.literal("update_cardio"),
      cardioId: z.string().uuid(),
      changes: cardioPatchSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("delete_cardio"), cardioId: z.string().uuid() })
    .strict(),
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
  z
    .object({
      kind: z.literal("record_session"),
      workout: training,
      separateSession: z.boolean().optional(),
    })
    .strict(),
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
export const actionSchema = z.discriminatedUnion("kind", [
  ...singleActionSchema.options,
  z
    .object({
      kind: z.literal("record_bundle"),
      entries: z.array(bundleEntrySchema).min(2).max(6),
    })
    .strict(),
]);
// Provider-facing schema stays an object; the discriminated union above validates each action on the server.
export const actionToolSchema = z
  .object({
    kind: z.enum([
      "create_routine",
      "update_routine",
      "delete_routine",
      "start_routine",
      "create_training_program",
      "update_training_program",
      "delete_training_program",
      "start_training_day",
      "record_bundle",
      "repeat_meal",
      "save_memory",
      "forget_memory",
      "save_plan",
      "delete_plan",
      "dismiss_plan",
      "record_cardio",
      "update_cardio",
      "delete_cardio",
      "record_checkin",
      "record_meal",
      "update_meal",
      "set_diet_targets",
      "record_session",
      "log_workout_progress",
      "merge_sessions",
      "plan_workout",
      "update_session",
      "log_sets",
      "finish_workout",
      "start_programme",
      "repeat_session",
      "save_routine",
    ]),
    routine: routineInputSchema
      .describe(
        "For create_routine or update_routine: a reusable strength session from scratch, with name and complete ordered exercise/sets list. No completed session or date is needed. Weight null leaves the starting load blank. update_routine replaces this one routine; preserve unaffected exercises and sets.",
      )
      .optional(),
    routineId: z.string().min(1).max(160).optional(),
    trainingProgram: trainingProgramInputSchema
      .describe(
        "For create_training_program: a reusable one-day or multi-day plan, including rep ranges, rest, RPE, notes, cardio or recovery days. Omit day IDs for new days. It does not record completed exercise or start a workout.",
      )
      .optional(),
    trainingProgramId: z.string().uuid().optional(),
    programChanges: trainingProgramPatchSchema
      .describe(
        "For update_training_program only. Omitted top-level fields stay unchanged. If days is provided it replaces ALL days: read the full original and preserve unaffected days and existing day IDs. Do not include kind/version/program ID inside this object.",
      )
      .optional(),
    entries: z
      .array(bundleEntrySchema)
      .min(2)
      .max(6)
      .describe(
        "For record_bundle only: 2–6 reported entries reviewed and saved atomically. Combine same-date check-in fields into ONE record_checkin, including only explicitly reported fields; omitted values are preserved. No nested bundles.",
      )
      .optional(),
    memory: memoryInputSchema
      .describe(
        "Only a stable preference the person explicitly wants remembered. Saving requires their review; never infer sensitive facts.",
      )
      .optional(),
    memoryId: z.string().uuid().optional(),
    plan: planInputSchema
      .describe(
        "Only a concrete plan the person explicitly agreed to. Include a visible follow-up date; follow-up occurs on a visit, not a notification. Do not invent outcomes or treat advice as agreement.",
      )
      .optional(),
    planId: z.string().uuid().optional(),
    cardio: cardioInputSchema.optional(),
    cardioId: z.string().uuid().optional(),
    changes: cardioPatchSchema.optional(),
    workout: training.optional(),
    completion: z.enum(["ongoing", "completed"]).optional(),
    sessionIds: z.array(z.string().min(1).max(160)).min(2).max(10).optional(),
    separateSession: z
      .boolean()
      .describe(
        "True ONLY if the person explicitly confirms a separate workout despite an existing workout on this date. Never infer from a new exercise or message.",
      )
      .optional(),
    sessionId: z.string().max(160).optional(),
    exerciseId: exerciseId.optional(),
    sets: z.array(set).min(1).max(30).optional(),
    dayId: z.string().max(160).optional(),
    date: date.optional(),
    name: z.string().max(120).optional(),
    meal: mealInputSchema
      .describe(
        "New meals and new items require classification with foodGroups and ingredients [{name,evidence}]. Empty arrays mean unknown, not a complete ingredient list. On corrections, keep original ingredient evidence unless the user corrects it.",
      )
      .optional(),
    mealId: z.string().uuid().optional(),
    targets: dietTargetsSchema.optional(),
    checkin: checkinPatchSchema
      .describe(
        "Partial update: include date and ONLY the fields the user explicitly reports or corrects. Omit every unchanged field. For a sleep-only report send {date,sleepHours}; do not fill energy, soreness, waterMl, bodyweight or notes. A null value DELETES a saved measurement and an empty notes string DELETES the note: use either only when explicitly asked to clear it.",
      )
      .optional(),
  })
  .strict();
export type AgentAction = z.infer<typeof actionSchema>;
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
  workoutReview?: {
    status: WorkoutStatus;
    sources?: { id: string; title: string; date: string; sets: number }[];
  };
  entries?: PreviewEntry[];
  expiresAt: string;
  status?: "saved" | "undone";
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
  | "workoutReview"
>;
type PreparedAction = PreviewEntry & {
  state: JournalState;
  action: AgentAction;
  entries?: PreviewEntry[];
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
  let title = "",
    detail = "",
    workout: Workout | null = null;
  let meal: Meal | undefined, targets: DietTargets | undefined;
  let checkin: Checkin | undefined;
  let cardio: CardioEntry | undefined;
  let memory: CoachMemory | undefined;
  let plan: CoachPlan | undefined;
  let training: TrainingReview | undefined;
  let workoutReview: ActionPreview["workoutReview"];
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
    action.kind === "create_routine" ||
    action.kind === "update_routine" ||
    action.kind === "delete_routine" ||
    action.kind === "start_routine"
  ) {
    const original =
      "routineId" in action
        ? next.templates.find((t) => t.id === action.routineId)
        : undefined;
    if ("routineId" in action && !original)
      throw Error(
        "That routine is not in your journal. Read training_library for the correct ID.",
      );
    if (action.kind === "start_routine") {
      requireNoDraft();
      workout = startTemplate(original!, action.date);
      next.activeWorkout = workout;
      title = "Start your routine";
      detail = "Creates an unfinished workout with every set unlogged.";
    } else if (action.kind === "delete_routine") {
      next.templates = next.templates.filter((t) => t.id !== original!.id);
      training = { kind: "routine", after: original! };
      title = "Delete this routine";
      detail =
        "Removes this reusable routine. Completed sessions and your unfinished workout are kept.";
    } else {
      const routine: WorkoutTemplate = {
        id: original?.id ?? uid(),
        name: action.routine.name,
        exercises: action.routine.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          sets: e.sets.map((s) => ({ weight: s.weight ?? "", reps: s.reps })),
        })),
      };
      if (original)
        next.templates = next.templates.map((t) =>
          t.id === original.id ? routine : t,
        );
      else next.templates.push(routine);
      training = {
        kind: "routine",
        after: routine,
        ...(original ? { before: original } : {}),
      };
      title = original ? "Update your routine" : "Create your routine";
      detail = `“${routine.name}” will be available in Train → Your routines. Completed sessions and your unfinished workout are kept.`;
    }
  } else if (
    action.kind === "create_training_program" ||
    action.kind === "update_training_program" ||
    action.kind === "delete_training_program" ||
    action.kind === "start_training_day"
  ) {
    const original =
      "trainingProgramId" in action
        ? ownedProgram(next, action.trainingProgramId)
        : undefined;
    if (action.kind === "start_training_day") {
      requireNoDraft();
      workout = startTrainingDay(original!, action.dayId, action.date);
      next.activeWorkout = workout;
      title = "Start your training day";
      detail =
        "Starts the prescribed strength sets as an unlogged workout. Cardio instructions remain a plan; log activities after completing them.";
    } else if (action.kind === "delete_training_program") {
      next.program.customPrograms = next.program.customPrograms.filter(
        (p) => p !== original,
      );
      training = { kind: "program", after: original! };
      title = "Delete this training program";
      detail =
        "Removes this reusable program. Completed sessions and your unfinished workout are kept.";
    } else {
      const program = saveTrainingProgram(
        next,
        action.kind === "create_training_program"
          ? action.trainingProgram
          : { ...original!, ...action.programChanges },
        original,
      );
      training = {
        kind: "program",
        after: program,
        ...(original ? { before: original } : {}),
      };
      title = original
        ? "Update your training program"
        : "Create your training program";
      detail = `“${program.name}” will be available in Train → Your programs. These are planned targets. Completed sessions and your unfinished workout are kept.`;
    }
  } else if (action.kind === "save_memory" || action.kind === "forget_memory") {
    const coaching = coachSettings(next);
    const original = coaching.memories?.find((m) => m.id === action.memoryId);
    if (action.memoryId && !original)
      throw Error("That memory is not in your journal.");
    if (action.kind === "forget_memory") {
      memory = original;
      coaching.memories = (coaching.memories ?? []).filter(
        (m) => m.id !== action.memoryId,
      );
      title = "Forget this preference";
      detail =
        "Removes this saved memory. Existing chat messages remain until you clear the conversation.";
    } else {
      const now = new Date().toISOString();
      memory = {
        ...action.memory,
        id: original?.id ?? uid(),
        createdAt: original?.createdAt ?? now,
        updatedAt: now,
      };
      coaching.memories = [
        ...(coaching.memories ?? []).filter((m) => m.id !== memory!.id),
        memory,
      ];
      title = original
        ? "Update what Coach remembers"
        : "Remember this for future conversations";
      detail =
        "Save only if you want Coach to use this preference in future chats. You can edit or delete it in What Coach remembers.";
    }
  } else if (
    action.kind === "save_plan" ||
    action.kind === "delete_plan" ||
    action.kind === "dismiss_plan"
  ) {
    const coaching = coachSettings(next);
    const original = coaching.plans?.find((p) => p.id === action.planId);
    if (action.planId && !original)
      throw Error("That plan is not in your journal.");
    if (action.kind === "dismiss_plan") {
      plan = {
        ...original!,
        status: "dismissed",
        updatedAt: new Date().toISOString(),
      };
      coaching.plans = (coaching.plans ?? []).map((p) =>
        p.id === plan!.id ? plan! : p,
      );
      title = "Dismiss this plan";
      detail =
        "Stops follow-up and keeps the plan in your history as dismissed. It does not imply you tried or completed it.";
    } else if (action.kind === "delete_plan") {
      plan = original;
      coaching.plans = (coaching.plans ?? []).filter(
        (p) => p.id !== action.planId,
      );
      title = "Delete this agreed plan";
      detail =
        "Removes the saved plan and its follow-up. Existing chat messages remain.";
    } else {
      if (!original && action.plan.status !== "active")
        throw Error("A new agreed plan must start active.");
      if (
        action.plan.status === "active" &&
        action.plan.followUpDate < currentDate
      )
        throw Error(
          "Choose today or a future follow-up date for an active plan.",
        );
      const now = new Date().toISOString();
      plan = {
        ...action.plan,
        id: original?.id ?? uid(),
        createdAt: original?.createdAt ?? now,
        updatedAt: now,
      };
      coaching.plans = [
        ...(coaching.plans ?? []).filter((p) => p.id !== plan!.id),
        plan,
      ];
      title = original ? "Update your agreed plan" : "Agree on one small plan";
      detail =
        "Confirm this is something you want to try. Coach can ask about it when you visit from the follow-up date. You can revise or dismiss it at any time.";
    }
  } else if (action.kind === "repeat_meal") {
    const original =
      next.nutrition.meals.find((m) => m.id === action.mealId) ??
      next.nutrition.favourites?.find((m) => m.id === action.mealId);
    if (!original)
      throw Error("That meal or favourite is not in your journal.");
    if (action.date > currentDate)
      throw Error("Meals eaten cannot be dated in the future.");
    meal = repeatMeal(original, action.date);
    next.nutrition.meals.push(meal);
    if (next.nutrition.completeDays)
      next.nutrition.completeDays = next.nutrition.completeDays.filter(
        (d) => d !== action.date,
      );
    title = "Repeat a meal";
    detail =
      "Copies the saved portions, nutrition and ingredient tags. Photos from the earlier meal are not attached to this new entry. Review whether the portions were the same.";
  } else if (action.kind === "merge_sessions") {
    const merged = mergeWorkoutSessions(
      next,
      action.sessionIds,
      action.name,
      action.completion,
    );
    Object.assign(next, merged.state);
    workout = merged.workout;
    workoutReview = { status: action.completion, sources: merged.sources };
    title = "Combine split workout entries";
    detail = `Replaces ${merged.sources.length} history entries with one ${action.completion === "ongoing" ? "ongoing workout in Train" : "completed workout in Train → History"}. Every set and note is kept, including repeated sets. Review the entries and result below. You can undo this change.`;
  } else if (action.kind === "log_workout_progress") {
    if (action.workout.date > currentDate)
      throw Error("Performed training cannot be dated in the future.");
    const existing = action.sessionId ? owned(action.sessionId) : null;
    if (existing && existing.date !== action.workout.date)
      throw Error("Use the original workout date when adding sets.");
    if (existing && next.activeWorkout)
      throw Error(
        "An ongoing workout already exists. Resolve it in Train before changing a history session.",
      );
    if (
      !existing &&
      next.activeWorkout &&
      next.activeWorkout.date !== action.workout.date
    )
      throw Error(
        "The ongoing workout is on another date. Resolve it in Train before logging this workout.",
      );
    if (
      !existing &&
      !next.activeWorkout &&
      next.sessions.some((s) => s.date === action.workout.date) &&
      !action.separateSession
    )
      throw Error(
        "Training already exists on this date. Read the matching session and supply sessionId to add to it. Ask which workout if ambiguous; separateSession requires an explicitly separate workout.",
      );
    const draft = existing
      ? structuredClone(existing)
      : (next.activeWorkout ??
        buildWorkout({ ...action.workout, exercises: [] }, false));
    appendWorkoutSets(draft, action.workout.exercises);
    if (action.workout.notes && action.workout.notes !== draft.athleteNotes)
      draft.athleteNotes = [draft.athleteNotes, action.workout.notes]
        .filter(Boolean)
        .join("\n");
    if (existing)
      next.sessions = next.sessions.filter((s) => s.id !== existing.id);
    delete draft.finishedAt;
    next.activeWorkout = draft;
    workout = draft;
    if (action.completion === "completed") {
      Object.assign(next, finishWorkout(next));
      workout = next.sessions.find(
        (s) => s.id === (draft.editingSessionId ?? draft.id),
      )!;
    }
    workoutReview = { status: action.completion };
    title =
      action.completion === "ongoing"
        ? "Update your ongoing workout"
        : "Save this completed workout";
    detail =
      action.completion === "ongoing"
        ? "Adds only the newly reported sets to one ongoing workout. Earlier sets and planned exercises stay in place. Keep logging here or in Train; finish when your whole workout is done."
        : "Adds the newly reported sets to this workout and saves one completed history entry. Earlier sets are preserved; unlogged targets are left out.";
  } else if (
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
    if (action.kind === "record_session") {
      if (next.activeWorkout)
        throw Error(
          "An ongoing workout exists. Read current_workout and use log_workout_progress or finish_workout; do not split it into another history entry.",
        );
      if (
        next.sessions.some((s) => s.date === action.workout.date) &&
        !action.separateSession
      )
        throw Error(
          "Training already exists on this date. Read it and use log_workout_progress with sessionId to append, or update_session to correct it. Only an explicitly separate workout permits separateSession=true.",
        );
    }
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
    if (!draft)
      throw Error(
        "Read current_workout and use log_workout_progress to start one ongoing workout with the reported sets.",
      );
    if (draft.date > currentDate)
      throw Error("Check this workout’s future training date first.");
    appendWorkoutSets(draft, [
      { exerciseId: action.exerciseId, sets: action.sets },
    ]);
    workout = draft;
    title = `Log ${action.sets.length} ${exerciseName(action.exerciseId)} sets`;
    detail =
      "Fills the next unlogged sets, then adds extra sets if needed. Previously logged sets are preserved. The workout stays ongoing until you finish it.";
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
  } else if (
    action.kind === "record_cardio" ||
    action.kind === "update_cardio"
  ) {
    cardio =
      action.kind === "record_cardio"
        ? saveCardio(next, action.cardio, currentDate)
        : saveCardio(next, action.changes, currentDate, action.cardioId);
    title =
      action.kind === "record_cardio"
        ? "Log your cardio"
        : "Update your cardio";
    detail =
      action.kind === "record_cardio" &&
      state.cardio.sessions.some(
        (s) => s.date === cardio!.date && s.activity === cardio!.activity,
      )
        ? "A similar activity is already logged on this date. Review whether this is another activity before saving."
        : `${cardioTitle(cardio)} on ${cardio.date}. Check the details below. Other training, food and health entries are kept.`;
  } else if (action.kind === "delete_cardio") {
    cardio = next.cardio.sessions.find((s) => s.id === action.cardioId);
    if (!cardio) throw Error("That activity is not in your journal.");
    next.cardio.sessions = next.cardio.sessions.filter(
      (s) => s.id !== action.cardioId,
    );
    title = "Delete this cardio activity";
    detail = `Removes ${cardioTitle(cardio)} on ${cardio.date}. Review the activity being removed below. Other entries are kept.`;
  } else if (action.kind === "record_checkin") {
    checkin = saveCheckin(next, action.checkin, currentDate);
    title =
      action.checkin.sleepHours != null
        ? "Log your sleep"
        : "Save your daily check-in";
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
      items: retainFoodClassifications(
        action.meal.items,
        existing?.items ?? [],
      ),
      id: existing?.id ?? uid(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    next.nutrition.meals = [
      ...next.nutrition.meals.filter((m) => m.id !== meal!.id),
      meal,
    ];
    if (next.nutrition.completeDays)
      next.nutrition.completeDays = next.nutrition.completeDays.filter(
        (d) => d !== meal!.date && d !== existing?.date,
      );
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
    training = { kind: "routine", after: template };
  }
  if (workout && !workoutReview)
    workoutReview = {
      status: next.activeWorkout?.id === workout.id ? "ongoing" : "completed",
    };
  next.updatedAt = new Date().toISOString();
  return {
    state: journalSchema.parse(next),
    title,
    detail,
    workout,
    meal,
    targets,
    checkin,
    cardio,
    memory,
    plan,
    training,
    workoutReview,
    action,
  };
}
