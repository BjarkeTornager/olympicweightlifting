import type { JournalState } from "./model";
import { dailyTarget, type DietTargets } from "./nutrition";
import {
  babyWeeks,
  energyQuestionsFor,
  goalsForState,
  goalsHeading,
  LACTATION_KCAL,
  LACTATION_KCAL_LATER,
  LACTATION_LATER_WEEKS,
  notesAboutAthlete,
  notesForTargets,
  planForState,
  planTargets,
  POSTPARTUM_WEEKS,
  RECOMPOSITION_CUT,
  TARGETS_DIFFER,
  type GoalPlan,
} from "./body-goals";
import { latestBodyFat } from "./body-composition";
import {
  currentWeightKg,
  localDay,
  ownProtein,
  recordTargets,
  sameTargets,
  targetsInForce,
} from "./target-history";

// The saved daily targets are the ones the athlete sees everywhere. The
// plan is worked out again at their current weight and latest body fat
// (planForState), and when it has moved on it suggests new targets for
// them to take or leave; it never changes the saved ones by itself. A
// suggestion is made when, since the targets were set (or since the
// athlete last kept theirs over one), the weight has moved by 2.5 %, a body
// fat reading has moved the lean mass by 2 kg, or the plan's calories or
// any macro's energy by 100 kcal or 5 %; and always once the goal is
// reached or its date has passed, when the plan holds the weight. Targets
// the athlete set themselves get only that last one. Slow loss towards a
// target date is never answered here by cutting further: that is for the
// goals check, which looks at the food logs first and moves calories by
// 200 kcal at most (knowledge.ts).
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
  // When the plan sets a deficit, or aims very lean, without answers to
  // the low-energy questions in force (GoalPlan.energyCheckDue): the
  // questions, which come before the suggestion is taken, and the targets
  // the plan gives instead with a yes, holding the weight, with its notes.
  energyCheck?: {
    questions: string[];
    ifYes: DietTargets;
    ifYesNotes: string[];
  };
};

const fmt = (kcal: number) => kcal.toLocaleString("en-GB");
const targetsOf = (t: DietTargets): DietTargets => ({
  goal: t.goal,
  calories: t.calories,
  protein: t.protein,
  carbs: t.carbs,
  fat: t.fat,
});
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Too close to suggest: the same goal, with the calories and each macro's
// energy within 100 kcal, or 5 % of the calories when that is less.
function nearTargets(a: DietTargets, b: DietTargets) {
  const kcal = dailyTarget(b.calories);
  const step =
    kcal == null ? KCAL_CHANGE : Math.min(KCAL_CHANGE, KCAL_SHARE * kcal);
  const per = { calories: 1, protein: 4, carbs: 4, fat: 9 } as const;
  return (
    a.goal === b.goal &&
    (Object.keys(per) as (keyof typeof per)[]).every((key) => {
      const x = dailyTarget(a[key]);
      const y = dailyTarget(b[key]);
      return x == null || y == null
        ? x === y
        : Math.abs(x - y) * per[key] < step;
    })
  );
}

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

