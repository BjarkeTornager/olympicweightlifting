import { z } from "zod";
import { memoryInputSchema, planInputSchema } from "../coaching";
import { liftingBriefInputSchema } from "../lifting-brief";
import { cardioInputSchema, cardioPatchSchema } from "../cardio";
import { workoutSchema } from "../model";
import {
  routineInputSchema,
  trainingProgramInputSchema,
  trainingProgramPatchSchema,
  trainingExerciseId,
} from "../training-program-schema";
import { checkinPatchSchema } from "../health";
import { mealInputSchema, dietTargetsSchema } from "../nutrition";
import { bodyGoalsRequestSchema } from "../body-goals";
import { bodyFatInputSchema } from "../body-composition";
import { drinkInputSchema } from "../hydration";
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
const setChangesSchema = z
  .object({
    weight: z.number().finite().min(0).max(1000).optional(),
    reps: z.number().int().min(0).max(1000).optional(),
    result: z.enum(["success", "miss"]).optional(),
    rpe: z.number().min(1).max(10).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Include a set correction");
const correctSetSchema = z
  .object({
    kind: z.literal("correct_workout_set"),
    workoutId: z.string().min(1).max(160),
    entryId: z.string().min(1).max(160),
    setId: z.string().min(1).max(160),
    setChanges: setChangesSchema,
  })
  .strict();
export const trainingInputSchema = z
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
const logDrinkSchema = z
  .object({ kind: z.literal("log_drink"), drink: drinkInputSchema })
  .strict();
const recordBodyFatSchema = z
  .object({ kind: z.literal("record_body_fat"), bodyFat: bodyFatInputSchema })
  .strict();
const recordSessionSchema = z
  .object({
    kind: z.literal("record_session"),
    workout: trainingInputSchema,
    separateSession: z.boolean().optional(),
  })
  .strict();
const progressSchema = z
  .object({
    kind: z.literal("log_workout_progress"),
    workout: trainingInputSchema.describe(
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
  logDrinkSchema,
  recordBodyFatSchema,
  recordSessionSchema,
  progressSchema,
  repeatMealActionSchema,
]);
const singleActionSchema = z.discriminatedUnion("kind", [
  correctSetSchema,
  z
    .object({
      kind: z.literal("set_lifting_brief"),
      liftingBrief: liftingBriefInputSchema.nullable(),
    })
    .strict(),
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
    .object({ kind: z.literal("delete_meal"), mealId: z.string().uuid() })
    .strict(),
  logDrinkSchema,
  z
    .object({ kind: z.literal("delete_drink"), drinkId: z.string().uuid() })
    .strict(),
  recordBodyFatSchema,
  z.object({ kind: z.literal("delete_body_fat"), date }).strict(),
  z
    .object({ kind: z.literal("set_diet_targets"), targets: dietTargetsSchema })
    .strict(),
  z
    .object({
      kind: z.literal("set_body_goals"),
      bodyGoals: bodyGoalsRequestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("record_session"),
      workout: trainingInputSchema,
      separateSession: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("plan_workout"), workout: trainingInputSchema })
    .strict(),
  z
    .object({
      kind: z.literal("update_session"),
      sessionId: z.string().min(1).max(160),
      workout: trainingInputSchema,
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
  z.object({ kind: z.literal("discard_workout") }).strict(),
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
      "set_lifting_brief",
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
      "set_body_goals",
      "delete_meal",
      "log_drink",
      "delete_drink",
      "record_body_fat",
      "delete_body_fat",
      "record_session",
      "log_workout_progress",
      "merge_sessions",
      "plan_workout",
      "update_session",
      "log_sets",
      "correct_workout_set",
      "finish_workout",
      "discard_workout",
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
        "For record_bundle only: 2–6 reported entries validated and saved atomically. Combine same-date check-in fields into ONE record_checkin, including only explicitly reported fields; omitted values are preserved. No nested bundles.",
      )
      .optional(),
    memory: memoryInputSchema
      .describe(
        "Only a stable preference the person explicitly wants remembered. Saving requires their review; never infer sensitive facts.",
      )
      .optional(),
    memoryId: z.string().uuid().optional(),
    liftingBrief: liftingBriefInputSchema
      .nullable()
      .optional()
      .describe(
        "For set_lifting_brief only: the complete athlete-reported brief, preserving unchanged fields. Null clears it only when requested. Read lifting_review first; saving requires review.",
      ),
    plan: planInputSchema
      .describe(
        "Only a concrete plan the person explicitly agreed to. Include a visible follow-up date; follow-up occurs on a visit, not a notification. Do not invent outcomes or treat advice as agreement.",
      )
      .optional(),
    planId: z.string().uuid().optional(),
    cardio: cardioInputSchema.optional(),
    cardioId: z.string().uuid().optional(),
    changes: cardioPatchSchema.optional(),
    workout: trainingInputSchema.optional(),
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
    workoutId: z.string().min(1).max(160).optional(),
    entryId: z.string().min(1).max(160).optional(),
    setId: z.string().min(1).max(160).optional(),
    setChanges: setChangesSchema
      .describe(
        "For correct_workout_set only: change ONLY reported fields of one already logged active-workout set. Copy workoutId, entryId and setId from current_workout. Preserve all other sets, metadata and ongoing status. Never use log_sets or log_workout_progress for a correction; those append sets.",
      )
      .optional(),
    dayId: z.string().max(160).optional(),
    date: date.optional(),
    name: z.string().max(120).optional(),
    meal: mealInputSchema
      .describe(
        "New meals and new items require classification with foodGroups and ingredients [{name,evidence}]. Empty arrays mean unknown, not a complete ingredient list. On corrections, keep original ingredient evidence unless the user corrects it.",
      )
      .optional(),
    answer: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .describe(
        "When the user ALSO asks a question or explanation alongside the change, include the complete answer here in their language. Finish relevant read-only lookups first. Answer only the additional request; omit save/review claims and instructions, which the server supplies. Omit for logging-only requests. This text grants no additional writes.",
      )
      .optional(),
    reviewRequested: z
      .boolean()
      .describe(
        "For prepare_change on a direct-logging client: true ONLY when the user explicitly asks for a preview/review or says not to save yet. Ordinary record reports and corrections use log_entry instead. Changes requiring review (deletes, plans, targets, memories) do not need this flag.",
      )
      .optional(),
    mealId: z.string().uuid().optional(),
    targets: dietTargetsSchema.optional(),
    drink: drinkInputSchema
      .optional()
      .describe(
        "For log_drink: one drink as reported, ml as a whole number (a glass ≈ 250, a bottle ≈ 500, a can ≈ 330 unless stated). Log each drink separately; the day's total adds up.",
      ),
    drinkId: z.string().uuid().optional(),
    bodyGoals: bodyGoalsRequestSchema
      .optional()
      .describe(
        "For set_body_goals: every field as the athlete stated it. Ask for anything missing; never guess age, sex, height or weights. Optional: focus (lose_fat, build_muscle, recomposition or maintain) as they describe it, bodyFatPercent if they state a current reading, and targetBodyFatPercent if they name one.",
      ),
    bodyFat: bodyFatInputSchema
      .optional()
      .describe(
        "For record_body_fat: one body fat reading as reported, with its date and method if they say it (scale, dexa, calipers, tape, estimate or other; null if unknown). One reading per date; a new one for the same date replaces it. delete_body_fat takes only date.",
      ),
    checkin: checkinPatchSchema
      .describe(
        "Partial update: include date and ONLY the fields the user explicitly reports or corrects. Omit every unchanged field. For a sleep-only report send {date,sleepHours}; do not fill energy, soreness, waterMl, bodyweight or notes. A null value DELETES a saved measurement and an empty notes string DELETES the note: use either only when explicitly asked to clear it.",
      )
      .optional(),
  })
  .strict();
export type AgentAction = z.infer<typeof actionSchema>;
// Only everyday records and their corrections can bypass the review step.
// Deletions, targets, plans and durable memories still use prepare_change.
export const loggingKinds = [
  "record_meal",
  "log_drink",
  "repeat_meal",
  "update_meal",
  "record_checkin",
  "record_body_fat",
  "record_cardio",
  "update_cardio",
  "record_session",
  "update_session",
  "log_workout_progress",
  "log_sets",
  "correct_workout_set",
  "finish_workout",
  "discard_workout",
  "record_bundle",
] as const;
export const loggingToolSchema = actionToolSchema
  .pick({
    kind: true,
    entries: true,
    cardio: true,
    cardioId: true,
    changes: true,
    workout: true,
    completion: true,
    separateSession: true,
    sessionId: true,
    exerciseId: true,
    sets: true,
    workoutId: true,
    entryId: true,
    setId: true,
    setChanges: true,
    answer: true,
    date: true,
    meal: true,
    mealId: true,
    checkin: true,
    drink: true,
    bodyFat: true,
  })
  .extend({
    kind: z.enum(loggingKinds),
  });
