import type { JournalState } from "./model";
import { dailyTarget, type DietTargets } from "./nutrition";
import {
  goalsForState,
  notesForTargets,
  planForState,
  planTargets,
  TARGETS_DIFFER,
  type GoalPlan,
} from "./body-goals";
import { latestBodyFat } from "./body-composition";
import {
  currentWeightKg,
  recordTargets,
  sameTargets,
  targetsInForce,
} from "./target-history";

// The saved daily targets are the ones the athlete sees everywhere. The plan
// is worked out again at their current weight and latest body fat
// (planForState), and when it has moved on it suggests new targets for
// them to take or leave; it never changes the saved ones by itself. A
// suggestion is made when, since the targets were set (or since the
// athlete last kept theirs over one), the plan's calories have moved by
// 100 kcal or 5 %, the weight by 2.5 %, or a body fat reading has moved
// the lean mass by 2 kg; and always once the goal is reached or its date
// has passed, when the plan holds the weight. Targets the athlete set
// themselves get only that last one.
const KCAL_CHANGE = 100;
const KCAL_SHARE = 0.05;
const WEIGHT_SHARE = 0.025;
const LEAN_CHANGE_KG = 2;

export type TargetsProposal = {
  targets: DietTargets;
  // The saved targets it would replace.
  current: DietTargets;
  // The plan now holds the weight: the goal is reached or its date passed.
  maintain: boolean;
  // Why, in plain words, first the reason that matters most.
  reasons: string[];
  plan: GoalPlan;
  // The current weight the plan used.
  weightKg: number | null;
};

const fmt = (kcal: number) => kcal.toLocaleString("en-GB");
const targetsOf = (t: DietTargets): DietTargets => ({
  goal: t.goal,
  calories: t.calories,
  protein: t.protein,
  carbs: t.carbs,
  fat: t.fat,
});

// "2,450 kcal, 175 g protein, 300 g carbs and 75 g fat a day, to lose
// weight".
export function describeTargets(t: DietTargets) {
  const parts = [
    ["calories", "kcal"],
    ["protein", "g protein"],
    ["carbs", "g carbs"],
    ["fat", "g fat"],
  ].flatMap(([key, unit]) => {
    const value = dailyTarget(t[key as keyof Omit<DietTargets, "goal">]);
    return value == null ? [] : [`${fmt(value)} ${unit}`];
  });
  const goal = {
    maintain: "to hold your weight",
    lose: "to lose weight",
    gain: "to gain weight",
  }[t.goal];
  return parts.length
    ? `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} a day, ${goal}`
    : `no daily targets, ${goal}`;
}

// The targets the plan gives now. When it sets no protein target, a saved
// one is the athlete's own (their doctor's or dietitian's figure, as its
// note advises), and stays, as it does when the goals are saved.
export function proposedTargets(
  plan: GoalPlan,
  protein: number | null,
): DietTargets {
  const next = planTargets(plan);
  const own = dailyTarget(protein);
  if (plan.dailyTargets && !plan.proteinTarget && own != null)
    next.protein = own;
  return next;
}

// Maintenance as the plan counted it until 4 October 2026, for targets it
// saved then: resting energy times 1.2, 1.375 or 1.55, plus about 4.5 METs
// for every day available to train.
function earlierMaintenance(state: JournalState, plan: GoalPlan, kg: number) {
  const goals = goalsForState(state)!;
  const factor = { low: 1.2, moderate: 1.375, high: 1.55, very_high: 1.55 }[
    goals.activity
  ];
  const training = (goals.trainingDays * goals.sessionMinutes * 0.075 * kg) / 7;
  return Math.round((plan.restingKcal * factor + training) / 10) * 10;
}

