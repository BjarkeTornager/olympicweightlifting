import type { JournalState } from "./model";
import {
  athleteAge,
  babyWeeks,
  goalsForState,
  planForState,
  POSTPARTUM_WEEKS,
} from "./body-goals";
import {
  aboutStable,
  daysBefore,
  fitPeriod,
  steadyWeighIns,
  trendFit,
  weighIns,
  weightTrend,
  type WeightFit,
} from "./body-composition";
import { currentWeightKg, localDay, targetsInForce } from "./target-history";

// What the weight trend (weightTrend) means beside the goals plan and for
// health, shown with the weight on Today and Body and given to Coach. The
// thresholds are design choices anchored to the sports position stands:
// loss above about 1 % of bodyweight a week risks muscle, training and low
// energy availability. They sit beside asking how the athlete feels, never
// in place of it.

const round1 = (n: number) => Math.round(n * 10) / 10;
const shown = (n: number) => String(round1(n));

export type PlanTrend = {
  state: "on_track" | "slower" | "faster";
  // The trend since the targets were set, and the plan's change, kg a week
  // (a loss negative).
  kg_per_week: number;
  planned_kg_per_week: number;
  text: string;
};

// The weight trend against the goals plan, once the plan's targets have
// been in force for 3 weeks (4 for women and anyone who'd rather not give
// their sex, as the menstrual cycle moves weight by a kilo or more): on
// track, slower or faster. Only for targets the plan set, that lose or gain
// as the plan does, and from the weigh-ins since they were set, with enough
// for a trend. On track within a quarter of the plan's rate, 0.1 kg a week,
// or twice the trend's standard error, whichever is most, so a few noisy
// weigh-ins never read as off. Any change goes through the goals check, a
// reviewed proposal; this only describes.
export function trendAgainstPlan(
  state: JournalState,
  date: string,
): PlanTrend | null {
  const goals = goalsForState(state);
  const plan = planForState(state, date);
  if (!goals || !plan?.dailyTargets || plan.direction === "maintain")
    return null;
  const set = targetsInForce(state);
  if (set.source !== "plan" || set.goal !== plan.direction) return null;
  // Targets saved before records were kept count from the goals' day.
  const since = set.from ?? localDay(goals.updatedAt, state);
  const weeks = goals.sex === "male" ? 3 : 4;
  if (daysBefore(date, weeks * 7) < since) return null;
  const start = [since, daysBefore(date, 28)].sort().at(-1)!;
  const fit = trendFit(steadyWeighIns(weighIns(state, start, date)));
  if (!fit) return null;
  const planned = plan.weeklyChangeKg;
  const sign = plan.direction === "lose" ? -1 : 1;
  const progress = sign * fit.kgPerWeek;
  const tolerance = Math.max(0.1, planned / 4, 2 * fit.seKgPerWeek);
  const state_: PlanTrend["state"] =
    progress > planned + tolerance
      ? "faster"
      : progress < planned - tolerance
        ? "slower"
        : "on_track";
  const rate = `your goals plan, which ${plan.direction === "lose" ? "loses" : "gains"} about ${shown(planned)} kg a week`;
  return {
    state: state_,
    kg_per_week: round1(fit.kgPerWeek),
    planned_kg_per_week: round1(sign * planned),
    text:
      state_ === "on_track"
        ? `On track with ${rate}.`
        : `${state_ === "slower" ? "Slower" : "Faster"} than ${rate}.`,
  };
}

export type WeightAlert = {
  // red: see someone soon; amber: worth a look.
  level: "amber" | "red";
  kind: "fast_loss" | "low_weight";
  text: string;
};

