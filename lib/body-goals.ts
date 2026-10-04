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
// What the plan must know to stay safe, asked with the goals: pregnancy or
// breastfeeding (only if the athlete chooses to say), and a confirmed wish
// to lose weight towards a weight just under the healthy range.
export const pregnancyStatuses = ["pregnant", "breastfeeding"] as const;
export type Pregnancy = (typeof pregnancyStatuses)[number];
export const goalChecksInputSchema = z
  .object({
    pregnancy: z
      .enum([...pregnancyStatuses, "neither"])
      .optional()
      .describe(
        "Only if the athlete says they are pregnant or breastfeeding, or that they no longer are (neither).",
      ),
    confirmLowWeight: z
      .boolean()
      .optional()
      .describe(
        "True only when the plan asked the athlete to confirm losing weight towards a weight just under the healthy range and they said they still want to.",
      ),
  })
  .strict();
// Kept beside profile.body like profile.bodyTargets. Pregnancy is sensitive
// health data, kept only while the athlete says it applies; "neither"
// removes it. The confirmation holds for the goal weight it was given for.
export const goalChecksSchema = z
  .object({
    pregnancy: z.enum(pregnancyStatuses).nullable(),
    lowWeightConfirmedKg: z.number().min(30).max(300).nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const bodyGoalsRequestSchema = bodyGoalsInputSchema
  .extend(bodyCompositionInputSchema.shape)
  .extend(goalChecksInputSchema.shape);
export type BodyGoalsRequest = z.infer<typeof bodyGoalsRequestSchema>;
export type Composition = {
  focus?: BodyFocus;
  bodyFatPercent?: number | null;
  targetBodyFatPercent?: number | null;
  // From profile.goalChecks, or the goals form as it is filled in.
  pregnancy?: Pregnancy | null;
  lowWeightConfirmed?: boolean;
};

export function splitGoals(input: BodyGoalsRequest) {
  const {
    focus,
    bodyFatPercent,
    targetBodyFatPercent,
    pregnancy,
    confirmLowWeight,
    ...goals
  } = bodyGoalsRequestSchema.parse(input);
  return {
    goals: goals as BodyGoalsInput,
    composition: { focus, bodyFatPercent, targetBodyFatPercent },
    checks: { pregnancy, confirmLowWeight },
  };
}

const baseActivity = { low: 1.2, moderate: 1.375, high: 1.55 };
const KCAL_PER_KG = 7700;
// Making milk takes about 500 kcal a day in the first six months (EFSA).
const LACTATION_KCAL = 500;

// Resting energy at 10-18 (Henry 2005, as NNR and EFSA use it), from MJ;
// without a stated sex, the midpoint of the two equations.
function youthResting(sex: BodyGoalsInput["sex"], kg: number, metres: number) {
  const boys = (0.0651 * kg + 1.11 * metres + 1.25) * 239;
  const girls = (0.0393 * kg + 1.04 * metres + 1.93) * 239;
  return sex === "male" ? boys : sex === "female" ? girls : (boys + girls) / 2;
}

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
  // The least the plan sets: resting energy plus training, and never under
  // 1,200 kcal (1,500 for men).
  floorKcal: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  // What the calories shown add up to, recomputed whenever a limit changes
  // them.
  weeklyChangeKg: number;
  weeksToGoal: number | null;
  // The weight the plan heads for: the goal weight, or a safer one when the
  // goal would take body fat below the lowest healthy level.
  towardsKg: number;
  // A loss towards a weight just under the healthy range waits for the
  // athlete to confirm it; until then the plan holds their weight.
  confirmToLose: boolean;
  sessionsPerWeek: number;
  notes: string[];
};

const round = (value: number, step = 1) => Math.round(value / step) * step;
// Saved goals carry updatedAt; nothing else is accepted.
const plannedGoalsSchema = bodyGoalsSchema.partial({ updatedAt: true });

export function planGoals(
  input: BodyGoalsInput | BodyGoals,
  today: string,
  composition: Composition = {},
): GoalPlan {
  const g = plannedGoalsSchema.parse(input);
  const notes: string[] = [];
  const minor = g.age < 18;
  const pregnancy = composition.pregnancy ?? null;
  const limits = leannessLimits(g.sex);
  const lowestHealthy =
    g.sex === "male"
      ? "about 5% for men"
      : g.sex === "female"
        ? "about 12% for women"
        : "about 5% for men, 12% for women";
  // Body fat stays out of the sums and the goals under 18, when it is
  // measured only for medical reasons, and is paused in pregnancy.
  const usesBodyFat = !minor && pregnancy !== "pregnant";
  const reading = composition.bodyFatPercent ?? null;
  const bodyFat = usesBodyFat ? reading : null;
  const targetBodyFat = usesBodyFat
    ? (composition.targetBodyFatPercent ?? null)
    : null;
  const lean = bodyFat == null ? null : g.weightKg * (1 - bodyFat / 100);
  const heightM = g.heightCm / 100;
  // Under 18, Henry's youth equations. Otherwise Katch–McArdle from lean
  // mass when body fat is known, or Mifflin–St Jeor, and without a stated
  // sex the midpoint of its constants.
  const sexTerm = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
  const resting = minor
    ? youthResting(g.sex, g.weightKg, heightM)
    : lean != null
      ? 370 + 21.6 * lean
      : 10 * g.weightKg + 6.25 * g.heightCm - 5 * g.age + sexTerm;
  // Weightlifting sessions average about 0.075 kcal per kg per minute.
  const trainingPerDay =
    (g.trainingDays * g.sessionMinutes * 0.075 * g.weightKg) / 7;
  const maintenance =
    resting * baseActivity[g.activity] +
    trainingPerDay +
    (pregnancy === "breastfeeding" ? LACTATION_KCAL : 0);
  // Resting energy alone is no minimum for someone who trains: the plan
  // never sets less than resting energy plus training, nor under 1,200 kcal
  // (1,500 for men), where supervised weight-loss diets start.
  const floor = Math.max(
    resting + trainingPerDay,
    g.sex === "male" ? 1500 : 1200,
  );

  const difference = g.targetWeightKg - g.weightKg;
  const wanted =
    Math.abs(difference) < 0.5 ? "maintain" : difference < 0 ? "lose" : "gain";
  const focus: BodyFocus =
    composition.focus ??
    (wanted === "lose"
      ? "lose_fat"
      : wanted === "gain"
        ? "build_muscle"
        : "maintain");

  // A goal weight is checked against lean mass. Below the lowest healthy
  // body fat, the plan heads only as far as the very lean limit.
  let towards = g.targetWeightKg;
  if (lean != null && wanted === "lose") {
    const implied = 100 * (1 - lean / g.targetWeightKg);
    if (implied < limits.minimum) {
      towards = Math.min(
        g.weightKg,
        Math.round((lean / (1 - limits.veryLean / 100)) * 10) / 10,
      );
      notes.push(
        `${g.targetWeightKg <= lean ? "That goal weight is below your lean mass and can't be reached without losing muscle" : `That goal weight would take your body fat below the lowest healthy level (${lowestHealthy})`}, so the plan won't go below a safer weight. Talk it through with a doctor or sports dietitian.`,
      );
    } else if (
      implied < limits.veryLean &&
      !(targetBodyFat != null && targetBodyFat < limits.veryLean)
    )
      notes.push(
        "That goal weight would make you very lean: hard to hold, and it can cost energy, hormones and performance. Treat it as a short peak at most.",
      );
  }
  // A reading logged under 18 isn't used, but still flags a goal far too
  // lean for a teenager (under about 7 % for boys, 14 % for girls).
  const tooLeanForTeen =
    minor &&
    reading != null &&
    wanted === "lose" &&
    100 * (1 - (g.weightKg * (1 - reading / 100)) / g.targetWeightKg) <
      (g.sex === "male" ? 7 : g.sex === "female" ? 14 : 10.5);

  const remaining = towards - g.weightKg;
  let direction: GoalPlan["direction"] =
    Math.abs(remaining) < 0.5 ? "maintain" : remaining < 0 ? "lose" : "gain";
  // A target date less than a week away, or past, is too close to plan a
  // change: the plan holds the athlete's weight.
  const days = g.targetDate
    ? (Date.parse(g.targetDate) - Date.parse(today)) / 86400000
    : null;
  let held = false;
  if (direction !== "maintain" && days != null && days < 7) {
    notes.push(
      days < 0
        ? "Your target date has passed, so the plan holds your weight for now. Review your goals to set a new date, or none."
        : "Your target date is less than a week away, too close to plan a safe change, so the plan holds your weight. Set a later date, or none, to plan one.",
    );
    direction = "maintain";
    held = true;
  }

  // Whether the goal asks for a deficit, and whether the plan may set one.
  const cutting =
    direction === "lose" ||
    (focus === "recomposition" && direction === "maintain" && !held);
  let cut = cutting;
  let confirmToLose = false;
  let slowly = false;
  if (minor) {
    if (cutting || tooLeanForTeen)
      notes.push(
        `Under 18 the plan doesn't set a calorie deficit: a growing body needs plenty of energy for training and growth, so it holds your weight.${tooLeanForTeen ? " That goal weight would also mean very low body fat for a teenager." : ""} If you want to change your weight, talk it through with a parent, your coach or a doctor.`,
      );
    if (reading != null || composition.targetBodyFatPercent != null)
      notes.push(
        "Under 18 the plan doesn't use body fat readings or set a body fat goal; while you're growing, how you train, eat and recover matters more.",
      );
    cut = false;
  }
  if (pregnancy === "pregnant") {
    notes.push(
      "In pregnancy the plan sets no deficit and no body fat goal: gaining weight is a normal, healthy part of pregnancy, and energy needs rise as it goes on. Your midwife or doctor can advise you on eating and training.",
    );
    cut = false;
  } else if (pregnancy === "breastfeeding") {
    notes.push(
      "While you're breastfeeding the plan adds about 500 kcal a day for making milk and sets no deficit. Keep an eye on your milk supply, and talk to your midwife or health visitor before trying to lose weight.",
    );
    cut = false;
  }
  // Adult BMI, now and at the goal: under 17.5 is a high-risk level, under
  // 18.5 underweight. Under 18 the real gate is no deficit, and in
  // pregnancy BMI doesn't apply.
  const bmiNow = g.weightKg / (heightM * heightM);
  const bmiGoal = g.targetWeightKg / (heightM * heightM);
  const underweightGoal =
    "That goal weight is below the healthy range for your height. Talk it through with a doctor or dietitian before aiming for it.";
  if (minor) {
    if (bmiGoal < 18.5) notes.push(underweightGoal);
  } else if (pregnancy !== "pregnant") {
    const goalLower = bmiGoal <= bmiNow;
    const lower = goalLower ? "That goal weight" : "Your weight";
    const before = goalLower ? " before aiming for it" : "";
    const lowest = Math.min(bmiNow, bmiGoal);
    if (lowest < 17.5) {
      notes.push(
        `${lower} is well below the healthy range for your height${cut ? ", so the plan holds your weight rather than cutting" : ""}. Please talk to a doctor or dietitian about what's right for you.`,
      );
      cut = false;
    } else if (cutting && lowest < 18.5) {
      if (!cut)
        notes.push(
          `${lower} is just below the healthy range for your height. Talk it through with a doctor or dietitian${before}.`,
        );
      else if (composition.lowWeightConfirmed) {
        notes.push(
          `${lower} is just below the healthy range for your height. As you've confirmed it, the plan loses slowly; talk it through with a doctor or dietitian${before}.`,
        );
        slowly = true;
      } else {
        notes.push(
          `${lower} is just below the healthy range for your height, so the plan holds your weight for now. Talk it through with a doctor or dietitian; if you still want to lose weight, confirm it and the plan will lose slowly.`,
        );
        cut = false;
        confirmToLose = true;
      }
    } else if (bmiGoal < 18.5) notes.push(underweightGoal);
  }
  if (!cut && direction === "lose") direction = "maintain";

  // Sustainable rates while training hard. Losing: 0.5 % of bodyweight a
  // week, up to 0.75 % with more fat to lose and 0.4 % when already lean,
  // and no more than 0.5 % towards a weight just under the healthy range.
  // Gaining: 0.35 %, 0.25 % or 0.15 % as muscle comes more slowly with
  // experience. Recomposition keeps either change gentle, 0.25 % at most.
  const fatRate =
    bodyFat == null
      ? 0.005
      : bodyFat >= limits.higher
        ? 0.0075
        : bodyFat <= limits.lean
          ? 0.004
          : 0.005;
  const loseRate = slowly ? Math.min(fatRate, 0.005) : fatRate;
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
  // A target date at least a week away may need less.
  const needed =
    direction !== "maintain" && days != null
      ? Math.abs(remaining) / (days / 7)
      : null;
  if (needed != null) rate = Math.min(needed, maxRate);
  let calories =
    maintenance + ((direction === "lose" ? -1 : 1) * rate * KCAL_PER_KG) / 7;
  // Recomposition at a steady weight: a small deficit, with training and
  // protein doing the rest.
  if (cut && focus === "recomposition" && direction === "maintain")
    calories = maintenance * 0.95;
  // A deficit stays within 500 kcal a day, or 1,000 kcal (about 0.9 kg a
  // week, inside the 1 kg limit) when body fat is high, and never takes
  // calories below the floor. With the floor close to maintenance there is
  // no room for one.
  const cap = bodyFat != null && bodyFat >= limits.higher ? 1000 : 500;
  let limited: "cap" | "floor" | "hold" | null = null;
  if (calories < maintenance) {
    if (maintenance - calories > cap) {
      calories = maintenance - cap;
      limited = "cap";
    }
    if (floor >= maintenance - 100) {
      calories = maintenance;
      direction = "maintain";
      limited = "hold";
    } else if (calories < floor) {
      calories = floor;
      limited = "floor";
    }
  }
  calories = Math.max(calories, floor);
  // The rate and weeks the calories shown add up to.
  rate =
    direction === "maintain"
      ? 0
      : (Math.abs(calories - maintenance) * 7) / KCAL_PER_KG;
  const weeks =
    direction === "maintain" ? null : Math.ceil(Math.abs(remaining) / rate);
  const weeklyChangeKg = Math.round(rate * 100) / 100;
  if (limited === "hold")
    notes.push(
      "There isn't room for a safe deficit alongside your training and recovery, so the plan holds your weight at maintenance.",
    );
  else if (limited === "floor")
    notes.push(
      `Calories are kept at a level that covers your resting energy and training, so the plan loses more slowly: about ${weeklyChangeKg} kg a week.`,
    );
  else if (limited === "cap")
    notes.push(
      `The deficit is kept to ${cap.toLocaleString("en-GB")} kcal a day to protect training and muscle, so the plan loses about ${weeklyChangeKg} kg a week.`,
    );
  if (direction !== "maintain" && needed != null && needed - rate > 0.005)
    notes.push(
      `Reaching ${towards} kg by ${g.targetDate} would need ${needed.toFixed(2)} kg a week; this plan keeps to a sustainable ${rate.toFixed(2)} kg.`,
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
  if (targetBodyFat != null && targetBodyFat < limits.minimum)
    notes.push(
      `${targetBodyFat}% body fat is below the lowest healthy level (${lowestHealthy}); it isn't a safe goal. Talk it through with a doctor.`,
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
  // Macros from the calories as shown, so they add up to that number.
  const kcal = round(calories, 10);
  const fat = round(Math.max(g.weightKg * 0.8, (kcal * 0.25) / 9));
  const carbs = round(Math.max(0, (kcal - protein * 4 - fat * 9) / 4));
  // Sessions on the days available, up to what suits the experience; none
  // when no days are free.
  const recommended = { new: 3, developing: 4, experienced: 5 }[g.experience];
  const sessionsPerWeek = Math.min(recommended, g.trainingDays);
  if (g.trainingDays > recommended)
    notes.push(
      `${recommended} sessions a week is plenty at your level; use the other days for recovery or light movement.`,
    );
  if (g.trainingDays === 1)
    notes.push(
      "One heavy session a week can usually hold your strength; older lifters may need 2. WHO and ACSM advise at least 2 a week for gains and health.",
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
    floorKcal: round(floor, 10),
    calories: kcal,
    protein,
    fat,
    carbs,
    weeklyChangeKg,
    weeksToGoal: weeks,
    towardsKg: towards,
    confirmToLose,
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

// The plan for the saved goals, with the focus, target, latest body fat and
// the safety checks given with them.
export function planForState(state: JournalState, today: string) {
  const body = state.profile.body;
  if (!body) return null;
  const checks = state.profile.goalChecks;
  return planGoals(body, today, {
    focus: state.profile.bodyTargets?.focus,
    targetBodyFatPercent: state.profile.bodyTargets?.targetBodyFatPercent,
    bodyFatPercent: latestBodyFat(state, today)?.percent ?? null,
    pregnancy: checks?.pregnancy ?? null,
    lowWeightConfirmed: checks?.lowWeightConfirmedKg === body.targetWeightKg,
  });
}

// Saves the goals and the daily targets they imply. The lifting brief is the
// athlete's own record of the days they have and changes only through its
// own review, so the plan's sessions never overwrite it. Body fat stated
// with the goals is recorded as today's reading. Pregnancy and a confirmed
// low goal weight carry over when not given again, the confirmation only
// while the goal weight stays the same.
export function applyGoals(
  state: JournalState,
  input: BodyGoalsInput | BodyGoalsRequest,
  today: string,
) {
  const { goals, composition, checks } = splitGoals(input);
  const stamp = new Date().toISOString();
  const before = state.profile.goalChecks;
  const pregnancy =
    checks.pregnancy === undefined
      ? (before?.pregnancy ?? null)
      : checks.pregnancy === "neither"
        ? null
        : checks.pregnancy;
  const confirmedKg =
    (checks.confirmLowWeight ??
    before?.lowWeightConfirmedKg === goals.targetWeightKg)
      ? goals.targetWeightKg
      : null;
  if (pregnancy || confirmedKg != null)
    state.profile.goalChecks = {
      pregnancy,
      lowWeightConfirmedKg: confirmedKg,
      updatedAt: stamp,
    };
  else delete state.profile.goalChecks;
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
  return plan;
}

export function describePlan(goals: BodyGoalsInput, plan: GoalPlan) {
  const change =
    plan.direction === "maintain"
      ? plan.focus === "recomposition"
        ? `Recomposition: hold around ${goals.weightKg} kg while losing fat and building muscle`
        : `Hold around ${goals.weightKg} kg`
      : `${plan.direction === "lose" ? "Lose" : "Gain"} about ${plan.weeklyChangeKg} kg a week towards ${plan.towardsKg} kg${plan.weeksToGoal ? ` (about ${plan.weeksToGoal} weeks)` : ""}`;
  const composition =
    plan.leanMassKg != null
      ? ` Based on ${plan.bodyFatPercent}% body fat, about ${plan.leanMassKg} kg lean mass${plan.targetBodyFatPercent != null ? `, towards ${plan.targetBodyFatPercent}%` : ""}.`
      : plan.targetBodyFatPercent != null
        ? ` Towards ${plan.targetBodyFatPercent}% body fat.`
        : "";
  return `${change}. ${plan.calories.toLocaleString("en-GB")} kcal a day: ${plan.protein} g protein, ${plan.carbs} g carbs, ${plan.fat} g fat. ${describeSessions(plan.sessionsPerWeek, "training session")}.${composition}`;
}

// "4 sessions a week", "1 session a week", or none planned.
export function describeSessions(sessions: number, noun = "session") {
  return sessions === 0
    ? "No lifting days planned"
    : `${sessions} ${noun}${sessions === 1 ? "" : "s"} a week`;
}
