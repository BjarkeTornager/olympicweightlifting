import { z } from "zod";
import { foodDate, type dietTargetsSchema } from "./nutrition";
import type { JournalState } from "./model";
import {
  bodyFocuses,
  latestBodyFat,
  leannessLimits,
  saveBodyFat,
  type BodyFocus,
} from "./body-composition";

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
// Body composition beside the weight goal. Kept apart from profile.body, whose
// shape older clients check strictly: the focus and target body fat live in
// profile.bodyTargets, and today's body fat becomes a dated reading.
export const bodyCompositionInputSchema = z
  .object({
    focus: z.enum(bodyFocuses).optional(),
    bodyFatPercent: z.number().finite().min(3).max(70).optional(),
    targetBodyFatPercent: z
      .number()
      .finite()
      .min(3)
      .max(60)
      .nullable()
      .optional(),
  })
  .strict();
export const bodyGoalsRequestSchema = bodyGoalsInputSchema.extend(
  bodyCompositionInputSchema.shape,
);
export type BodyGoalsRequest = z.infer<typeof bodyGoalsRequestSchema>;
export type Composition = {
  focus?: BodyFocus;
  bodyFatPercent?: number | null;
  targetBodyFatPercent?: number | null;
};

export function splitGoals(input: BodyGoalsRequest) {
  const { focus, bodyFatPercent, targetBodyFatPercent, ...goals } =
    bodyGoalsRequestSchema.parse(input);
  return {
    goals: goals as BodyGoalsInput,
    composition: { focus, bodyFatPercent, targetBodyFatPercent },
  };
}

const baseActivity = { low: 1.2, moderate: 1.375, high: 1.55 };
const KCAL_PER_KG = 7700;

