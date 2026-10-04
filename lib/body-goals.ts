import { z } from "zod";
import { dailyTarget, foodDate, type dietTargetsSchema } from "./nutrition";
import type { JournalState } from "./model";
import {
  bodyFocuses,
  latestBodyFat,
  leannessLimits,
  saveBodyFat,
  type BodyFocus,
} from "./body-composition";
import { LIFTING_NET_KCAL_PER_KG_HOUR } from "./energy";
import { currentWeightKg, recordTargets } from "./target-history";

const sessionMinutes = z.number().int().min(15).max(240);
const experience = z.enum(["new", "developing", "experienced"]);
// Movement outside training: desk job, on feet, physical work, heavy manual
// work.
const savedActivities = ["low", "moderate", "high"] as const;
export const activityLevels = [...savedActivities, "very_high"] as const;

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
    activity: z.enum(activityLevels),
    trainingDays: z.number().int().min(0).max(7),
    sessionMinutes: sessionMinutes.default(75),
    experience: experience.default("developing"),
  })
  .strict();
// Saved as profile.body, whose shape older versions of the app check
// strictly (a server still draining a deploy, or a rollback): heavy manual
// work is saved as "high" with profile.heavyManualWork beside it, and
// goalsForState puts the two back together.
export const bodyGoalsSchema = bodyGoalsInputSchema.extend({
  activity: z.enum(savedActivities),
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
// breastfeeding and the baby's age, kidney disease or a doctor's limit on
// protein, and the low-energy questions before a deficit (each only if the
// athlete chooses to say), a confirmed wish to lose weight towards a weight
// just under the healthy range, and whether the goal weight is a
// competition weight class.
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
    weeksSinceBirth: z
      .number()
      .int()
      .min(0)
      .max(260)
      .nullable()
      .optional()
      .describe(
        "While breastfeeding: how many weeks old the baby is, only if the athlete says; null if they'd rather not say after all.",
      ),
    limitProtein: z
      .boolean()
      .optional()
      .describe(
        "True only if the athlete says they have kidney disease or a doctor has told them to limit protein; false only if they say they don't, or no longer do.",
      ),
    confirmLowWeight: z
      .boolean()
      .optional()
      .describe(
        "True only when the plan asked the athlete to confirm losing weight towards a weight just under the healthy range and they said they still want to.",
      ),
    energySigns: z
      .boolean()
      .nullable()
      .optional()
      .describe(
        "Only after asking the low-energy questions: true if the athlete answered yes to any, false if no to all; null if they'd rather not answer after all. Leave it out otherwise.",
      ),
    weightClass: z
      .boolean()
      .optional()
      .describe(
        "True only when the athlete says the goal weight is a competition weight class they must make, with targetDate as the weigh-in date if they know it; false when it no longer is.",
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
// Kidney disease or a doctor's limit on protein, and while breastfeeding the
// day the baby was born, from its age in weeks. Sensitive health data, kept
// like pregnancy only while the athlete says it applies, and beside
// profile.goalChecks, whose shape older versions of the app check strictly.
export const goalHealthSchema = z
  .object({
    limitProtein: z.literal(true).optional(),
    babyBornOn: foodDate.optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
// The answers to the low-energy questions: only the day they were given and
// whether any was yes, never which. Sensitive health data, kept beside the
// goals only so the plan stays safe, and removed when the athlete would
// rather not say. A yes holds the plan at maintenance until the questions
// are answered again; a no lasts 3 months (ENERGY_CHECK_DAYS).
export const energyCheckSchema = z
  .object({ date: foodDate, signs: z.boolean() })
  .strict();
// A competition weight class the goal weight is: its limit, and the
// weigh-in day (the target date) when known. Kept while the goal weight is
// the class.
export const weighInSchema = z
  .object({
    classKg: z.number().min(30).max(300),
    date: foodDate.nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
// Feet and inches and pounds, as the athlete gives them: Coach passes them
// on rather than working out cm and kg itself, and metricGoals converts.
// Inches alone are the whole height.
export const imperialGoalsSchema = z
  .object({
    heightFeet: z.number().int().min(3).max(8).optional(),
    heightInches: z.number().min(0).max(100).optional(),
    weightLb: z.number().positive().max(1000).optional(),
    targetWeightLb: z.number().positive().max(1000).optional(),
  })
  .strict();
const INCH_CM = 2.54;
const POUND_KG = 0.45359237;
// A goal change. Session length and experience, which a change to the goal
// often leaves out, keep their saved values (applyGoals) rather than
// falling back to 75 minutes and "developing".
export const bodyGoalsRequestSchema = bodyGoalsInputSchema
  .extend({
    sessionMinutes: sessionMinutes.optional(),
    experience: experience.optional(),
  })
  .extend(bodyCompositionInputSchema.shape)
  .extend(goalChecksInputSchema.shape);
export type BodyGoalsRequest = z.infer<typeof bodyGoalsRequestSchema>;
// A goal change as Coach gives it: height and weights in cm and kg, or in
// feet and inches and pounds as the athlete said them (metricGoals). A zero
// in one of them, as a model filling every field sends, is no value, as
// metricGoals takes it.
const unlessZero = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => v || undefined, schema);
export const coachGoalsSchema = bodyGoalsRequestSchema.extend({
  heightCm: unlessZero(bodyGoalsInputSchema.shape.heightCm.optional()),
  weightKg: unlessZero(bodyGoalsInputSchema.shape.weightKg.optional()),
  targetWeightKg: unlessZero(
    bodyGoalsInputSchema.shape.targetWeightKg.optional(),
  ),
  heightFeet: unlessZero(imperialGoalsSchema.shape.heightFeet),
  heightInches: imperialGoalsSchema.shape.heightInches,
  weightLb: unlessZero(imperialGoalsSchema.shape.weightLb),
  targetWeightLb: unlessZero(imperialGoalsSchema.shape.targetWeightLb),
});

// Coach's goal change with any feet and inches or pounds in cm and kg, to
// 0.1, and the imperial fields gone; anything else passes through for the
// schema to check. Given both, the athlete's own units win.
export function metricGoals(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { heightFeet, heightInches, weightLb, targetWeightLb, ...rest } =
    raw as Record<string, unknown>;
  const tenth = (value: number) => Math.round(value * 10) / 10;
  // A zero, as a model filling every field sends, is no value: 0 inches
  // count only with feet.
  const given = (value: unknown) =>
    value != null && value !== "" && value !== 0;
  const height = given(heightFeet) || given(heightInches);
  return {
    ...rest,
    ...(height && {
      heightCm: tenth(
        (Number(heightFeet ?? 0) * 12 + Number(heightInches ?? 0)) * INCH_CM,
      ),
    }),
    ...(given(weightLb) && { weightKg: tenth(Number(weightLb) * POUND_KG) }),
    ...(given(targetWeightLb) && {
      targetWeightKg: tenth(Number(targetWeightLb) * POUND_KG),
    }),
  };
}
export type Composition = {
  focus?: BodyFocus;
  bodyFatPercent?: number | null;
  targetBodyFatPercent?: number | null;
  // From profile.goalChecks and profile.goalHealth, or the goals form as it
  // is filled in.
  pregnancy?: Pregnancy | null;
  // While breastfeeding, the baby's age in whole weeks, when known.
  weeksSinceBirth?: number | null;
  limitProtein?: boolean;
  lowWeightConfirmed?: boolean;
  // The low-energy answers in force (energySigns): true for a yes, false
  // for no to all, null when there are none or a no is over 3 months old.
  energySigns?: boolean | null;
  // The goal weight is a competition weight class, and the target date its
  // weigh-in.
  weightClass?: boolean;
  // Which way the saved goals head, for the plan at the current weight
  // (planForState): once the weight reaches the goal, or passes it, the
  // plan holds it there rather than turning round.
  heading?: "lose" | "gain";
  // The weight given with the saved goals, for the plan at the current
  // weight: a safer weight the plan heads for instead of the goal is
  // somewhere to reach only when it is below that.
  startKg?: number;
};

export function splitGoals(input: BodyGoalsRequest) {
  const {
    focus,
    bodyFatPercent,
    targetBodyFatPercent,
    pregnancy,
    weeksSinceBirth,
    limitProtein,
    confirmLowWeight,
    energySigns,
    weightClass,
    ...goals
  } = bodyGoalsRequestSchema.parse(input);
  return {
    goals,
    composition: { focus, bodyFatPercent, targetBodyFatPercent },
    checks: {
      pregnancy,
      weeksSinceBirth,
      limitProtein,
      confirmLowWeight,
      energySigns,
      weightClass,
    },
  };
}

// Everyday movement before training, as a multiple of resting energy (the
// physical activity level): about 1.4 for a desk job with little else, 1.55
// on your feet some of the day, 1.75 in physical work and 2.0 in heavy
// manual work (NNR 2023, FAO/WHO/UNU 2004, NASEM 2023). Free-living adults
// sustain at least 1.4, so maintenance is never set below that.
const everydayActivity = { low: 1.4, moderate: 1.55, high: 1.75, very_high: 2 };
const LOWEST_ACTIVITY = 1.4;
// Training counts for at most 1,000 kcal a day, a plausible ceiling for
// lifting; five 4-hour sessions a week would count more at 88 kg.
const TRAINING_KCAL_CAP = 1000;
const KCAL_PER_KG = 7700;
// Making milk takes about 500 kcal a day in the first six months (EFSA).
export const LACTATION_KCAL = 500;
// While breastfeeding, no deficit in the first weeks after the birth, nor
// while the baby's age isn't known. After that a gentle one: at most
// 500 kcal a day (about 0.45 kg a week) at a BMI of 25 or more, where the
// studies of loss while breastfeeding were done, and half that below it.
export const POSTPARTUM_WEEKS = 6;
const breastfeedingCapKcal = { fromBmi25: 500, below: 250 };

// Resting energy at 10-18 (Henry 2005, as NNR and EFSA use it), from MJ;
// without a stated sex, the midpoint of the two equations.
function youthResting(sex: BodyGoalsInput["sex"], kg: number, metres: number) {
  const boys = (0.0651 * kg + 1.11 * metres + 1.25) * 239;
  const girls = (0.0393 * kg + 1.04 * metres + 1.93) * 239;
  return sex === "male" ? boys : sex === "female" ? girls : (boys + girls) / 2;
}

// Sustainable weekly change as a share of bodyweight while training hard,
// and protein per kg. The plan uses them and Coach quotes them
// (knowledge.ts), so the two can't disagree.
export const weeklyRates = {
  // 0.5 %, up to 0.75 % with more fat to lose and 0.4 % when already lean.
  lose: { lean: 0.004, usual: 0.005, higher: 0.0075 },
  // Muscle comes more slowly with experience.
  gain: { new: 0.0035, developing: 0.0025, experienced: 0.0015 },
  // Recomposition keeps either change gentle.
  recomposition: 0.0025,
};
// On lean mass when body fat is known, else on bodyweight; more while
// losing fat or recomposing. At a BMI of 30 or more without body fat, per
// kg of a height-adjusted weight instead (adjustedWeightKg), as per-kg
// amounts on total weight run past anything studied there.
export const proteinPerKg = {
  leanMass: { losing: 2.5, other: 2.2 },
  bodyweight: { losing: 2, other: 1.8 },
  adjusted: { losing: 2, other: 1.8 },
};
const ADJUSTED_FROM_BMI = 30;
// 1.6 g/kg, about where gains in lean mass level off: the plan's protein
// on bodyweight at a BMI of 30 or more, within the adjusted weight's
// limits, and the least it goes down to to make room for carbohydrate.
const MODEST_PROTEIN_PER_KG = 1.6;
// The weight at a BMI of 25 plus a quarter of the weight above it.
export function adjustedWeightKg(weightKg: number, heightCm: number) {
  const reference = 25 * (heightCm / 100) ** 2;
  return reference + 0.25 * (weightKg - reference);
}
// Fat, as a percentage of energy: a quarter, inside every reference range
// (20-35 %), going down to a fifth only to make room for carbohydrate and
// never under a quarter before 18. Carbohydrate fills the rest and is at
// least 130 g a day, the generally recommended minimum (NASEM), so a low
// calorie or heavy plan can't squeeze it out.
export const macroShares = { fat: 25, leastFat: 20, leastFatUnder18: 25 };
export const CARBS_FLOOR_G = 130;
// More in pregnancy and while breastfeeding (NASEM).
export const pregnancyCarbsFloorG = { pregnant: 175, breastfeeding: 210 };
// With kidney disease or a doctor's limit on protein the plan sets no
// protein target, and carbohydrate fills what is left after fat and about
// 0.8 g of protein per kg (of the adjusted weight at a BMI of 30 or more):
// what most adults need (NASEM, NNR), and what kidney guidance gives (KDIGO),
// so the other targets never take more for granted.
const REFERENCE_PROTEIN_PER_KG = 0.8;
// How long a no to the low-energy questions holds: a deficit asks them
// again about every 3 months while it lasts.
export const ENERGY_CHECK_DAYS = 91;
// The three low-energy questions, asked before a plan cuts or aims very
// lean: pragmatic routing to a professional, not a validated test or a
// diagnosis (IOC REDs CAT2 primary and secondary indicators). The periods
// one is for women and anyone who'd rather not give their sex, when they
// don't use hormonal contraception, and never in pregnancy or while
// breastfeeding, when periods normally stop.
export const energyQuestions = {
  periods:
    "Have you missed a period, or had cycles longer than 35 days, in the last 3 months? (Skip this if you use hormonal contraception or gave birth in the last few months.)",
  fracture: "Have you had a stress fracture in the last 2 years?",
  eating:
    "Have you had an eating disorder, or does eating often feel out of your control?",
};
const asksPeriods = (
  sex: BodyGoalsInput["sex"],
  pregnancy?: Pregnancy | null,
) => sex !== "male" && !pregnancy;
// The questions for this athlete, in the order Coach asks them.
export function energyQuestionsFor(
  sex: BodyGoalsInput["sex"],
  pregnancy?: Pregnancy | null,
) {
  return [
    energyQuestions.fracture,
    energyQuestions.eating,
    ...(asksPeriods(sex, pregnancy) ? [energyQuestions.periods] : []),
  ];
}
// What they ask about, for the notes: "stress fractures, eating and
// periods", or with "or" for any one of them.
function screenTopics(
  sex: BodyGoalsInput["sex"],
  joiner: "and" | "or",
  pregnancy?: Pregnancy | null,
) {
  const topics = [
    "stress fractures",
    "eating",
    ...(asksPeriods(sex, pregnancy) ? ["periods"] : []),
  ];
  return `${topics.slice(0, -1).join(", ")} ${joiner} ${topics.at(-1)}`;
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
  // Grams to 5 g, adding up to the calories within 10 kcal.
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
  // False in pregnancy, when the plan sets no weight goal and saves no daily
  // calorie or macro targets: energy needs rise by trimester, and the
  // midwife or doctor advises on eating.
  dailyTargets: boolean;
  // False with kidney disease or a doctor's limit on protein, in pregnancy
  // and while breastfeeding: the plan saves no protein target, as their
  // doctor, midwife or dietitian advises on it. protein is then only the
  // amount the other macros allow for.
  proteinTarget: boolean;
  // The goal weight is a competition weight class (Composition); never in
  // pregnancy, when the plan sets no weight goal.
  weightClass: boolean;
  // The plan reaches that class by its weigh-in, or with no weigh-in date
  // at all, so the plan's line may promise it.
  makesClass: boolean;
  // The plan would set a deficit, or aims for very lean body fat, without
  // answers to the low-energy questions in force: Coach asks them first.
  energyCheckDue: boolean;
  // The weight has reached the goal (or the safer weight the plan heads
  // for), or passed it, since the goals were saved, so the plan holds it.
  reachedGoal: boolean;
  sessionsPerWeek: number;
  notes: string[];
  // The notes on health and safety, also in notes: limits that hold or
  // slow the plan, and who to talk to. The voice coach reads every one
  // aloud before saving, and the iPhone shows them in full.
  safetyNotes: string[];
};

const round = (value: number, step = 1) => Math.round(value / step) * step;
// A weight within 1 kg of the goal, or 1 % of bodyweight when that is more,
// is at it: day-to-day swings are about that size.
export const maintainBandKg = (weightKg: number) =>
  Math.max(1, 0.01 * weightKg);
// To the 5 g at or above, so a least amount is kept after rounding.
const upTo5 = (value: number) => Math.ceil(value / 5 - 1e-9) * 5;
// Saved goals carry updatedAt; nothing else is accepted.
const plannedGoalsSchema = bodyGoalsInputSchema.extend({
  updatedAt: z.iso.datetime().optional(),
});
// Goals as given or saved, before the defaults fill in.
export type GoalsGiven = z.input<typeof plannedGoalsSchema>;

export function planGoals(
  input: GoalsGiven,
  today: string,
  composition: Composition = {},
): GoalPlan {
  const g = plannedGoalsSchema.parse(input);
  const notes: string[] = [];
  const safetyNotes: string[] = [];
  // A note on health or safety (GoalPlan.safetyNotes).
  const warn = (note: string) => {
    notes.push(note);
    safetyNotes.push(note);
  };
  const minor = g.age < 18;
  const pregnancy = composition.pregnancy ?? null;
  const pregnant = pregnancy === "pregnant";
  const breastfeeding = pregnancy === "breastfeeding";
  const limitProtein = Boolean(composition.limitProtein);
  const limits = leannessLimits(g.sex);
  const lowestHealthy =
    g.sex === "male"
      ? "about 5% for men"
      : g.sex === "female"
        ? "about 12% for women"
        : "about 5% for men, 12% for women";
  // Body fat stays out of the sums and the goals under 18, when it is
  // measured only for medical reasons, and is paused in pregnancy.
  const usesBodyFat = !minor && !pregnant;
  const reading = composition.bodyFatPercent ?? null;
  const bodyFat = usesBodyFat ? reading : null;
  const targetBodyFat = usesBodyFat
    ? (composition.targetBodyFatPercent ?? null)
    : null;
  const lean = bodyFat == null ? null : g.weightKg * (1 - bodyFat / 100);
  const heightM = g.heightCm / 100;
  const bmiNow = g.weightKg / (heightM * heightM);
  const bmiGoal = g.targetWeightKg / (heightM * heightM);
  // Under 18, Henry's youth equations. Otherwise Katch–McArdle from lean
  // mass when body fat is known, or Mifflin–St Jeor, and without a stated
  // sex the midpoint of its constants.
  const sexTerm = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
  const resting = minor
    ? youthResting(g.sex, g.weightKg, heightM)
    : lean != null
      ? 370 + 21.6 * lean
      : 10 * g.weightKg + 6.25 * g.heightCm - 5 * g.age + sexTerm;
  // Sessions on the days available, up to what suits the experience; none
  // when no days are free.
  const recommended = { new: 3, developing: 4, experienced: 5 }[g.experience];
  const sessionsPerWeek = Math.min(recommended, g.trainingDays);
  // Training energy for those sessions, net of the resting energy the
  // everyday level already counts, at the same cost per hour as the burn
  // estimate (energy.ts).
  const trainingKcal =
    (sessionsPerWeek *
      (g.sessionMinutes / 60) *
      LIFTING_NET_KCAL_PER_KG_HOUR *
      g.weightKg) /
    7;
  const trainingPerDay = Math.min(trainingKcal, TRAINING_KCAL_CAP);
  const milk = breastfeeding ? LACTATION_KCAL : 0;
  const maintenance =
    resting * Math.max(everydayActivity[g.activity], LOWEST_ACTIVITY) +
    trainingPerDay +
    milk;
  // Resting energy alone is no minimum for someone who trains: the plan
  // never sets less than resting energy plus training (and making milk), nor
  // under 1,200 kcal (1,500 for men), where supervised weight-loss diets
  // start.
  const floor = Math.max(
    resting + trainingPerDay + milk,
    g.sex === "male" ? 1500 : 1200,
  );

  const days = g.targetDate
    ? (Date.parse(g.targetDate) - Date.parse(today)) / 86400000
    : null;
  // A weight class is a limit to make: any weight above it is to lose, so
  // the plan reaches the limit rather than stopping just above it and
  // leaving a last-minute cut. At or under the limit with the weigh-in
  // still ahead, the plan holds the weight rather than gaining up to the
  // limit, where day-to-day swings would leave one. Otherwise within the
  // maintain band (maintainBandKg) holds, as does a weight that has passed
  // the goal the saved goals head for. In pregnancy there is no class to
  // make: the plan sets no weight goal.
  const weightClass = Boolean(composition.weightClass) && !pregnant;
  const withinClass =
    weightClass && days != null && days >= 0 && g.weightKg <= g.targetWeightKg;
  const passed =
    composition.heading === "lose"
      ? g.weightKg <= g.targetWeightKg
      : composition.heading === "gain" && g.weightKg >= g.targetWeightKg;
  const band = maintainBandKg(g.weightKg);
  const steady = (change: number) =>
    passed ||
    withinClass ||
    (!(weightClass && change < 0) && Math.abs(change) < band);
  const difference = g.targetWeightKg - g.weightKg;
  const wanted = steady(difference)
    ? "maintain"
    : difference < 0
      ? "lose"
      : "gain";
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
  let safer: number | null = null;
  if (lean != null && wanted === "lose") {
    const implied = 100 * (1 - lean / g.targetWeightKg);
    if (implied < limits.minimum) {
      safer = Math.round((lean / (1 - limits.veryLean / 100)) * 10) / 10;
      towards = Math.min(g.weightKg, safer);
      warn(
        `${g.targetWeightKg <= lean ? "That goal weight is below your lean mass and can't be reached without losing muscle" : `That goal weight would take your body fat below the lowest healthy level (${lowestHealthy})`}, so the plan won't go below a safer weight. Talk it through with a doctor or sports dietitian.`,
      );
    } else if (
      implied < limits.veryLean &&
      !(targetBodyFat != null && targetBodyFat < limits.veryLean)
    )
      warn(
        "That goal weight would make you very lean: hard to hold, and it can cost energy, hormones and performance. Treat it as a short peak at most.",
      );
  }
  // A reading logged under 18 isn't used, but still flags a goal far too
  // lean for a teenager (under about 7 % for boys, 14 % for girls, and the
  // girls' level without a stated sex).
  const tooLeanForTeen =
    minor &&
    reading != null &&
    wanted === "lose" &&
    100 * (1 - (g.weightKg * (1 - reading / 100)) / g.targetWeightKg) <
      (g.sex === "male" ? 7 : 14);

  const remaining = towards - g.weightKg;
  // At the goal, or at the safer weight the plan heads for instead, or past
  // it, since the goals were saved. A safer weight at or above the weight
  // given with the goals was never somewhere to head: the plan has held
  // the weight from the start, so nothing is reached.
  const passedTowards =
    composition.heading === "lose"
      ? g.weightKg <= towards
      : composition.heading === "gain" && g.weightKg >= towards;
  const heldFromStart =
    safer != null && safer >= (composition.startKg ?? g.weightKg);
  const reachedGoal =
    composition.heading != null &&
    !pregnant &&
    (steady(difference) ||
      (!heldFromStart && (passedTowards || steady(remaining))));
  if (reachedGoal && !withinClass)
    notes.push(
      `You've reached ${towards === g.targetWeightKg ? "your goal weight" : `the ${towards} kg the plan heads for`}, so the plan holds your weight there. Review your goals to set a new one.`,
    );
  // In pregnancy the plan sets no weight goal: gaining is a healthy part of
  // it.
  let direction: GoalPlan["direction"] =
    pregnant || passedTowards || steady(remaining)
      ? "maintain"
      : remaining < 0
        ? "lose"
        : "gain";
  // A target date less than a week away, or past, is too close to plan a
  // change, a recomposition's small cut included: the plan holds the
  // athlete's weight.
  let held = false;
  if (
    (direction !== "maintain" || focus === "recomposition") &&
    !pregnant &&
    days != null &&
    days < 7
  ) {
    warn(
      days < 0
        ? "Your target date has passed, so the plan holds your weight for now. Review your goals to set a new date, or none."
        : weightClass
          ? "Your weigh-in is less than a week away, too close to plan a safe cut, so the plan holds your weight."
          : "Your target date is less than a week away, too close to plan a safe change, so the plan holds your weight. Set a later date, or none, to plan one.",
    );
    direction = "maintain";
    held = true;
  }

  // Whether the goal asks for a deficit, and whether the plan may set one.
  const cutting =
    !pregnant &&
    (direction === "lose" ||
      (focus === "recomposition" && direction === "maintain" && !held));
  let cut = cutting;
  let confirmToLose = false;
  let slowly = false;
  if (minor) {
    if (cutting || tooLeanForTeen)
      warn(
        `Under 18 the plan doesn't set a calorie deficit: a growing body needs plenty of energy for training and growth, so it holds your weight.${tooLeanForTeen ? " That goal weight would also mean very low body fat for a teenager." : ""} If you want to change your weight, talk it through with a parent, your coach or a doctor.`,
      );
    if (reading != null || composition.targetBodyFatPercent != null)
      warn(
        "Under 18 the plan doesn't use body fat readings or set a body fat goal; while you're growing, how you train, eat and recover matters more.",
      );
    cut = false;
  }
  if (pregnant) {
    warn(
      "In pregnancy the plan sets no weight goal and no daily calorie, protein or body fat targets: gaining weight is a normal, healthy part of pregnancy, and energy needs rise as it goes on, mostly in the second and third trimesters. Your midwife or doctor can advise you on eating and training.",
    );
    cut = false;
  } else if (breastfeeding) {
    // No deficit until the baby is 6 weeks old, or while its age isn't
    // known; then a gentle one (breastfeedingCapKcal).
    const weeks = composition.weeksSinceBirth ?? null;
    const early = weeks == null || weeks < POSTPARTUM_WEEKS;
    const asks = cutting && !minor;
    const deficit = !asks
      ? "sets no deficit"
      : early
        ? `sets no deficit until your baby is ${POSTPARTUM_WEEKS} weeks old`
        : `keeps any deficit gentle (at most about ${bmiNow >= 25 ? "0.5" : "0.25"} kg a week)`;
    const askAge =
      asks && weeks == null
        ? ` If you'd like the plan to include a gentle loss once your baby is ${POSTPARTUM_WEEKS} weeks old, say how old your baby is.`
        : "";
    warn(
      `While you're breastfeeding the plan adds about ${LACTATION_KCAL} kcal a day for making milk and ${deficit}, with no protein target.${askAge} Keep an eye on your milk supply, and talk to your midwife or health visitor before trying to lose weight.`,
    );
    if (early) cut = false;
  }
  if (limitProtein) {
    warn(
      "As you have kidney disease or a doctor's advice to limit protein, the plan sets no protein target. Follow your doctor's or dietitian's advice on how much protein suits you.",
    );
  }
  // Adult BMI, now and at the goal: under 17.5 is a high-risk level, under
  // 18.5 underweight. Under 18 the real gate is no deficit, and in
  // pregnancy BMI doesn't apply.
  const underweightGoal =
    "That goal weight is below the healthy range for your height. Talk it through with a doctor or dietitian before aiming for it.";
  if (minor) {
    if (bmiGoal < 18.5 && !pregnant) warn(underweightGoal);
  } else if (!pregnant) {
    const goalLower = bmiGoal <= bmiNow;
    const lower = goalLower ? "That goal weight" : "Your weight";
    const before = goalLower ? " before aiming for it" : "";
    const lowest = Math.min(bmiNow, bmiGoal);
    if (lowest < 17.5) {
      warn(
        `${lower} is well below the healthy range for your height${cut ? ", so the plan holds your weight rather than cutting" : ""}. Please talk to a doctor or dietitian about what's right for you.`,
      );
      cut = false;
    } else if (cutting && lowest < 18.5) {
      if (!cut)
        warn(
          `${lower} is just below the healthy range for your height. Talk it through with a doctor or dietitian${before}.`,
        );
      else if (composition.lowWeightConfirmed) {
        warn(
          `${lower} is just below the healthy range for your height. As you've confirmed it, the plan loses slowly; talk it through with a doctor or dietitian${before}.`,
        );
        slowly = true;
      } else {
        warn(
          `${lower} is just below the healthy range for your height, so the plan holds your weight for now. Talk it through with a doctor or dietitian; if you still want to lose weight, confirm it and the plan will lose slowly.`,
        );
        cut = false;
        confirmToLose = true;
      }
    } else if (bmiGoal < 18.5) warn(underweightGoal);
  }
  // The low-energy questions, before a plan that cuts or aims very lean:
  // any yes holds the weight at maintenance and points to a professional,
  // never a diagnosis (IOC REDs CAT2 routing). Without answers in force the
  // plan says they are due, and Coach asks them. A yes kept from before,
  // beside a plan that doesn't cut (under 18, in pregnancy, gaining), still
  // points to who can help.
  const veryLeanTarget =
    targetBodyFat != null && targetBodyFat < limits.veryLean;
  const screened = cut || veryLeanTarget;
  if (composition.energySigns === true) {
    const answered = `You answered yes to one of the questions on ${screenTopics(g.sex, "or", pregnancy)}`;
    if (screened) {
      warn(
        `${answered}, so the plan holds your weight at maintenance for now. These can have many causes, and a sports doctor or sports dietitian can help you look into them and plan any change safely.`,
      );
      cut = false;
      direction = "maintain";
    } else
      warn(
        `${answered}. These can have many causes, and ${pregnant ? "your midwife or doctor" : "a sports doctor or sports dietitian"} can help you look into them.`,
      );
  }
  if (!cut && direction === "lose") direction = "maintain";

  // Sustainable rates while training hard. Losing: 0.5 % of bodyweight a
  // week, up to 0.75 % with more fat to lose and 0.4 % when already lean,
  // and no more than 0.5 % towards a weight just under the healthy range.
  // Gaining: 0.35 %, 0.25 % or 0.15 % as muscle comes more slowly with
  // experience. Recomposition keeps either change gentle, 0.25 % at most.
  const fatRate =
    bodyFat == null
      ? weeklyRates.lose.usual
      : bodyFat >= limits.higher
        ? weeklyRates.lose.higher
        : bodyFat <= limits.lean
          ? weeklyRates.lose.lean
          : weeklyRates.lose.usual;
  const loseRate = slowly ? Math.min(fatRate, weeklyRates.lose.usual) : fatRate;
  const gainRate = weeklyRates.gain[g.experience];
  const maxRate =
    g.weightKg *
    (focus === "recomposition"
      ? Math.min(
          weeklyRates.recomposition,
          direction === "lose" ? loseRate : gainRate,
        )
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
  // week, inside the 1 kg limit) when body fat is high, while breastfeeding
  // within breastfeedingCapKcal, and never takes calories below the floor.
  // With the floor close to maintenance there is no room for one.
  const cap = breastfeeding
    ? bmiNow >= 25
      ? breastfeedingCapKcal.fromBmi25
      : breastfeedingCapKcal.below
    : bodyFat != null && bodyFat >= limits.higher
      ? 1000
      : 500;
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

  // Protein on lean mass when body fat is known, else on bodyweight, to
  // 5 g (proteinPerKg). At a BMI of 30 or more without body fat it is
  // 1.6 g/kg of bodyweight, kept to at least the amount per kg of the
  // adjusted weight and at most 2.0 g/kg of it (so 2.0 g/kg of it while
  // losing). No target with kidney disease or a doctor's limit on protein,
  // where the other macros allow for REFERENCE_PROTEIN_PER_KG, nor in
  // pregnancy or while breastfeeding, where they allow for the usual amount.
  const proteinTarget = !limitProtein && !pregnancy;
  const losing = direction === "lose" || focus === "recomposition";
  const adjusted = lean == null && bmiNow >= ADJUSTED_FROM_BMI;
  const basisKg =
    lean ?? (adjusted ? adjustedWeightKg(g.weightKg, g.heightCm) : g.weightKg);
  const perKg =
    lean != null
      ? proteinPerKg.leanMass
      : adjusted
        ? proteinPerKg.adjusted
        : proteinPerKg.bodyweight;
  const proteinFor = basisKg * (losing ? perKg.losing : perKg.other);
  let protein = round(
    limitProtein
      ? REFERENCE_PROTEIN_PER_KG *
          (bmiNow >= ADJUSTED_FROM_BMI
            ? adjustedWeightKg(g.weightKg, g.heightCm)
            : g.weightKg)
      : adjusted
        ? Math.min(
            Math.max(MODEST_PROTEIN_PER_KG * g.weightKg, proteinFor),
            basisKg * proteinPerKg.adjusted.losing,
          )
        : proteinFor,
    5,
  );
  // Macros from the calories as shown, to 5 g, so they add up to them
  // within the carbohydrate's rounding (10 kcal). Fat is a quarter of
  // energy and carbohydrate the rest. Short of 130 g of carbohydrate (175 g
  // in pregnancy, 210 g while breastfeeding), fat goes down to a fifth of
  // energy (not under 18), then protein to 1.6 g/kg of the weight it is set
  // from, then calories up towards maintenance; the note says which.
  const carbsFloor = pregnancy
    ? pregnancyCarbsFloorG[pregnancy]
    : CARBS_FLOOR_G;
  let kcal = round(calories, 10);
  const leastFat = minor ? macroShares.leastFatUnder18 : macroShares.leastFat;
  const fatAt = (share: number) => upTo5((kcal * share) / 900);
  let fat = fatAt(macroShares.fat);
  const carbsLeft = () => (kcal - protein * 4 - fat * 9) / 4;
  const usualProtein = protein;
  if (carbsLeft() < carbsFloor)
    fat = Math.max(
      fatAt(leastFat),
      fat - upTo5(((carbsFloor - carbsLeft()) * 4) / 9),
    );
  if (carbsLeft() < carbsFloor)
    protein = Math.max(
      Math.min(protein, upTo5(MODEST_PROTEIN_PER_KG * basisKg)),
      protein - upTo5(carbsFloor - carbsLeft()),
    );
  const atMaintenance = round(maintenance, 10);
  let raised = false;
  while (carbsLeft() < carbsFloor && kcal < atMaintenance) {
    kcal += 10;
    fat = fatAt(leastFat);
    raised = true;
  }
  let heldForCarbs = false;
  if (raised) {
    calories = kcal;
    if (kcal >= atMaintenance && direction === "lose") {
      direction = "maintain";
      heldForCarbs = true;
    }
  }
  const carbs = round(carbsLeft(), 5);

  // The rate and weeks the calories shown add up to. A plan that keeps to
  // its target date gets there by then, so its weeks never run past it.
  rate =
    direction === "maintain"
      ? 0
      : (Math.abs(calories - maintenance) * 7) / KCAL_PER_KG;
  const byDate =
    needed != null && days != null && needed - rate <= 0.005
      ? Math.max(1, Math.round(days / 7))
      : Infinity;
  const weeks =
    direction === "maintain"
      ? null
      : Math.min(Math.ceil(Math.abs(remaining) / rate), byDate);
  const weeklyChangeKg = Math.round(rate * 100) / 100;
  if (limited === "hold")
    warn(
      "There isn't room for a safe deficit alongside your training and recovery, so the plan holds your weight at maintenance.",
    );
  // Once carbohydrate sets the calories, its own note says so instead.
  else if (limited === "floor" && !raised)
    warn(
      `Calories are kept at a level that covers your resting energy${breastfeeding ? ", training and making milk" : " and training"}, so the plan loses more slowly: about ${weeklyChangeKg} kg a week.`,
    );
  else if (limited === "cap" && !raised)
    warn(
      `The deficit is kept to ${cap.toLocaleString("en-GB")} kcal a day ${breastfeeding ? "while you're breastfeeding" : "to protect training and muscle"}, so the plan loses about ${weeklyChangeKg} kg a week.`,
    );
  // Fat counts as lowered by its share as shown: losing only its 5 g
  // round-up still leaves a quarter. In pregnancy the plan saves no macros,
  // so there is no note on them, and without a protein target none on
  // protein.
  const fatPercent = Math.round((fat * 900) / kcal);
  const room = [
    fatPercent < macroShares.fat &&
      `fat is about ${fatPercent}% of calories rather than a quarter`,
    proteinTarget &&
      protein < usualProtein &&
      `protein is ${protein} g rather than ${usualProtein} g`,
    raised &&
      (heldForCarbs
        ? "the plan holds your weight at maintenance"
        : direction === "lose"
          ? `the plan loses more slowly: about ${weeklyChangeKg} kg a week`
          : "calories are a little higher"),
  ].filter((part): part is string => Boolean(part));
  if (room.length && !pregnant)
    notes.push(
      `To keep ${carbsFloor} g of carbohydrate a day, the generally recommended minimum${breastfeeding ? " while breastfeeding" : ""}, ${room.length > 1 ? `${room.slice(0, -1).join(", ")} and ${room.at(-1)}` : room[0]}.`,
    );
  // A weight class the plan won't make by the weigh-in, or at all: the
  // safe options, and never a last-minute cut of water or food, which is
  // for a coach or sports dietitian (ACSM, and the weigh-in only 2 hours
  // before lifting). Under 18 no cut at all: ACSM discourages making weight
  // while growing. A weigh-in already past has its own note. The rate
  // quoted is the plan's own (weeklyChangeKg), as its line gives it.
  const classKg = g.targetWeightKg;
  const aboveClass =
    weightClass && g.weightKg > classKg && !(days != null && days < 0);
  const makesClass =
    direction === "lose" &&
    towards <= classKg &&
    !(needed != null && needed - rate > 0.005);
  if (aboveClass && !makesClass) {
    const lead = held
      ? ""
      : direction === "lose" && towards > classKg
        ? `The plan stops at ${towards} kg, above the ${classKg} kg class. `
        : direction === "lose" && needed != null && days != null
          ? `Making the ${classKg} kg class by the weigh-in on ${g.targetDate} would need about ${needed.toFixed(2)} kg a week; at a sustainable ${weeklyChangeKg.toFixed(2)} kg a week you'd weigh about ${Math.round((g.weightKg - (rate * days) / 7) * 10) / 10} kg then. `
          : `This plan holds your weight${days != null ? ` up to the weigh-in on ${g.targetDate}` : ""}, above the ${classKg} kg class. `;
    const options = `Consider ${days != null ? "a later meet or " : ""}the next class up`;
    warn(
      minor
        ? `${lead}${options}. Cutting weight to make a class isn't advised while you're growing; talk it through with a parent, your coach or a doctor.`
        : `${lead}${options}, and talk it through with your coach or a sports dietitian. The plan never includes a last-minute cut of water or food; leave any such cut to them.`,
    );
  } else if (
    direction !== "maintain" &&
    needed != null &&
    needed - rate > 0.005 &&
    !aboveClass
  )
    warn(
      `Reaching ${towards} kg by ${g.targetDate} would need ${needed.toFixed(2)} kg a week; this plan keeps to a sustainable ${weeklyChangeKg.toFixed(2)} kg.`,
    );
  if (withinClass)
    notes.push(
      `You're within the ${classKg} kg class, so the plan holds your weight up to the weigh-in on ${g.targetDate}.`,
    );
  // A reading would give protein from lean mass instead; not asked for
  // under 18, when readings aren't used, nor without a protein target.
  if (adjusted && !minor && proteinTarget)
    notes.push(
      "Protein is an estimate from your height and weight; add a body fat reading for a better number.",
    );
  if (bodyFat != null && direction === "lose" && bodyFat <= limits.lean)
    warn(
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
    warn(
      `${targetBodyFat}% body fat is below the lowest healthy level (${lowestHealthy}); it isn't a safe goal. Talk it through with a doctor.`,
    );
  else if (targetBodyFat != null && targetBodyFat < limits.veryLean)
    warn(
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
  if (trainingKcal > TRAINING_KCAL_CAP)
    warn(
      `The plan counts your training as ${TRAINING_KCAL_CAP.toLocaleString("en-GB")} kcal a day at most, so it may be on the low side; if your weight falls faster than planned, ask Coach to review it.`,
    );
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
    dailyTargets: !pregnant,
    proteinTarget,
    weightClass,
    makesClass: weightClass && makesClass,
    // Asked only when a deficit remains once every other limit has had its
    // say, or for a very lean goal.
    energyCheckDue:
      screened &&
      composition.energySigns == null &&
      (kcal < atMaintenance || veryLeanTarget),
    reachedGoal,
    sessionsPerWeek,
    notes,
    safetyNotes,
  };
}

// The daily targets the plan saves; in pregnancy none, so every surface
// reads "No daily target", and no protein target when it sets none.
export function planTargets(plan: GoalPlan): z.infer<typeof dietTargetsSchema> {
  const set = plan.dailyTargets;
  return {
    goal: plan.direction,
    calories: set ? plan.calories : null,
    protein: set && plan.proteinTarget ? plan.protein : null,
    carbs: set ? plan.carbs : null,
    fat: set ? plan.fat : null,
  };
}

// The line shown with the goals in place of the plan's notes when the saved
// daily targets aren't the plan's: set by hand, or saved before the plan
// changed (a target date passed, a new limit, a much changed body fat).
export const TARGETS_DIFFER =
  "Your daily targets aren't the ones your goals give now. Ask Coach to review them with you.";

// The plan's notes describe the saved daily targets only when they are the
// plan's: the same goal, and calories within 100 kcal, as each new body fat
// reading moves the plan by a few, with each macro within as much energy
// (25 g of protein or carbohydrate, 11 g of fat), so a note about protein
// or carbohydrate never sits beside a macro from an older plan. Otherwise
// one line says they differ, so a note never contradicts the target shown
// beside it. When the plan sets no protein target, a saved one is the
// athlete's own (their doctor's or dietitian's figure, as its note
// advises), so it doesn't count as a difference.
export function notesForTargets(
  plan: GoalPlan,
  targets: z.infer<typeof dietTargetsSchema>,
) {
  const planned = planTargets(plan);
  const kcalPer = { calories: 1, protein: 4, carbs: 4, fat: 9 };
  const close = (Object.keys(kcalPer) as (keyof typeof kcalPer)[]).every(
    (key) => {
      if (key === "protein" && !plan.proteinTarget) return true;
      const a = planned[key];
      const b = dailyTarget(targets[key]);
      return a == null || b == null
        ? a === b
        : Math.abs(a - b) * kcalPer[key] <= 100;
    },
  );
  return plan.direction === targets.goal && close
    ? plan.notes
    : [TARGETS_DIFFER];
}

const WEEK_MS = 7 * 86400000;
const weeksOld = (bornOn: string, today: string) =>
  Math.floor((Date.parse(today) - Date.parse(bornOn)) / WEEK_MS);

// While breastfeeding, the baby's age in whole weeks today, when known.
export function babyWeeks(state: JournalState, today: string) {
  const bornOn = state.profile.goalHealth?.babyBornOn;
  return state.profile.goalChecks?.pregnancy === "breastfeeding" && bornOn
    ? weeksOld(bornOn, today)
    : null;
}

// The low-energy answers in force today: a yes until the questions are
// answered again, a no for ENERGY_CHECK_DAYS, otherwise none (null).
export function energySigns(state: JournalState, today: string) {
  const check = state.profile.energyCheck;
  if (!check) return null;
  if (check.signs) return true;
  const days = (Date.parse(today) - Date.parse(check.date)) / 86400000;
  return days < ENERGY_CHECK_DAYS ? false : null;
}

// The saved goals at the athlete's current weight (currentWeightKg): the
// average of the last week's weigh-ins, or the weight given with the goals
// until there are newer ones.
export function liveGoals(
  state: JournalState,
  today: string,
  // The weight to plan with instead, as just given with the goals.
  weightKg?: number,
) {
  const body = goalsForState(state);
  if (!body) return null;
  const now = weightKg ?? currentWeightKg(state, today);
  return now == null
    ? body
    : { ...body, weightKg: Math.min(300, Math.max(30, now)) };
}

// Which way goals head, from the weight given with them: none when that
// was already at the goal (maintainBandKg), and always down to a weight
// class above it. The goals form plans with it too, so its preview says
// what the saved plan will.
export function goalsHeading(
  body: Pick<BodyGoalsInput, "weightKg" | "targetWeightKg">,
  weightClass: boolean,
) {
  const change = body.targetWeightKg - body.weightKg;
  const lose =
    change < 0 && (weightClass || -change >= maintainBandKg(body.weightKg));
  return lose
    ? "lose"
    : change >= maintainBandKg(body.weightKg)
      ? "gain"
      : undefined;
}

// The plan for the saved goals at the current weight (liveGoals), with the
// focus, target, latest body fat and the safety checks given with them. It
// suggests new targets (target-proposals.ts); the saved ones stay until the
// athlete takes them. signs plans with that answer to the low-energy
// questions instead of the one in force, as a suggestion's review shows.
export function planForState(
  state: JournalState,
  today: string,
  weightKg?: number,
  signs?: boolean | null,
) {
  const body = goalsForState(state);
  if (!body) return null;
  const checks = state.profile.goalChecks;
  const weightClass = state.profile.weighIn?.classKg === body.targetWeightKg;
  return planGoals(liveGoals(state, today, weightKg)!, today, {
    focus: state.profile.bodyTargets?.focus,
    targetBodyFatPercent: state.profile.bodyTargets?.targetBodyFatPercent,
    bodyFatPercent: latestBodyFat(state, today)?.percent ?? null,
    pregnancy: checks?.pregnancy ?? null,
    weeksSinceBirth: babyWeeks(state, today),
    limitProtein: Boolean(state.profile.goalHealth?.limitProtein),
    lowWeightConfirmed: checks?.lowWeightConfirmedKg === body.targetWeightKg,
    energySigns: signs === undefined ? energySigns(state, today) : signs,
    weightClass,
    heading: goalsHeading(body, weightClass),
    startKg: body.weightKg,
  });
}

// The athlete's age from the goals, else Settings, where 0 means unknown.
// Both coaches get it: supplement, caffeine and sleep advice depend on it.
export function athleteAge(state: JournalState) {
  return state.profile.body?.age || state.profile.age || null;
}

// The saved goals, with heavy manual work put back (bodyGoalsSchema).
export function goalsForState(
  state: JournalState,
): (BodyGoalsInput & { updatedAt: string }) | null {
  const body = state.profile.body;
  if (!body) return null;
  return state.profile.heavyManualWork && body.activity === "high"
    ? { ...body, activity: "very_high" }
    : body;
}

// Session length and experience as saved with the goals, else from the
// lifting brief, its session length kept within the goals' 15 to 240
// minutes; undefined when neither says.
export function savedTraining(state: JournalState) {
  const body = state.profile.body;
  const brief = state.profile.lifting;
  const minutes = brief?.minutesPerSession;
  return {
    sessionMinutes:
      body?.sessionMinutes ??
      (minutes == null ? undefined : Math.min(240, Math.max(15, minutes))),
    experience:
      body?.experience ??
      (brief && brief.experience !== "unknown" ? brief.experience : undefined),
  };
}

// The note when no session length was given or known.
export const ASSUMED_SESSION =
  "The plan assumes 75-minute sessions; say how long yours usually last to fine-tune it.";

// Saves the goals and the daily targets they imply, recorded as the plan's
// at the weight given (recordTargets). The lifting brief is the
// athlete's own record of the days they have and changes only through its
// own review, so the plan's sessions never overwrite it. Session length and
// experience left out keep what was saved (savedTraining). Body fat stated
// with the goals is recorded as today's reading. Pregnancy, a confirmed low
// goal weight and a limit on protein carry over when not given again, the
// confirmation only while the goal weight stays the same and the baby's
// birth day only while breastfeeding. The birth day is worked out from the
// weeks given only when they differ from the saved age, so saving the
// goals again never moves it. A protein target saved beside a plan that set
// none is the athlete's own, their doctor's or dietitian's figure perhaps,
// and is kept while the plan still sets none. A new answer to the
// low-energy questions is kept with today's date, the same answer while it
// is in force keeps its day (so saving again never stretches a no past
// 3 months), and null removes them. A weight class stays while the goal
// weight is the class, with the target date as its weigh-in. changes names
// a removed kidney answer, a changed baby's age, a no to the low-energy
// questions or a removed weight class, for the review and the voice
// read-back to say first: a model filling every field could change them
// unasked.
export function applyGoals(
  state: JournalState,
  input: BodyGoalsInput | BodyGoalsRequest,
  today: string,
): GoalPlan & { changes: string[] } {
  const split = splitGoals(input);
  const { composition, checks } = split;
  const earlier = planForState(state, today);
  const weeksBefore = babyWeeks(state, today);
  const known = savedTraining(state);
  const assumed =
    split.goals.sessionMinutes == null && known.sessionMinutes == null;
  const goals = bodyGoalsInputSchema.parse({
    ...split.goals,
    sessionMinutes: split.goals.sessionMinutes ?? known.sessionMinutes,
    experience: split.goals.experience ?? known.experience,
  });
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
  const health = state.profile.goalHealth;
  const limitProtein = checks.limitProtein ?? Boolean(health?.limitProtein);
  const weeks = checks.weeksSinceBirth;
  const babyBornOn =
    pregnancy !== "breastfeeding" || weeks === null
      ? undefined
      : weeks === undefined ||
          (health?.babyBornOn && weeksOld(health.babyBornOn, today) === weeks)
        ? health?.babyBornOn
        : new Date(Date.parse(today) - weeks * WEEK_MS)
            .toISOString()
            .slice(0, 10);
  if (limitProtein || babyBornOn)
    state.profile.goalHealth = {
      ...(limitProtein && { limitProtein }),
      ...(babyBornOn && { babyBornOn }),
      updatedAt: stamp,
    };
  else delete state.profile.goalHealth;
  const signsBefore = energySigns(state, today);
  const checkedBefore = state.profile.energyCheck;
  if (checks.energySigns === null) delete state.profile.energyCheck;
  else if (
    checks.energySigns !== undefined &&
    checks.energySigns !== signsBefore
  )
    state.profile.energyCheck = { date: today, signs: checks.energySigns };
  const weighIn = state.profile.weighIn;
  const classKg =
    (checks.weightClass ?? weighIn?.classKg === goals.targetWeightKg)
      ? goals.targetWeightKg
      : null;
  if (classKg != null)
    state.profile.weighIn = {
      classKg,
      date: goals.targetDate,
      updatedAt: stamp,
    };
  else delete state.profile.weighIn;
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
  const { activity, ...rest } = goals;
  state.profile.body = {
    ...rest,
    activity: activity === "very_high" ? "high" : activity,
    updatedAt: stamp,
  };
  if (activity === "very_high") state.profile.heavyManualWork = true;
  else delete state.profile.heavyManualWork;
  // Planned at the weight just given, as the form's preview and Coach's
  // review show it.
  const plan = planForState(state, today, goals.weightKg)!;
  state.profile.age = goals.age;
  state.profile.bodyweight = goals.weightKg;
  const targets = planTargets(plan);
  const own = dailyTarget(state.nutrition.targets.protein);
  const keepsOwn =
    own != null && !plan.proteinTarget && earlier?.proteinTarget === false;
  if (keepsOwn) targets.protein = own;
  recordTargets(state, targets, today, {
    source: "plan",
    weightKg: goals.weightKg,
    leanMassKg: plan.leanMassKg,
    at: stamp,
  });
  if (keepsOwn)
    plan.notes.push(`Your own protein target of ${own} g stays as it is.`);
  if (assumed && plan.sessionsPerWeek > 0) plan.notes.push(ASSUMED_SESSION);
  const weeksAfter = babyWeeks(state, today);
  const topics = screenTopics(goals.sex, "and", pregnancy);
  const changes = [
    health?.limitProtein &&
      !limitProtein &&
      `Removes your answer about kidney disease or a doctor's limit on protein${plan.proteinTarget ? `, so the plan sets ${plan.protein} g of protein a day` : ""}.`,
    weeksBefore != null &&
      pregnancy === "breastfeeding" &&
      weeksAfter !== weeksBefore &&
      (weeksAfter == null
        ? "Removes your baby's age."
        : `Saves your baby's age as ${weeksAfter} week${weeksAfter === 1 ? "" : "s"}, not ${weeksBefore}.`),
    checks.energySigns === false &&
      signsBefore !== false &&
      `Saves that you answered no to the questions on ${topics}.`,
    checks.energySigns === null &&
      checkedBefore &&
      `Removes your answers to the questions on ${topics}.`,
    weighIn &&
      classKg == null &&
      `Removes your weigh-in for the ${weighIn.classKg} kg class.`,
  ].filter((line): line is string => Boolean(line));
  return Object.assign(plan, { changes });
}

export function describePlan(goals: GoalsGiven, plan: GoalPlan) {
  if (!plan.dailyTargets)
    return `No weight goal, and no daily calorie or macro targets, while you're pregnant. ${describeSessions(plan.sessionsPerWeek, "training session")}.`;
  const change =
    plan.direction === "maintain"
      ? plan.focus === "recomposition"
        ? `Recomposition: hold around ${goals.weightKg} kg while losing fat and building muscle`
        : `Hold around ${goals.weightKg} kg`
      : `${plan.direction === "lose" ? "Lose" : "Gain"} about ${plan.weeklyChangeKg} kg a week ${
          // Only a plan that gets there in time promises the class; one
          // that doesn't heads towards it, and its safety note says why.
          plan.makesClass
            ? `to make the ${plan.towardsKg} kg class${goals.targetDate ? ` by the weigh-in on ${goals.targetDate}` : ""}`
            : plan.weightClass &&
                plan.direction === "lose" &&
                plan.towardsKg === goals.targetWeightKg
              ? `towards the ${plan.towardsKg} kg class`
              : `towards ${plan.towardsKg} kg`
        }${plan.weeksToGoal ? ` (about ${plan.weeksToGoal} week${plan.weeksToGoal === 1 ? "" : "s"})` : ""}`;
  const composition =
    plan.leanMassKg != null
      ? ` Based on ${plan.bodyFatPercent}% body fat, about ${plan.leanMassKg} kg lean mass${plan.targetBodyFatPercent != null ? `, towards ${plan.targetBodyFatPercent}%` : ""}.`
      : plan.targetBodyFatPercent != null
        ? ` Towards ${plan.targetBodyFatPercent}% body fat.`
        : "";
  const macros = plan.proteinTarget
    ? `${plan.protein} g protein, ${plan.carbs} g carbs, ${plan.fat} g fat`
    : `${plan.carbs} g carbs and ${plan.fat} g fat, with no protein target`;
  return `${change}. ${plan.calories.toLocaleString("en-GB")} kcal a day: ${macros}. ${describeSessions(plan.sessionsPerWeek, "training session")}.${composition}`;
}

// "4 sessions a week", "1 session a week", or none planned.
export function describeSessions(sessions: number, noun = "session") {
  return sessions === 0
    ? "No lifting days planned"
    : `${sessions} ${noun}${sessions === 1 ? "" : "s"} a week`;
}