// A fast loss, or a weight below the healthy range still coming down:
// - red, a loss above 1.5 % of bodyweight a week over the last 2 weeks
//   (4 weigh-ins over at least 10 days);
// - amber, above 1 % a week over the last 3 weeks (4 over at least 14
//   days);
// - a BMI under 18.5 with a falling 4-week trend, red under 17.5 for
//   adults; never in pregnancy, when BMI doesn't apply. Under 18 the adult
//   line is only a prompt to check, as BMI-for-age differs, so it stays
//   amber and says "on the low side" rather than below the healthy range.
// A loss must be one the weigh-ins can tell from no change (aboutStable),
// and above the limit as the note shows it, to 0.1 %. None for the fast loss
// while breastfeeding a baby under 6 weeks old, as weight comes off quickly
// after a birth; with the baby's age not given, as the goals plan sets no
// deficit then, until 6 weeks after she last said she was breastfeeding,
// as the baby was born by then. The most serious one, if any: red before
// amber, and at amber a low weight before a fast loss. Each names who can
// help: the midwife in pregnancy and while breastfeeding, and a parent
// under 18.
export function weightAlert(
  state: JournalState,
  date: string,
): WeightAlert | null {
  const checks = state.profile.goalChecks;
  const pregnancy = checks?.pregnancy ?? null;
  const age = athleteAge(state);
  const minor = age != null && age < 18;
  const baby = babyWeeks(state, date);
  const afterBirth =
    checks?.pregnancy === "breastfeeding" &&
    (baby != null
      ? baby < POSTPARTUM_WEEKS
      : daysBefore(date, POSTPARTUM_WEEKS * 7) <
        localDay(checks.updatedAt, state));
  const who = (level: WeightAlert["level"]) =>
    pregnancy === "pregnant"
      ? "your midwife or doctor"
      : pregnancy === "breastfeeding"
        ? "your midwife, health visitor or doctor"
        : minor
          ? "a parent and a doctor"
          : level === "red"
            ? "a doctor"
            : "a doctor or sports dietitian";
  // The loss a week as a percentage of the trend weight, to 0.1, with its
  // fit, when the weigh-ins over the last days show a real loss above the
  // limit.
  const loss = (days: number, minDays: number, limit: number) => {
    const fit = trendFit(
      steadyWeighIns(weighIns(state, daysBefore(date, days), date)),
      minDays,
    );
    if (!fit || aboutStable(fit) || fit.kgPerWeek >= 0) return null;
    const percent = round1((-100 * fit.kgPerWeek) / fit.trendKg);
    return percent > limit ? { percent, fit } : null;
  };
  const fast = (
    level: WeightAlert["level"],
    { percent, fit }: { percent: number; fit: WeightFit },
  ): WeightAlert => {
    const over = fitPeriod(fit, date);
    return {
      level,
      kind: "fast_loss",
      text:
        pregnancy === "pregnant"
          ? `Your weight has come down by about ${percent}% of your bodyweight a week ${over}. In pregnancy that's worth telling ${who(level)} about${level === "red" ? " soon" : ""}.`
          : level === "red"
            ? `Your weight has come down quickly, about ${percent}% of your bodyweight a week ${over}. Losing this fast is hard on your health and training, so please check in with ${who(level)} soon, especially if you feel unwell or aren't trying to lose weight.`
            : `Your weight has come down by about ${percent}% of your bodyweight a week ${over}, faster than the 1% a week usually advised. If that's more than you meant, eating a little more can ease it, and if you feel tired, low or unwell, ${who(level)} can help.`,
    };
  };
  const red = afterBirth ? null : loss(14, 10, 1.5);
  if (red) return fast("red", red);
  // Below the healthy range for the athlete's height, and still falling.
  const goals = goalsForState(state);
  const trend = weightTrend(state, date);
  const kg = currentWeightKg(state, date);
  const bmi =
    goals && kg != null && pregnancy !== "pregnant"
      ? kg / (goals.heightCm / 100) ** 2
      : null;
  if (bmi != null && bmi < 18.5 && trend?.status === "losing") {
    const well = bmi < 17.5 && !minor;
    const level = well ? "red" : "amber";
    return {
      level,
      kind: "low_weight",
      text: minor
        ? `Your weight is on the low side for your height and age and still coming down. Please talk to ${who(level)} about it.`
        : `Your weight is ${well ? "well " : ""}below the healthy range for your height and still coming down. Please talk to ${who(level)} about it${well ? " soon" : ""}.`,
    };
  }
  const amber = afterBirth ? null : loss(21, 14, 1);
  return amber ? fast("amber", amber) : null;
}

// This week's average weight against last week's: the 7 days to the date
// and the 7 before, each from at least 3 weigh-ins, as two weigh-ins a
// week apart say little. To 0.1 kg.
export function weekAverages(state: JournalState, date: string) {
  const weights = steadyWeighIns(weighIns(state, daysBefore(date, 13), date));
  const cut = daysBefore(date, 6);
  const week = weights.filter((w) => w.date >= cut);
  const before = weights.filter((w) => w.date < cut);
  if (week.length < 3 || before.length < 3) return null;
  const mean = (list: typeof weights) =>
    list.reduce((sum, w) => sum + w.kg, 0) / list.length;
  return {
    kg: round1(mean(week)),
    previousKg: round1(mean(before)),
    changeKg: round1(mean(week) - mean(before)),
  };
}