export function targetsProposal(
  state: JournalState,
  today: string,
): TargetsProposal | null {
  const goals = goalsForState(state);
  const plan = planForState(state, today);
  // In pregnancy the plan sets no daily targets, and the goals saved then
  // saved none, so there is nothing to suggest.
  if (!goals || !plan?.dailyTargets) return null;
  const saved = state.nutrition.targets;
  const targets = proposedTargets(plan, saved.protein);
  if (sameTargets(targets, saved)) return null;
  const weightKg = currentWeightKg(state, today);
  const record = targetsInForce(state);
  const declined = state.profile.declinedTargets;
  // Saved before targets were recorded: by the plan as it was then, as a
  // rule, with the goals. Saved since without a record, by an older
  // version of the app, they count as the athlete's own, as most likely.
  const legacy = !record.recorded && !state.profile.targetHistory?.length;
  const own = record.source === "manual" || (!record.recorded && !legacy);
  // What the athlete last saw from the plan: the targets as set, or a
  // suggestion they kept theirs over.
  const base = declined
    ? {
        goal: declined.goal,
        calories: dailyTarget(declined.calories),
        weightKg: declined.weightKg,
        leanMassKg: declined.leanMassKg,
        at: declined.at as string | null,
        since: "you last kept your targets",
      }
    : {
        goal: saved.goal,
        calories: dailyTarget(saved.calories),
        weightKg: record.recorded
          ? record.weightKgAtSet
          : legacy
            ? goals.weightKg
            : null,
        leanMassKg: record.leanMassKgAtSet ?? null,
        at: record.recorded ? record.setAt : legacy ? goals.updatedAt : null,
        since: "your targets were set",
      };
  const reasons: string[] = [];
  const kcal = dailyTarget(targets.calories);
  const passed = goals.targetDate != null && goals.targetDate < today;
  const maintain =
    targets.goal === "maintain" &&
    base.goal !== "maintain" &&
    (plan.reachedGoal || passed);
  // At the goal or its date, that is the reason that matters; the targets
  // shown say the rest. The athlete's own targets change only there.
  if (maintain)
    reasons.push(
      plan.reachedGoal
        ? `Your weight is about ${weightKg ?? goals.weightKg} kg now: you've reached ${plan.towardsKg === goals.targetWeightKg ? `your goal of ${goals.targetWeightKg} kg` : `the ${plan.towardsKg} kg your goals plan heads for`}.`
        : `Your target date, ${goals.targetDate}, has passed.`,
    );
  else if (own) return null;
  else {
    if (
      base.weightKg != null &&
      weightKg != null &&
      Math.abs(weightKg - base.weightKg) >= WEIGHT_SHARE * base.weightKg
    )
      reasons.push(
        `Your weight is about ${weightKg} kg now, from ${base.weightKg} kg when ${base.since}.`,
      );
    const reading = latestBodyFat(state, today);
    if (
      plan.leanMassKg != null &&
      reading &&
      (base.leanMassKg != null
        ? Math.abs(plan.leanMassKg - base.leanMassKg) >= LEAN_CHANGE_KG
        : base.at != null &&
          Date.parse(reading.updatedAt) >= Date.parse(base.at))
    )
      reasons.push(
        `Your body fat reading of ${reading.percent}% on ${reading.date} puts your lean mass at about ${plan.leanMassKg} kg${base.leanMassKg != null ? `, from ${base.leanMassKg} kg` : ""}, and the plan works out your energy and protein from it.`,
      );
    else if (base.leanMassKg != null && plan.leanMassKg == null)
      reasons.push(
        "Your last body fat reading is more than 90 days old, so the plan works from your height and weight instead.",
      );
    // Maintenance as the old plan counted it, for targets it saved; while
    // breastfeeding the allowance for milk, which it left out, would muddle
    // the comparison.
    if (
      legacy &&
      !declined &&
      state.profile.goalChecks?.pregnancy !== "breastfeeding"
    ) {
      const earlier = earlierMaintenance(
        state,
        plan,
        weightKg ?? goals.weightKg,
      );
      if (plan.maintenanceKcal - earlier >= KCAL_CHANGE)
        reasons.push(
          `The plan now counts your everyday movement and training more fully, so your maintenance is about ${fmt(plan.maintenanceKcal)} kcal a day rather than ${fmt(earlier)}.`,
        );
    }
  }
  const moved =
    targets.goal !== base.goal ||
    (kcal == null) !== (base.calories == null) ||
    (kcal != null &&
      base.calories != null &&
      Math.abs(kcal - base.calories) >=
        Math.min(KCAL_CHANGE, KCAL_SHARE * base.calories));
  if (!reasons.length) {
    if (!moved) return null;
    reasons.push(`Your goals plan has moved on since ${base.since}.`);
  }
  // A suggestion kept over before is offered again only once it differs.
  if (declined && sameTargets(targets, declined)) return null;
  return {
    targets,
    current: targetsOf(saved),
    maintain,
    reasons,
    plan,
    weightKg,
  };
}

