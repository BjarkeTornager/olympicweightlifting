import { z } from "zod";
import { foodDate, type dietTargetsSchema } from "./nutrition";
import type { JournalState } from "./model";

// The athlete's body and goal details, and the daily plan derived from them.
// Numbers are estimates for everyday planning, not a clinical prescription.
export const bodyGoalsInputSchema = z
  .object({
    age: z.number().int().min(14).max(100),
    sex: z.enum(["male", "female", "unspecified"]),
    heightCm: z.number().min(120).max(230),
    weightKg: z.number().min(30).max(300),
    targetWeightKg: z.number().min(30).max(300),
    targetDate: foodDate.nullable().default(null),
    // Movement outside training: desk job, on feet, physical work.
    activity: z.enum(["low", "moderate", "high"]),
    trainingDays: z.number().int().min(0).max(7),
    sessionMinutes: z.number().int().min(15).max(240).default(75),
    experience: z
      .enum(["new", "developing", "experienced"])
      .default("developing"),
  })
  .strict();
export const bodyGoalsSchema = bodyGoalsInputSchema.extend({
  updatedAt: z.iso.datetime(),
});
export type BodyGoalsInput = z.infer<typeof bodyGoalsInputSchema>;
export type BodyGoals = z.infer<typeof bodyGoalsSchema>;

const baseActivity = { low: 1.2, moderate: 1.375, high: 1.55 };
const KCAL_PER_KG = 7700;

export type GoalPlan = {
  direction: "lose" | "maintain" | "gain";
  restingKcal: number;
  maintenanceKcal: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  weeklyChangeKg: number;
  weeksToGoal: number | null;
  sessionsPerWeek: number;
  notes: string[];
};

const round = (value: number, step = 1) => Math.round(value / step) * step;

export function planGoals(
  input: BodyGoalsInput | BodyGoals,
  today: string,
): GoalPlan {
  // Saved goals carry updatedAt; nothing else is accepted.
  const g = bodyGoalsSchema.partial({ updatedAt: true }).parse(input);
  const notes: string[] = [];
  // Mifflin–St Jeor; without a stated sex, the midpoint of the two constants.
  const sexTerm = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
  const resting = 10 * g.weightKg + 6.25 * g.heightCm - 5 * g.age + sexTerm;
  // Weightlifting sessions average about 0.075 kcal per kg per minute.
  const trainingPerDay =
    (g.trainingDays * g.sessionMinutes * 0.075 * g.weightKg) / 7;
  const maintenance = resting * baseActivity[g.activity] + trainingPerDay;

  const difference = g.targetWeightKg - g.weightKg;
  const direction =
    Math.abs(difference) < 0.5 ? "maintain" : difference < 0 ? "lose" : "gain";
  // Sustainable rates while training hard: at most 0.5 % of bodyweight a week
  // when losing, 0.25 % when gaining.
  const maxRate = g.weightKg * (direction === "lose" ? 0.005 : 0.0025);
  let rate = direction === "maintain" ? 0 : maxRate;
  let weeks: number | null = null;
  if (direction !== "maintain") {
    const days = g.targetDate
      ? (Date.parse(g.targetDate) - Date.parse(today)) / 86400000
      : 0;
    if (days >= 7) {
      const needed = Math.abs(difference) / (days / 7);
      if (needed > maxRate)
        notes.push(
          `Reaching ${g.targetWeightKg} kg by ${g.targetDate} would need ${needed.toFixed(2)} kg a week; this plan keeps to a sustainable ${maxRate.toFixed(2)} kg.`,
        );
      rate = Math.min(needed, maxRate);
    }
    weeks = Math.ceil(Math.abs(difference) / rate);
  }
  const dailyChange = (rate * KCAL_PER_KG) / 7;
  let calories =
    maintenance + (direction === "lose" ? -dailyChange : dailyChange);
  if (calories < resting) {
    calories = resting;
    notes.push(
      "Calories are held at your resting energy; eating less than that works against training and recovery.",
    );
  }
  const heightM = g.heightCm / 100;
  if (g.targetWeightKg / (heightM * heightM) < 18.5)
    notes.push(
      "That goal weight is below the healthy range for your height. Talk it through with a doctor or dietitian before aiming for it.",
    );
  // Protein on current weight; fat at least 25 % of energy; carbs fill the rest.
  const protein = round(g.weightKg * (direction === "lose" ? 2 : 1.8));
  const fat = round(Math.max(g.weightKg * 0.8, (calories * 0.25) / 9));
  const carbs = round(Math.max(0, (calories - protein * 4 - fat * 9) / 4));
  const recommended = { new: 3, developing: 4, experienced: 5 }[g.experience];
  const sessionsPerWeek = Math.min(recommended, Math.max(g.trainingDays, 2));
  if (g.trainingDays > recommended)
    notes.push(
      `${recommended} sessions a week is plenty at your level; use the other days for recovery or light movement.`,
    );
  return {
    direction,
    restingKcal: round(resting, 10),
    maintenanceKcal: round(maintenance, 10),
    calories: round(calories, 10),
    protein,
    fat,
    carbs,
    weeklyChangeKg: Math.round(rate * 100) / 100,
    weeksToGoal: weeks,
    sessionsPerWeek,
    notes,
  };
}

export function planTargets(plan: GoalPlan): z.infer<typeof dietTargetsSchema> {
  return {
    goal: plan.direction,
    calories: plan.calories,
    protein: plan.protein,
    carbs: plan.carbs,
    fat: plan.fat,
  };
}

// Saves the goals and the daily targets they imply; the lifting brief's
// training days follow when a brief exists.
export function applyGoals(
  state: JournalState,
  input: BodyGoalsInput,
  today: string,
) {
  const goals = bodyGoalsInputSchema.parse(input);
  const plan = planGoals(goals, today);
  state.profile.body = { ...goals, updatedAt: new Date().toISOString() };
  state.profile.age = goals.age;
  state.profile.bodyweight = goals.weightKg;
  state.nutrition.targets = planTargets(plan);
  if (state.profile.lifting)
    state.profile.lifting = {
      ...state.profile.lifting,
      daysPerWeek: plan.sessionsPerWeek,
    };
  return plan;
}

export function describePlan(goals: BodyGoalsInput, plan: GoalPlan) {
  const change =
    plan.direction === "maintain"
      ? `Hold around ${goals.weightKg} kg`
      : `${plan.direction === "lose" ? "Lose" : "Gain"} about ${plan.weeklyChangeKg} kg a week towards ${goals.targetWeightKg} kg${plan.weeksToGoal ? ` (about ${plan.weeksToGoal} weeks)` : ""}`;
  return `${change}. ${plan.calories.toLocaleString("en-GB")} kcal a day: ${plan.protein} g protein, ${plan.carbs} g carbs, ${plan.fat} g fat. ${plan.sessionsPerWeek} training sessions a week.`;
}
