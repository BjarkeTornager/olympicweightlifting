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
    goals,
    composition: { focus, bodyFatPercent, targetBodyFatPercent },
    checks: { pregnancy, confirmLowWeight },
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
const LACTATION_KCAL = 500;

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
  sessionsPerWeek: number;
  notes: string[];
};

const round = (value: number, step = 1) => Math.round(value / step) * step;
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
  const minor = g.age < 18;
  const pregnancy = composition.pregnancy ?? null;
  const pregnant = pregnancy === "pregnant";
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
  const maintenance =
    resting * Math.max(everydayActivity[g.activity], LOWEST_ACTIVITY) +
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
  // lean for a teenager (under about 7 % for boys, 14 % for girls, and the
  // girls' level without a stated sex).
  const tooLeanForTeen =
    minor &&
    reading != null &&
    wanted === "lose" &&
    100 * (1 - (g.weightKg * (1 - reading / 100)) / g.targetWeightKg) <
      (g.sex === "male" ? 7 : 14);

  const remaining = towards - g.weightKg;
  // In pregnancy the plan sets no weight goal: gaining is a healthy part of
  // it.
  let direction: GoalPlan["direction"] =
    pregnant || Math.abs(remaining) < 0.5
      ? "maintain"
      : remaining < 0
        ? "lose"
        : "gain";
  // A target date less than a week away, or past, is too close to plan a
  // change, a recomposition's small cut included: the plan holds the
  // athlete's weight.
  const days = g.targetDate
    ? (Date.parse(g.targetDate) - Date.parse(today)) / 86400000
    : null;
  let held = false;
  if (
    (direction !== "maintain" || focus === "recomposition") &&
    !pregnant &&
    days != null &&
    days < 7
  ) {
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
    !pregnant &&
    (direction === "lose" ||
      (focus === "recomposition" && direction === "maintain" && !held));
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
  if (pregnant) {
    notes.push(
      "In pregnancy the plan sets no weight goal and no daily calorie, protein or body fat targets: gaining weight is a normal, healthy part of pregnancy, and energy needs rise as it goes on, mostly in the second and third trimesters. Your midwife or doctor can advise you on eating and training.",
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
    if (bmiGoal < 18.5 && !pregnant) notes.push(underweightGoal);
  } else if (!pregnant) {
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

  // Protein on lean mass when body fat is known, else on bodyweight, to
  // 5 g (proteinPerKg). At a BMI of 30 or more without body fat it is
  // 1.6 g/kg of bodyweight, kept to at least the amount per kg of the
  // adjusted weight and at most 2.0 g/kg of it (so 2.0 g/kg of it while
  // losing).
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
    adjusted
      ? Math.min(
          Math.max(MODEST_PROTEIN_PER_KG * g.weightKg, proteinFor),
          basisKg * proteinPerKg.adjusted.losing,
        )
      : proteinFor,
    5,
  );
  // Macros from the calories as shown, to 5 g, so they add up to them
  // within the carbohydrate's rounding (10 kcal). Fat is a quarter of
  // energy and carbohydrate the rest. Short of 130 g of carbohydrate, fat
  // goes down to a fifth of energy (not under 18), then protein to 1.6 g/kg
  // of the weight it is set from, then calories up towards maintenance;
  // the note says which.
  let kcal = round(calories, 10);
  const leastFat = minor ? macroShares.leastFatUnder18 : macroShares.leastFat;
  const fatAt = (share: number) => upTo5((kcal * share) / 900);
  let fat = fatAt(macroShares.fat);
  const carbsLeft = () => (kcal - protein * 4 - fat * 9) / 4;
  const usualFat = fat;
  const usualProtein = protein;
  if (carbsLeft() < CARBS_FLOOR_G)
    fat = Math.max(
      fatAt(leastFat),
      fat - upTo5(((CARBS_FLOOR_G - carbsLeft()) * 4) / 9),
    );
  if (carbsLeft() < CARBS_FLOOR_G)
    protein = Math.max(
      Math.min(protein, upTo5(MODEST_PROTEIN_PER_KG * basisKg)),
      protein - upTo5(CARBS_FLOOR_G - carbsLeft()),
    );
  const atMaintenance = round(maintenance, 10);
  let raised = false;
  while (carbsLeft() < CARBS_FLOOR_G && kcal < atMaintenance) {
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
  // Once carbohydrate sets the calories, its own note says so instead.
  else if (limited === "floor" && !raised)
    notes.push(
      `Calories are kept at a level that covers your resting energy and training, so the plan loses more slowly: about ${weeklyChangeKg} kg a week.`,
    );
  else if (limited === "cap" && !raised)
    notes.push(
      `The deficit is kept to ${cap.toLocaleString("en-GB")} kcal a day to protect training and muscle, so the plan loses about ${weeklyChangeKg} kg a week.`,
    );
  const room = [
    fat < usualFat &&
      `fat is about ${Math.round((fat * 900) / kcal)}% of calories rather than a quarter`,
    protein < usualProtein && "protein is a little lower",
    raised &&
      (heldForCarbs
        ? "the plan holds your weight at maintenance"
        : direction === "lose"
          ? `the plan loses more slowly: about ${weeklyChangeKg} kg a week`
          : "calories are a little higher"),
  ].filter((part): part is string => Boolean(part));
  if (room.length)
    notes.push(
      `To keep ${CARBS_FLOOR_G} g of carbohydrate a day, the generally recommended minimum, ${room.length > 1 ? `${room.slice(0, -1).join(", ")} and ${room.at(-1)}` : room[0]}.`,
    );
  if (direction !== "maintain" && needed != null && needed - rate > 0.005)
    notes.push(
      `Reaching ${towards} kg by ${g.targetDate} would need ${needed.toFixed(2)} kg a week; this plan keeps to a sustainable ${rate.toFixed(2)} kg.`,
    );
  // A reading would give protein from lean mass instead; not asked for
  // under 18, when readings aren't used, nor in pregnancy, with no protein
  // target.
  if (adjusted && !minor && !pregnant)
    notes.push(
      "Protein is an estimate from your height and weight; add a body fat reading for a better number.",
    );
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
  if (trainingKcal > TRAINING_KCAL_CAP)
    notes.push(
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
    sessionsPerWeek,
    notes,
  };
}

// The daily targets the plan saves; in pregnancy none, so every surface
// reads "No daily target".
export function planTargets(plan: GoalPlan): z.infer<typeof dietTargetsSchema> {
  const set = plan.dailyTargets;
  return {
    goal: plan.direction,
    calories: set ? plan.calories : null,
    protein: set ? plan.protein : null,
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
// reading moves the plan by a few. Otherwise one line says they differ, so
// a note never contradicts the target shown beside it.
export function notesForTargets(
  plan: GoalPlan,
  targets: z.infer<typeof dietTargetsSchema>,
) {
  const planned = planTargets(plan).calories;
  const saved = dailyTarget(targets.calories);
  const close =
    planned == null || saved == null
      ? planned === saved
      : Math.abs(planned - saved) <= 100;
  return plan.direction === targets.goal && close
    ? plan.notes
    : [TARGETS_DIFFER];
}

// The plan for the saved goals, with the focus, target, latest body fat and
// the safety checks given with them.
export function planForState(state: JournalState, today: string) {
  const body = goalsForState(state);
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

// Saves the goals and the daily targets they imply. The lifting brief is the
// athlete's own record of the days they have and changes only through its
// own review, so the plan's sessions never overwrite it. Session length and
// experience left out keep what was saved (savedTraining). Body fat stated
// with the goals is recorded as today's reading. Pregnancy and a confirmed
// low goal weight carry over when not given again, the confirmation only
// while the goal weight stays the same.
export function applyGoals(
  state: JournalState,
  input: BodyGoalsInput | BodyGoalsRequest,
  today: string,
) {
  const split = splitGoals(input);
  const { composition, checks } = split;
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
  const plan = planForState(state, today)!;
  state.profile.age = goals.age;
  state.profile.bodyweight = goals.weightKg;
  state.nutrition.targets = planTargets(plan);
  if (assumed && plan.sessionsPerWeek > 0) plan.notes.push(ASSUMED_SESSION);
  return plan;
}

export function describePlan(goals: GoalsGiven, plan: GoalPlan) {
  if (!plan.dailyTargets)
    return `No weight goal, and no daily calorie or macro targets, while you're pregnant. ${describeSessions(plan.sessionsPerWeek, "training session")}.`;
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