// Throws unless the suggestion shown is the one the plan makes now, so
// nothing is saved that the athlete didn't see.
function shownProposal(state: JournalState, today: string, shown: DietTargets) {
  const proposal = targetsProposal(state, today);
  if (!proposal || !sameTargets(proposal.targets, shown))
    throw Error(
      "Your goals plan has changed since these targets were suggested. Look at its latest suggestion.",
    );
  return proposal;
}

// Takes the plan's suggestion: it becomes the saved targets, recorded as
// the plan's at the current weight. The goals check follows in the same
// change (takeTargetsProposal in coaching.ts).
export function acceptProposal(
  state: JournalState,
  today: string,
  shown: DietTargets,
) {
  const proposal = shownProposal(state, today, shown);
  recordTargets(state, proposal.targets, today, {
    source: "plan",
    weightKg: proposal.weightKg,
    leanMassKg: proposal.plan.leanMassKg,
  });
  return proposal;
}

// Keeps the saved targets over the plan's suggestion, which isn't made again
// until the plan moves on from it (targetsProposal).
export function keepCurrentTargets(
  state: JournalState,
  today: string,
  shown: DietTargets,
) {
  const proposal = shownProposal(state, today, shown);
  state.profile.declinedTargets = {
    ...proposal.targets,
    date: today,
    at: new Date().toISOString(),
    weightKg: proposal.weightKg,
    leanMassKg: proposal.plan.leanMassKg,
  };
  return proposal;
}

// Saves targets the athlete sets, on Food or with Coach: the plan's when
// they are what it gives now, otherwise their own.
export function setDailyTargets(
  state: JournalState,
  targets: DietTargets,
  today: string,
) {
  const plan = planForState(state, today);
  const own =
    !plan || !sameTargets(targets, proposedTargets(plan, targets.protein));
  recordTargets(state, targets, today, {
    source: own ? "manual" : "plan",
    weightKg: currentWeightKg(state, today),
    leanMassKg: plan?.leanMassKg,
  });
}

// What is said beside the saved targets: the plan's notes when they are the
// plan's, a line saying the plan suggests new ones, or that they are the
// athlete's own, with the plan's estimate; otherwise that they differ.
export function targetNotes(
  state: JournalState,
  today: string,
  proposal = targetsProposal(state, today),
) {
  const plan = proposal?.plan ?? planForState(state, today);
  if (!plan) return [];
  if (proposal) {
    const kcal = dailyTarget(proposal.targets.calories);
    return [
      `Your goals plan suggests new daily targets${kcal != null ? `, about ${fmt(kcal)} kcal a day` : ""}. Look at them on Today.`,
    ];
  }
  const notes = notesForTargets(plan, state.nutrition.targets);
  return notes[0] === TARGETS_DIFFER &&
    targetsInForce(state).source === "manual" &&
    plan.dailyTargets
    ? [
        `These are your own daily targets; your goals plan's estimate is about ${fmt(plan.calories)} kcal a day.`,
      ]
    : notes;
}