// The targets the plan gives now. When it sets no protein target, the
// athlete's own (their doctor's or dietitian's figure, as its note advises;
// ownProtein) stays, as it does when the goals are saved.
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
  const saved = targetsOf(state.nutrition.targets);
  const record = targetsInForce(state);
  const protein = ownProtein(state, record);
  const targets = proposedTargets(plan, protein);
  if (sameTargets(targets, saved)) return null;
  const weightKg = currentWeightKg(state, today);
  const now = weightKg ?? goals.weightKg;
  const declined = state.profile.declinedTargets;
  // Saved before targets were recorded, by the plan as it was then
  // (targetsInForce): set at the goals' weight, on their day.
  const legacy = !record.recorded && !state.profile.targetHistory?.length;
  const own = record.source === "manual";
  // What the athlete last saw from the plan: the targets as set, or a
  // suggestion they kept theirs over.
  const base = declined
    ? {
        targets: targetsOf(declined),
        weightKg: declined.weightKg,
        leanMassKg: declined.leanMassKg,
        at: declined.at as string | null,
        day: declined.date as string | null,
        since: "you last kept your targets",
      }
    : {
        targets: saved,
        weightKg: record.recorded
          ? record.weightKgAtSet
          : legacy
            ? goals.weightKg
            : null,
        leanMassKg: record.leanMassKgAtSet ?? null,
        at: record.recorded ? record.setAt : legacy ? goals.updatedAt : null,
        day: record.recorded
          ? record.from
          : legacy
            ? localDay(goals.updatedAt, state)
            : null,
        since: "your targets were set",
      };
  const kcal = dailyTarget(targets.calories);
  const days = goals.targetDate
    ? (Date.parse(goals.targetDate) - Date.parse(today)) / 86400000
    : null;
  const passed = days != null && days < 0;
  // A recomposition's small cut, saved as maintain, ends at its target date
  // too (planGoals): saved calories well under maintenance, as the cut's 5 %
  // is.
  const baseKcal = dailyTarget(base.targets.calories);
  const recomposing =
    plan.focus === "recomposition" &&
    baseKcal != null &&
    baseKcal <= plan.maintenanceKcal * (1 - RECOMPOSITION_CUT / 2);
  const maintain =
    targets.goal === "maintain" &&
    (base.targets.goal !== "maintain" || recomposing) &&
    (plan.reachedGoal || passed);
  // Reasons that suggest new targets by themselves: the goal or its date,
  // the weight or the lean mass moving, or the old plan's maintenance.
  // Causes only say why the plan's targets changed, when they changed
  // enough to suggest.
  const reasons: string[] = [];
  const causes: string[] = [];
  let measured = false;
  // At the goal or its date, that is the reason that matters; the targets
  // shown say the rest. The athlete's own targets change only there.
  if (maintain)
    reasons.push(
      plan.reachedGoal
        ? `Your weight is about ${now} kg now: you've reached ${plan.towardsKg === goals.targetWeightKg ? `your goal of ${goals.targetWeightKg} kg` : `the ${plan.towardsKg} kg your goals plan heads for`}.`
        : `Your target date, ${goals.targetDate}, has passed.`,
    );
  else if (own) return null;
  else {
    // Goals to hold a weight the athlete has moved from, beyond day-to-day
    // swings: the plan now loses or gains back to it.
    const drifted =
      !goalsHeading(
        goals,
        state.profile.weighIn?.classKg === goals.targetWeightKg,
      ) && plan.direction !== "maintain";
    const weightMoved =
      base.weightKg != null &&
      weightKg != null &&
      Math.abs(weightKg - base.weightKg) >= WEIGHT_SHARE * base.weightKg;
    if (drifted)
      (weightMoved ? reasons : causes).push(
        `Your weight is about ${now} kg now, ${plan.direction === "lose" ? "above" : "below"} the ${goals.targetWeightKg} kg you aim to hold.`,
      );
    else if (weightMoved)
      reasons.push(
        `Your weight is about ${weightKg} kg now, from ${base.weightKg} kg when ${base.since}.`,
      );
    // A reading since then, and with lean mass known then, one that moves
    // it by 2 kg: the lean mass holds until a new reading (planBodyFat).
    const reading = latestBodyFat(state, today);
    if (
      plan.leanMassKg != null &&
      reading &&
      base.at != null &&
      Date.parse(reading.updatedAt) >= Date.parse(base.at) &&
      (base.leanMassKg == null ||
        Math.abs(plan.leanMassKg - base.leanMassKg) >= LEAN_CHANGE_KG)
    )
      reasons.push(
        `Your body fat reading of ${reading.percent}% on ${reading.date} puts your lean mass at about ${plan.leanMassKg} kg${base.leanMassKg != null ? `, from ${base.leanMassKg} kg` : ""}, and the plan works out your energy and protein from it.`,
      );
    else if (base.leanMassKg != null && plan.leanMassKg == null)
      reasons.push(
        "Your last body fat reading is more than 90 days old, so the plan works from your height and weight instead.",
      );
    measured = reasons.length > 0;
    // While breastfeeding, no deficit until the baby is 6 weeks old.
    const baby = babyWeeks(state, today);
    if (
      baby != null &&
      baby >= POSTPARTUM_WEEKS &&
      plan.direction === "lose" &&
      (base.day == null || (babyWeeks(state, base.day) ?? 0) < POSTPARTUM_WEEKS)
    )
      causes.push(
        `Your baby is now ${plural(baby, "week")} old, so your goals plan can include a gentle loss.`,
      );
    // From 6 months, less energy for making milk (LACTATION_KCAL_LATER).
    if (
      baby != null &&
      baby >= LACTATION_LATER_WEEKS &&
      (base.day == null ||
        (babyWeeks(state, base.day) ?? 0) < LACTATION_LATER_WEEKS)
    )
      causes.push(
        `Your baby is now ${plural(baby, "week")} old, so your goals plan counts about ${LACTATION_KCAL_LATER} kcal a day for making milk rather than ${LACTATION_KCAL}.`,
      );
    // Maintenance as the old plan counted it, for targets it saved; while
    // breastfeeding the allowance for milk, which it left out, would muddle
    // the comparison.
    if (
      legacy &&
      !declined &&
      state.profile.goalChecks?.pregnancy !== "breastfeeding"
    ) {
      const earlier = earlierMaintenance(state, plan, now);
      if (plan.maintenanceKcal - earlier >= KCAL_CHANGE)
        reasons.push(
          `The plan now counts your everyday movement and training more fully, so your maintenance is about ${fmt(plan.maintenanceKcal)} kcal a day rather than ${fmt(earlier)}.`,
        );
    }
    // The plan before records set protein for everyone; now it sets none
    // while breastfeeding, so its protein goes (ownProtein).
    if (
      !plan.proteinTarget &&
      protein == null &&
      dailyTarget(saved.protein) != null
    )
      reasons.push(
        state.profile.goalChecks?.pregnancy === "breastfeeding"
          ? "While you're breastfeeding your goals plan sets no protein target; your midwife, health visitor or a dietitian can advise you on protein."
          : "Your goals plan now sets no protein target.",
      );
  }
  // Slow loss is never answered here by cutting further: unless the
  // weight or lean mass has moved, a deeper cut waits for the goals check.
  const savedKcal = dailyTarget(saved.calories);
  if (
    !measured &&
    saved.goal === "lose" &&
    targets.goal === "lose" &&
    kcal != null &&
    savedKcal != null &&
    kcal < savedKcal
  )
    return null;
  if (!reasons.length) {
    // Only a change big enough to matter, from the targets last seen and
    // from the saved ones, is suggested for its causes alone.
    if (nearTargets(targets, base.targets) || nearTargets(targets, saved))
      return null;
    if (!causes.length && days != null && days >= 0) {
      if (days < 7 && targets.goal === "maintain")
        causes.push(
          `Your target date, ${goals.targetDate}, is less than a week away, so your goals plan holds your weight.`,
        );
      else if (days >= 7 && plan.direction !== "maintain") {
        const left = Math.round(Math.abs(plan.towardsKg - now) * 10) / 10;
        causes.push(
          `You're about ${left} kg from ${plan.towardsKg === goals.targetWeightKg ? "your goal" : `the ${plan.towardsKg} kg your goals plan heads for`}, with about ${plural(Math.round(days / 7), "week")} to go to ${goals.targetDate}, so the plan ${plan.direction === "lose" ? "loses" : "gains"} about ${plan.weeklyChangeKg} kg a week.`,
        );
      }
    }
    reasons.push(
      ...(causes.length
        ? causes
        : [`Your goals plan has moved on since ${base.since}.`]),
    );
  } else reasons.push(...causes);
  // A suggestion kept over before is offered again only once it differs,
  // and not when the targets kept are as good as it.
  if (
    declined &&
    (sameTargets(targets, declined) || nearTargets(targets, saved))
  )
    return null;
  const held = plan.energyCheckDue
    ? planForState(state, today, undefined, true)!
    : null;
  return {
    targets,
    current: saved,
    maintain,
    reasons,
    plan,
    weightKg,
    ...(held && {
      energyCheck: {
        questions: energyQuestionsFor(
          goals.sex,
          state.profile.goalChecks?.pregnancy,
        ),
        ifYes: proposedTargets(held, protein),
        ifYesNotes: held.notes,
      },
    }),
  };
}