export type GoalPlan = {
  direction: "lose" | "maintain" | "gain";
  focus: BodyFocus;
  // From the latest body fat reading, when there is one.
  bodyFatPercent: number | null;
  leanMassKg: number | null;
  targetBodyFatPercent: number | null;
  // Bodyweight at the target body fat if lean mass is kept.
  weightAtTargetBodyFatKg: number | null;
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
  composition: Composition = {},
): GoalPlan {
  // Saved goals carry updatedAt; nothing else is accepted.
  const g = bodyGoalsSchema.partial({ updatedAt: true }).parse(input);
  const notes: string[] = [];
  const bodyFat = composition.bodyFatPercent ?? null;
  const targetBodyFat = composition.targetBodyFatPercent ?? null;
  const lean = bodyFat == null ? null : g.weightKg * (1 - bodyFat / 100);
  const limits = leannessLimits(g.sex);
  // With body fat known, Katch–McArdle from lean mass; otherwise
  // Mifflin–St Jeor, and without a stated sex the midpoint of its constants.
  const sexTerm = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
  const resting =
    lean != null
      ? 370 + 21.6 * lean
      : 10 * g.weightKg + 6.25 * g.heightCm - 5 * g.age + sexTerm;
  // Weightlifting sessions average about 0.075 kcal per kg per minute.
  const trainingPerDay =
    (g.trainingDays * g.sessionMinutes * 0.075 * g.weightKg) / 7;
  const maintenance = resting * baseActivity[g.activity] + trainingPerDay;

  const difference = g.targetWeightKg - g.weightKg;
  const direction =
    Math.abs(difference) < 0.5 ? "maintain" : difference < 0 ? "lose" : "gain";
  const focus: BodyFocus =
    composition.focus ??
    (direction === "lose"
      ? "lose_fat"
      : direction === "gain"
        ? "build_muscle"
        : "maintain");
  // Sustainable rates while training hard. Losing: 0.5 % of bodyweight a
  // week, up to 0.75 % with more fat to lose and 0.4 % when already lean.
  // Gaining: 0.35 %, 0.25 % or 0.15 % as muscle comes more slowly with
  // experience. Recomposition keeps either change gentle, 0.25 % at most.
  const loseRate =
    bodyFat == null
      ? 0.005
      : bodyFat >= limits.higher
        ? 0.0075
        : bodyFat <= limits.lean
          ? 0.004
          : 0.005;
  const gainRate = { new: 0.0035, developing: 0.0025, experienced: 0.0015 }[
    g.experience
  ];
  const maxRate =
    g.weightKg *
    (focus === "recomposition"
      ? Math.min(0.0025, direction === "lose" ? loseRate : gainRate)
      : direction === "lose"
        ? loseRate
        : gainRate);
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
  // Recomposition at a steady weight: a small deficit, with training and
  // protein doing the rest.
  if (focus === "recomposition" && direction === "maintain")
    calories = maintenance * 0.95;
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
  const losing = direction === "lose" || focus === "recomposition";
  // Protein on lean mass when body fat is known (2.5 g/kg while losing fat,
  // 2.2 otherwise), else on bodyweight; fat at least 25 % of energy; carbs
  // fill the rest.
  const protein =
    lean != null
      ? round(lean * (losing ? 2.5 : 2.2))
      : round(g.weightKg * (losing ? 2 : 1.8));
  if (bodyFat != null && direction === "lose" && bodyFat <= limits.lean)
    notes.push(
      `At ${bodyFat}% body fat you are already lean, so the plan loses slowly to protect muscle and training.`,
    );
  if (focus === "build_muscle" && direction === "lose")
    notes.push(
      "Building muscle while losing weight is slow; the plan follows your goal weight. Recomposition keeps the loss gentler.",
    );
  if (focus === "lose_fat" && direction === "gain")
    notes.push(
      "Your goal weight is above your current weight, so the plan adds weight; set a lower goal weight to lose fat.",
    );
  if (targetBodyFat != null && targetBodyFat < limits.essential)
    notes.push(
      `${targetBodyFat}% body fat is below the essential fat the body needs; it isn't a safe goal. Talk it through with a doctor.`,
    );
  else if (targetBodyFat != null && targetBodyFat < limits.veryLean)
    notes.push(
      `${targetBodyFat}% body fat is very lean: hard to hold and it can cost energy, hormones and performance. Treat it as a short peak at most.`,
    );
  const weightAtTarget =
    lean != null && targetBodyFat != null
      ? Math.round((lean / (1 - targetBodyFat / 100)) * 10) / 10
      : null;
  if (
    weightAtTarget != null &&
    Math.abs(weightAtTarget - g.targetWeightKg) >= 1
  )
    notes.push(
      `At ${targetBodyFat}% body fat with your current lean mass you would weigh about ${weightAtTarget} kg, not ${g.targetWeightKg} kg; one of the two goals will need to give.`,
    );
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
    focus,
    bodyFatPercent: bodyFat,
    leanMassKg: lean == null ? null : Math.round(lean * 10) / 10,
    targetBodyFatPercent: targetBodyFat,
    weightAtTargetBodyFatKg: weightAtTarget,
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

// The plan for the saved goals, with the focus, target and latest body fat.
export function planForState(state: JournalState, today: string) {
  const body = state.profile.body;
  if (!body) return null;
  return planGoals(body, today, {
    focus: state.profile.bodyTargets?.focus,
    targetBodyFatPercent: state.profile.bodyTargets?.targetBodyFatPercent,
    bodyFatPercent: latestBodyFat(state, today)?.percent ?? null,
  });
}

// Saves the goals and the daily targets they imply; the lifting brief's
// training days follow when a brief exists. Body fat stated with the goals
// is recorded as today's reading.
export function applyGoals(
  state: JournalState,
  input: BodyGoalsInput | BodyGoalsRequest,
  today: string,
) {
  const { goals, composition } = splitGoals(input);
  const stamp = new Date().toISOString();
  if (composition.bodyFatPercent != null)
    saveBodyFat(
      state,
      { date: today, percent: composition.bodyFatPercent },
      today,
    );
  const previous = state.profile.bodyTargets;
  if (
    composition.focus ||
    composition.targetBodyFatPercent !== undefined ||
    previous
  ) {
    const derived = planGoals(goals, today).focus;
    state.profile.bodyTargets = {
      focus: composition.focus ?? previous?.focus ?? derived,
      targetBodyFatPercent:
        composition.targetBodyFatPercent !== undefined
          ? composition.targetBodyFatPercent
          : (previous?.targetBodyFatPercent ?? null),
      updatedAt: stamp,
    };
  }
  state.profile.body = { ...goals, updatedAt: stamp };
  const plan = planForState(state, today)!;
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
      ? plan.focus === "recomposition"
        ? `Recomposition: hold around ${goals.weightKg} kg while losing fat and building muscle`
        : `Hold around ${goals.weightKg} kg`
      : `${plan.direction === "lose" ? "Lose" : "Gain"} about ${plan.weeklyChangeKg} kg a week towards ${goals.targetWeightKg} kg${plan.weeksToGoal ? ` (about ${plan.weeksToGoal} weeks)` : ""}`;
  const composition =
    plan.leanMassKg != null
      ? ` Based on ${plan.bodyFatPercent}% body fat, about ${plan.leanMassKg} kg lean mass${plan.targetBodyFatPercent != null ? `, towards ${plan.targetBodyFatPercent}%` : ""}.`
      : plan.targetBodyFatPercent != null
        ? ` Towards ${plan.targetBodyFatPercent}% body fat.`
        : "";
  return `${change}. ${plan.calories.toLocaleString("en-GB")} kcal a day: ${plan.protein} g protein, ${plan.carbs} g carbs, ${plan.fat} g fat. ${plan.sessionsPerWeek} training sessions a week.${composition}`;
}
