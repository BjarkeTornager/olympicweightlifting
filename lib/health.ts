import { z } from "zod";
import { foodDate, totalNutrients } from "./nutrition";
import type { JournalState } from "./model";

const values = {
  sleepHours: z.number().finite().min(0).max(24).nullable(),
  energy: z.number().int().min(1).max(5).nullable(),
  soreness: z.number().int().min(1).max(5).nullable(),
  waterMl: z.number().finite().int().min(0).max(15000).nullable(),
  bodyweight: z.number().finite().min(20).max(500).nullable(),
  notes: z.string().trim().max(2000),
};
export const checkinPatchSchema = z
  .object({ date: foodDate, ...values })
  .partial()
  .required({ date: true })
  .strict()
  .refine(
    (v) => Object.keys(v).some((key) => key !== "date"),
    "Include a check-in value",
  );
export const checkinSchema = z
  .object({
    date: foodDate,
    sleepHours: values.sleepHours.default(null),
    energy: values.energy.default(null),
    soreness: values.soreness.default(null),
    waterMl: values.waterMl.default(null),
    bodyweight: values.bodyweight.default(null),
    notes: values.notes.default(""),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (v) =>
      [v.sleepHours, v.energy, v.soreness, v.waterMl, v.bodyweight].some(
        (x) => x !== null,
      ) || v.notes.length > 0,
    "Enter at least one check-in value or note",
  );
export const healthSchema = z
  .object({ checkins: z.array(checkinSchema).max(5000).default([]) })
  .superRefine((v, ctx) => {
    if (new Set(v.checkins.map((c) => c.date)).size !== v.checkins.length)
      ctx.addIssue({
        code: "custom",
        message: "Only one check-in per date is allowed",
      });
  });
export type Checkin = z.infer<typeof checkinSchema>;
export type CheckinPatch = z.infer<typeof checkinPatchSchema>;
export function saveCheckin(
  state: JournalState,
  raw: unknown,
  currentDate: string,
): Checkin {
  const patch = checkinPatchSchema.parse(raw);
  if (patch.date > currentDate)
    throw Error("Choose today or a past check-in date.");
  const existing = state.health.checkins.find((c) => c.date === patch.date);
  const checkin = checkinSchema.parse({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  state.health.checkins = [
    ...state.health.checkins.filter((c) => c.date !== checkin.date),
    checkin,
  ];
  return checkin;
}
export function offsetDate(date: string, delta: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
export type DailyPriority = {
  id: string;
  category: string;
  title: string;
  reason: string;
  action: string;
  route: string;
};
export function dailyHealth(state: JournalState, date: string) {
  const checkin = state.health.checkins.find((c) => c.date === date) ?? null;
  const meals = state.nutrition.meals.filter((m) => m.date === date);
  const nutrients = totalNutrients(meals.flatMap((m) => m.items));
  const recentCheckins = state.health.checkins
    .filter((c) => c.date >= offsetDate(date, -13) && c.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const sessions = state.sessions.filter(
    (s) => s.date >= offsetDate(date, -6) && s.date <= date,
  );
  const completedToday = sessions.filter((s) => s.date === date);
  const priorities: DailyPriority[] = [];
  const lowEnergy = checkin?.energy != null && checkin.energy <= 2;
  const highSoreness = checkin?.soreness != null && checkin.soreness >= 4;
  if (!checkin || checkin.energy == null || checkin.soreness == null)
    priorities.push({
      id: "checkin",
      category: "CHECK IN",
      title: checkin
        ? "Complete your recovery picture"
        : "Start with how you feel",
      reason: checkin
        ? "Add energy and soreness so Coach can put your training in context."
        : "A quick check-in gives your training and food choices some context.",
      action: checkin ? "Update check-in" : "Daily check-in",
      route: "checkin",
    });
  if (lowEnergy || highSoreness)
    priorities.push({
      id: "recovery",
      category: "RECOVERY",
      title: "Make room for recovery",
      reason: `You reported ${[lowEnergy ? `energy ${checkin!.energy}/5` : "", highSoreness ? `soreness ${checkin!.soreness}/5` : ""].filter(Boolean).join(" and ")} today. Consider an easier day and reassess how you feel before hard training.`,
      action: "Discuss recovery",
      route: "discuss-recovery",
    });
  else if (state.activeWorkout)
    priorities.push({
      id: "training",
      category: "TRAINING",
      title: "Pick up your saved session",
      reason: `${state.activeWorkout.title} is unfinished${state.activeWorkout.date !== date ? ` from ${state.activeWorkout.date}` : ""}. Check its date and how you feel before continuing.`,
      action: "Review workout",
      route: "workout",
    });
  else if (completedToday.length)
    priorities.push({
      id: "training",
      category: "TRAINING",
      title: "Your training is recorded",
      reason: `${completedToday.length} ${completedToday.length === 1 ? "session" : "sessions"} saved today. Review your work or ask Coach how it fits your week.`,
      action: "Review session",
      route: "history",
    });
  else
    priorities.push({
      id: "training",
      category: "TRAINING",
      title: "Choose a session that fits today",
      reason:
        "Review your programme and how you feel. A rest day can be part of your plan.",
      action: "Explore programmes",
      route: "workout/choose",
    });
  priorities.push({
    id: "nutrition",
    category: "NUTRITION",
    title: meals.length
      ? "Keep your food picture up to date"
      : "Log your first meal",
    reason: meals.length
      ? `${nutrients.calories} kcal and ${nutrients.protein} g protein across ${meals.length} logged ${meals.length === 1 ? "meal" : "meals"}. These are recorded totals, not your full daily intake.`
      : "A photo or a short description is enough to start. Review portions before saving.",
    action: meals.length ? "Review food" : "Log food",
    route: "food",
  });
  const sleep = recentCheckins.filter((c) => c.sleepHours != null);
  const weights = recentCheckins.filter((c) => c.bodyweight != null);
  return {
    date,
    checkin,
    nutrients,
    mealCount: meals.length,
    targets: state.nutrition.targets,
    priorities: priorities.slice(0, 3),
    recoveryFocus: lowEnergy || highSoreness,
    sessionsThisWeek: sessions.length,
    completedToday: completedToday.map((s) => ({
      id: s.id,
      title: s.title,
      date: s.date,
    })),
    recentSessions: sessions
      .map((s) => ({
        id: s.id,
        title: s.title,
        date: s.date,
        notes: s.athleteNotes.slice(0, 1000),
      }))
      .slice(-10),
    activeWorkout: state.activeWorkout
      ? {
          id: state.activeWorkout.id,
          title: state.activeWorkout.title,
          date: state.activeWorkout.date,
        }
      : null,
    recentCheckins,
    sleepAverage: sleep.length
      ? Math.round(
          (sleep.reduce((sum, c) => sum + c.sleepHours!, 0) / sleep.length) *
            10,
        ) / 10
      : null,
    sleepSamples: sleep.length,
    latestWeight: weights.at(-1)
      ? { value: weights.at(-1)!.bodyweight, date: weights.at(-1)!.date }
      : null,
    dataLimits:
      "Self-reported journal records only. Missing entries do not mean zero intake, sleep or activity. No wearable, clinical measurements, diagnosis, calorie expenditure or automatic background monitoring.",
  };
}