// What the review says under the low-energy questions: they are optional,
// what is kept, and what a yes does.
export function energyCheckNote(
  check: NonNullable<TargetsProposal["energyCheck"]>,
) {
  const kcal = dailyTarget(check.ifYes.calories);
  return `Optional, and not a diagnosis. Only a yes or no and the date are kept, so the plan stays safe: with a yes it holds your weight instead${kcal != null ? `, at about ${fmt(kcal)} kcal a day` : ""}, and a sports doctor or sports dietitian can help you look into it.`;
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
// the plan's at the current weight. One that asks the low-energy questions
// first (energyCheck) is taken only with the answer, signs: true for any
// yes, kept with the date, when the plan holds the weight instead
// (energyCheck.ifYes); false for no to all, kept the same way; null when
// the athlete would rather not answer. The goals check follows in the same
// change (takeTargetsProposal in coaching.ts).
export function acceptProposal(
  state: JournalState,
  today: string,
  shown: DietTargets,
  signs?: boolean | null,
) {
  const proposal = shownProposal(state, today, shown);
  let { plan, targets } = proposal;
  if (proposal.energyCheck) {
    if (signs === undefined)
      throw Error(
        "These targets set a deficit, so a few health questions come first. Answer them, or say you'd rather not, to take the targets.",
      );
    if (signs != null) state.profile.energyCheck = { date: today, signs };
    if (signs) {
      plan = planForState(state, today)!;
      targets = proposedTargets(plan, ownProtein(state));
    }
  }
  recordTargets(state, targets, today, {
    source: "plan",
    weightKg: proposal.weightKg,
    leanMassKg: plan.leanMassKg,
  });
  return { ...proposal, plan, targets };
}

// Keeps the saved targets over the plan's suggestion, which isn't made again
// until the plan moves on from it (targetsProposal). An answer given to the
// low-energy questions it asked is kept as when it is taken, so Coach and
// the plan know of a yes: the suggestion kept over is then the one that
// holds the weight (energyCheck.ifYes), which the review showed. The
// answer is optional here, as keeping changes no targets.
export function keepCurrentTargets(
  state: JournalState,
  today: string,
  shown: DietTargets,
  signs?: boolean | null,
) {
  const proposal = shownProposal(state, today, shown);
  const check = proposal.energyCheck;
  if (check && signs != null)
    state.profile.energyCheck = { date: today, signs };
  state.profile.declinedTargets = {
    ...(check && signs ? check.ifYes : proposal.targets),
    date: today,
    at: new Date().toISOString(),
    weightKg: proposal.weightKg,
    leanMassKg: proposal.plan.leanMassKg,
  };
  return { ...proposal, held: Boolean(check && signs) };
}

// Saves targets the athlete sets, on Food or with Coach: the plan's when
// they are what it gives now, otherwise their own. The saved targets given
// back unchanged, as Food's form saves them, stay as they were set.
export function setDailyTargets(
  state: JournalState,
  targets: DietTargets,
  today: string,
) {
  if (sameTargets(targets, state.nutrition.targets)) return;
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
// With the same goal, the plan's notes about the athlete (under 18,
// pregnancy, breastfeeding, a limit on protein) follow any of those lines,
// as their advice holds whatever the targets. The iPhone shows these notes
// in every build, and builds from before suggestions show no suggestion on
// Today, so the line says to update the app if it isn't there.
export function targetNotes(
  state: JournalState,
  today: string,
  proposal = targetsProposal(state, today),
) {
  const plan = proposal?.plan ?? planForState(state, today);
  if (!plan) return [];
  const saved = state.nutrition.targets;
  if (proposal) {
    const kcal = dailyTarget(proposal.targets.calories);
    return [
      `Your goals plan suggests new daily targets${kcal != null ? `, about ${fmt(kcal)} kcal a day` : ""}: take them, or keep yours, on Today. If you don't see them there, update the app.`,
      ...notesAboutAthlete(plan, saved),
    ];
  }
  const notes = notesForTargets(plan, saved);
  return notes[0] === TARGETS_DIFFER &&
    targetsInForce(state).source === "manual" &&
    plan.dailyTargets
    ? [
        `These are your own daily targets; your goals plan's estimate is about ${fmt(plan.calories)} kcal a day.`,
        ...notesAboutAthlete(plan, saved),
      ]
    : notes;
}
