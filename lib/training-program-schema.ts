import { z } from "zod";
import { EXERCISES } from "../js/public-data.js";
import { cardioActivitySchema } from "./cardio";

const name = z.string().trim().min(1).max(120);
const notes = z.string().trim().max(2000);
// Custom movements have an explicit namespace. A misspelled catalogue ID must
// not silently become a different exercise.
export const trainingExerciseId = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (id) =>
      EXERCISES.some((e) => e.id === id) ||
      (/^custom:[^\r\n]{1,120}$/.test(id) && id.slice(7).trim().length > 0),
    "Use an exercises catalogue ID, or custom:Movement name for an explicitly named custom movement",
  );
export const routineInputSchema = z
  .object({
    name,
    exercises: z
      .array(
        z
          .object({
            exerciseId: trainingExerciseId,
            sets: z
              .array(
                z
                  .object({
                    weight: z
                      .number()
                      .finite()
                      .min(0)
                      .max(1000)
                      .nullable()
                      .describe(
                        "Kg; null means choose a load when training, zero means bodyweight.",
                      ),
                    reps: z.number().int().min(1).max(1000),
                  })
                  .strict(),
              )
              .min(1)
              .max(30),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export const programExerciseSchema = z
  .object({
    exerciseId: trainingExerciseId,
    sets: z.number().int().min(1).max(30),
    reps: z.number().int().min(1).max(1000),
    repsMax: z.number().int().min(1).max(1000).optional(),
    weight: z
      .number()
      .finite()
      .min(0)
      .max(1000)
      .nullable()
      .describe(
        "Planned kg, not a recorded result. Null means choose a starting load.",
      ),
    restSeconds: z.number().int().min(0).max(1800).optional(),
    targetRpe: z.number().finite().min(1).max(10).optional(),
    notes: notes
      .optional()
      .describe(
        "Technique, tempo, supersets, per-side convention or explicitly proposed load assumptions.",
      ),
  })
  .strict()
  .refine(
    (e) => e.repsMax == null || e.repsMax >= e.reps,
    "Maximum reps must be at least the minimum reps",
  );
export const plannedCardioSchema = z
  .object({
    activity: cardioActivitySchema,
    title: name.optional(),
    durationSeconds: z.number().int().min(1).max(604800).optional(),
    distanceKm: z.number().finite().positive().max(10000).optional(),
    notes: notes.optional(),
  })
  .strict()
  .refine(
    (c) => Boolean(c.durationSeconds || c.distanceKm || c.notes),
    "Include duration, distance or instructions for the activity",
  );
export const trainingDayInputSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .optional()
      .describe("On an edit keep the existing day ID; omit for a new day."),
    name,
    notes: notes.optional(),
    exercises: z.array(programExerciseSchema).max(30),
    cardio: z.array(plannedCardioSchema).max(10).optional(),
  })
  .strict()
  .refine(
    (d) => Boolean(d.exercises.length || d.cardio?.length || d.notes),
    "A recovery day needs instructions; a training day needs exercises or activities",
  );
export const trainingProgramInputSchema = z
  .object({
    name,
    notes: notes.optional(),
    weeks: z.number().int().min(1).max(104).nullable().optional(),
    days: z.array(trainingDayInputSchema).min(1).max(28),
  })
  .strict();
export const trainingProgramPatchSchema = trainingProgramInputSchema
  .partial()
  .refine(
    (v) => Object.keys(v).length > 0,
    "Include at least one program change",
  );
export const trainingProgramSchema = trainingProgramInputSchema
  .extend({
    kind: z.literal("training-program"),
    version: z.literal(1),
    id: z.string().uuid(),
    days: z
      .array(trainingDayInputSchema.safeExtend({ id: z.string().uuid() }))
      .min(1)
      .max(28),
  })
  .strict()
  .refine(
    (p) => new Set(p.days.map((d) => d.id)).size === p.days.length,
    "Duplicate training day IDs",
  );
export type TrainingProgram = z.infer<typeof trainingProgramSchema>;
export type TrainingProgramInput = z.infer<typeof trainingProgramInputSchema>;
export type TrainingDay = TrainingProgram["days"][number];
export type ProgramExercisePrescription = z.infer<typeof programExerciseSchema>;
export function isTrainingProgram(value: unknown): value is TrainingProgram {
  return trainingProgramSchema.safeParse(value).success;
}
// Older exports may contain opaque legacy programs. Retain those verbatim,
// while validating all records written by the new training-program tools.
export const storedCustomProgramSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("kind" in value) ||
      value.kind !== "training-program"
    )
      return;
    const result = trainingProgramSchema.safeParse(value);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ ...issue, code: "custom" });
  });
