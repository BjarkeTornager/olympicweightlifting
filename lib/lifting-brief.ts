import { z } from "zod";
import { foodDate } from "./nutrition";

export const liftingBriefInputSchema = z
  .object({
    goal: z.string().trim().min(1).max(300),
    why: z.string().trim().max(300),
    experience: z.enum(["unknown", "new", "developing", "experienced"]),
    daysPerWeek: z.number().int().min(1).max(7).nullable(),
    minutesPerSession: z.number().int().min(10).max(240).nullable(),
    equipment: z.string().trim().max(500),
    constraints: z.string().trim().max(500),
    priority: z.string().trim().max(300),
    targetDate: foodDate.nullable(),
  })
  .strict();
export const liftingBriefSchema = liftingBriefInputSchema.extend({
  updatedAt: z.iso.datetime(),
});
export type LiftingBriefInput = z.infer<typeof liftingBriefInputSchema>;
export type LiftingBrief = z.infer<typeof liftingBriefSchema>;
export const experienceLabels = {
  unknown: "Not specified",
  new: "Learning the lifts",
  developing: "Building consistency",
  experienced: "Experienced lifter",
};
