import { z } from "zod";
import { nutritionSchema } from "./nutrition";
import { healthSchema } from "./health";

const id = z.string().min(1).max(160);
const text = z.string().max(10000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Choose a valid date",
  );
const numberText = z.union([
  z.number().finite().min(0).max(100000),
  z
    .string()
    .max(20)
    .refine(
      (v) =>
        v === "" ||
        (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100000),
    ),
]);
export const setSchema = z
  .object({
    id,
    weight: numberText,
    reps: numberText,
    rpe: z.union([numberText, z.null()]).optional(),
    result: z.enum(["", "success", "miss"]).default(""),
    logged: z.boolean().optional(),
    touched: z.boolean().optional(),
    edited: z.record(z.string(), z.boolean()).optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.logged || v.result) {
      if (
        v.weight === "" ||
        v.reps === "" ||
        !Number.isInteger(Number(v.reps)) ||
        Number(v.reps) < (v.result === "miss" ? 0 : 1)
      )
        ctx.addIssue({
          code: "custom",
          message: "Logged sets need a weight and whole repetitions",
        });
      if (
        v.rpe != null &&
        v.rpe !== "" &&
        (Number(v.rpe) < 1 || Number(v.rpe) > 10)
      )
        ctx.addIssue({
          code: "custom",
          message: "RPE must be between 1 and 10",
        });
    }
  });
export const entrySchema = z
  .object({
    id,
    exerciseId: id,
    loggingVersion: z.number().optional(),
    completed: z.boolean().optional(),
    strongSets: z.boolean().optional(),
    athleteNotes: text.default(""),
    coachCue: text.default(""),
    prescribed: z
      .object({
        targetSets: z.number().optional(),
        targetReps: z.number().optional(),
        targetWeight: numberText.nullish(),
        notes: text.optional(),
        reps: z.string().optional(),
      })
      .passthrough()
      .default({}),
    sets: z.array(setSchema).max(100),
  })
  .passthrough();
export const workoutSchema = z
  .object({
    id,
    title: z.string().min(1).max(300),
    date,
    programId: z.string().max(160).default("open"),
    programDayId: z.string().max(160).default("open"),
    programRevision: z.string().optional(),
    progressionRevision: z.number().optional(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    editingSessionId: z.string().nullish(),
    activeExerciseId: z.string().optional(),
    recovery: z.enum(["auto", "limited"]).default("auto"),
    athleteNotes: text.default(""),
    coachNotes: text.default(""),
    exercises: z.array(entrySchema).max(50),
  })
  .passthrough();
export const templateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  exercises: z
    .array(
      z.object({
        exerciseId: id,
        sets: z
          .array(z.object({ weight: numberText, reps: numberText }))
          .min(1)
          .max(100),
      }),
    )
    .min(1)
    .max(50),
});
export type WorkoutTemplate = z.infer<typeof templateSchema>;
export const journalSchema = z
  .object({
    schemaVersion: z.literal(2),
    createdAt: z.string(),
    updatedAt: z.string(),
    profile: z
      .object({
        bodyweight: z.number().finite().min(0).max(1000).default(0),
        age: z.number().min(0).max(130).default(0),
        unit: z.literal("kg").default("kg"),
        name: z.string().max(120).optional(),
        timezone: z.string().max(100).optional(),
      })
      .passthrough(),
    prs: z.record(z.string(), z.number().finite().min(0).max(100000)),
    sessions: z.array(workoutSchema).max(5000),
    activeWorkout: workoutSchema.nullable(),
    templates: z.array(templateSchema).max(100).default([]),
    nutrition: nutritionSchema.default(() => nutritionSchema.parse({})),
    health: healthSchema.default(() => healthSchema.parse({})),
    program: z
      .object({
        activeProgramId: z.string(),
        programRevision: z.string(),
        customPrograms: z.array(z.unknown()).max(100),
      })
      .passthrough(),
    preferences: z
      .object({
        installHintDismissed: z.boolean().optional(),
        largeText: z.boolean().optional(),
        restSeconds: z.number().int().min(15).max(600).optional(),
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (new Set(v.sessions.map((s) => s.id)).size !== v.sessions.length)
      ctx.addIssue({ code: "custom", message: "Duplicate workout IDs" });
    for (const w of [
      ...v.sessions,
      ...(v.activeWorkout ? [v.activeWorkout] : []),
    ]) {
      if (new Set(w.exercises.map((e) => e.id)).size !== w.exercises.length)
        ctx.addIssue({ code: "custom", message: "Duplicate exercise IDs" });
      for (const e of w.exercises)
        if (new Set(e.sets.map((s) => s.id)).size !== e.sets.length)
          ctx.addIssue({ code: "custom", message: "Duplicate set IDs" });
    }
  });
export type JournalState = z.infer<typeof journalSchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type LiftSet = z.infer<typeof setSchema>;
export type Snapshot = { state: JournalState; revision: number };
export type Identity = { id: string; name: string; email: string };
export type Plan = {
  weight: number | string | null | undefined;
  sets: number;
  reps: number;
  status: string;
  reason: string;
  step: number;
  [key: string]: unknown;
};
export type ProgramExercise = {
  exerciseId: string;
  sets: number | { min: number; max: number; default: number };
  reps: string;
  defaultReps: number;
  initialWeight: number | string;
  progression?: { step: number; maxWeight?: number };
  notes: string;
  priority: number;
  recommendation: string;
  videoRef: string | null;
  optional?: boolean;
};
export type ProgramDay = {
  id: string;
  name: string;
  title: string;
  focus: string;
  weekday: number | null;
  sessionPrompt?: string;
  exercises: ProgramExercise[];
};
