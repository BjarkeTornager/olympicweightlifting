import {
  athleteAge,
  ENERGY_CHECK_DAYS,
  energySigns,
  goalsForState,
  planForState,
  type GoalPlan,
} from "./body-goals";
import { bodyFatTrend, latestBodyFat, weightTrend } from "./body-composition";
import { z } from "zod";
import type { JournalState } from "./model";
import { formatSleepDuration, offsetDate } from "./health";
import { shortSleep, sleepChange, sleepShortOpening } from "./sleep";
import { dailyTarget, foodDate, type DietTargets } from "./nutrition";
import { cardioTitle } from "./cardio";
import { currentWeightKg, targetsInForce } from "./target-history";
import { acceptProposal, targetsProposal } from "./target-proposals";
import { trendAgainstPlan, weightAlert } from "./weight-trend";

export const memoryInputSchema = z
  .object({
    category: z.enum([
      "preference",
      "routine",
      "food",
      "equipment",
      "boundary",
      "other",
    ]),
    text: z.string().trim().min(1).max(500),
  })
  .strict();
export const memorySchema = memoryInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const planInputSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    notes: z.string().max(500),
    followUpDate: foodDate,
    status: z.enum(["active", "completed", "dismissed"]),
    outcome: z.string().max(500),
  })
  .strict();
export const coachPlanSchema = planInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CoachMemory = z.infer<typeof memorySchema>;
export type CoachPlan = z.infer<typeof coachPlanSchema>;

// Optional at the profile boundary: older journals retain their exact shape.
export const coachingSchema = z
  .object({
    initiative: z.enum(["gentle", "on-request"]),
    focus: z.string().trim().max(300),
    memories: z.array(memorySchema).max(40).optional(),
    plans: z.array(coachPlanSchema).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["memories", "plans"] as const) {
      const records = value[key] ?? [];
      if (new Set(records.map((r) => r.id)).size !== records.length)
        ctx.addIssue({ code: "custom", message: `Duplicate ${key} IDs` });
    }
    if ((value.plans ?? []).filter((p) => p.status === "active").length > 10)
      ctx.addIssue({
        code: "custom",
        message:
          "Keep at most ten active plans. Complete or dismiss an older plan first.",
      });
  });

export function coachSettings(state: JournalState) {
  return (state.profile.coaching ??= { initiative: "gentle", focus: "" });
}
export function duePlans(state: JournalState, date: string) {
  return (state.profile.coaching?.plans ?? [])
    .filter((p) => p.status === "active" && p.followUpDate <= date)
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
}

// The check agreed with a goals plan that loses, gains or recomposes
// (followUpGoals): about 3 weeks on, the weight trend against the plan, as
// its calories are only a starting estimate. Any change from it is a
// reviewed proposal; the saved targets never change by themselves.
export const GOALS_FOLLOW_UP_TITLE =
  "Check my weight trend against my goals plan";
export const GOALS_FOLLOW_UP_DAYS = 21;

// Whether a goals plan changes the athlete's weight or body, so its
// calories are worth checking against the weight trend: not in pregnancy,
// when it sets no daily targets, nor when it holds their weight at
// maintenance, after a yes to the low-energy questions, for safety or as
// asked.
export function goalsPlanChanges(plan: GoalPlan) {
  return (
    plan.dailyTargets &&
    !(plan.direction === "maintain" && plan.calories >= plan.maintenanceKcal)
  );
}
// The goals check agreed and not yet done, if any.
export const activeGoalsCheck = (state: JournalState) =>
  state.profile.coaching?.plans?.find(
    (p) => p.status === "active" && p.title === GOALS_FOLLOW_UP_TITLE,
  );
// The day a goals check agreed today falls due, or null when the plan
// changes nothing, or beside ten active plans (or a hundred in all), the
// most the profile keeps; an active check is always moved on.
export function goalsCheckDate(
  state: JournalState,
  plan: GoalPlan,
  today: string,
) {
  if (!goalsPlanChanges(plan)) return null;
  const plans = state.profile.coaching?.plans ?? [];
  if (
    !activeGoalsCheck(state) &&
    (plans.filter((p) => p.status === "active").length >= 10 ||
      plans.length >= 100)
  )
    return null;
  return offsetDate(today, GOALS_FOLLOW_UP_DAYS);
}
// What the goals' review and form say about the check.
export const goalsCheckNote = (date: string) =>
  `These numbers are a starting estimate: from ${date}, about 3 weeks on, Coach can check them against your weight trend with you.`;
export const goalsCheckClosedNote = (date: string) =>
  `The check of your weight trend agreed for ${date} is closed, as this plan has no calorie change to check.`;

// Agrees the goals check in the same change as the goals, on every surface
// that saves them (Coach, voice and the goals form): saving them again
// moves an active check on rather than adding another. A plan that no
// longer changes the athlete's weight (in pregnancy, after a yes to the
// low-energy questions, or holding it) closes an active check instead, so
// Coach never comes back to a weight trend there.
export function followUpGoals(
  state: JournalState,
  plan: GoalPlan,
  today: string,
): { agreed?: CoachPlan; closed?: CoachPlan } {
  const existing = activeGoalsCheck(state);
  const now = new Date().toISOString();
  if (!goalsPlanChanges(plan)) {
    if (!existing) return {};
    const closed: CoachPlan = {
      ...existing,
      status: "dismissed",
      outcome: `Closed on ${today}: the goals saved then have no calorie change to check.`,
      updatedAt: now,
    };
    const coaching = coachSettings(state);
    coaching.plans = (coaching.plans ?? []).map((p) =>
      p.id === closed.id ? closed : p,
    );
    return { closed };
  }
  const followUpDate = goalsCheckDate(state, plan, today);
  if (!followUpDate) return {};
  const change =
    plan.direction === "maintain"
      ? "recomposition at a steady weight"
      : `${plan.direction === "lose" ? "losing" : "gaining"} about ${plan.weeklyChangeKg} kg a week`;
  const agreed: CoachPlan = {
    id: existing?.id ?? crypto.randomUUID(),
    title: GOALS_FOLLOW_UP_TITLE,
    notes: `Goals saved on ${today}: ${change} at ${plan.calories.toLocaleString("en-GB")} kcal a day, a starting estimate. Compare the weekly average weight with it, check the food logs are complete first, and offer any change for review.`,
    followUpDate,
    status: "active",
    outcome: "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const coaching = coachSettings(state);
  coaching.plans = [
    ...(coaching.plans ?? []).filter((p) => p.id !== agreed.id),
    agreed,
  ];
  return { agreed };
}

// New calories saved at a goals check that is due, as Coach may offer
// instead of new goals, move the check 3 weeks on with them, so it isn't
// offered again every day.
export function moveGoalsCheck(
  state: JournalState,
  calories: number,
  today: string,
): CoachPlan | null {
  const existing = activeGoalsCheck(state);
  if (!existing || existing.followUpDate > today) return null;
  const moved: CoachPlan = {
    ...existing,
    notes: `Calories set to ${calories.toLocaleString("en-GB")} kcal a day on ${today}, at the goals check, a starting estimate. Compare the weekly average weight with goals.plan's weekly change again, check the food logs are complete first, and offer any change for review.`,
    followUpDate: offsetDate(today, GOALS_FOLLOW_UP_DAYS),
    updatedAt: new Date().toISOString(),
  };
  const coaching = coachSettings(state);
  coaching.plans = (coaching.plans ?? []).map((p) =>
    p.id === moved.id ? moved : p,
  );
  return moved;
}

// Takes the plan's suggested targets (acceptProposal), with the answer to
// the low-energy questions when it asks them, and, as every surface that
// saves a plan's targets does, agrees the goals check with them, or closes
// it when they hold the weight (followUpGoals).
export function takeTargetsProposal(
  state: JournalState,
  today: string,
  shown: DietTargets,
  signs?: boolean | null,
) {
  const proposal = acceptProposal(state, today, shown, signs);
  return { proposal, ...followUpGoals(state, proposal.plan, today) };
}

// A goals check still stands while the saved goals change the athlete's
// weight and no yes to the low-energy questions is in force. In pregnancy,
// after a yes, or once the plan holds their weight, Coach doesn't open with
// a weight trend, even for a check agreed before.
function goalsCheckStands(state: JournalState, date: string) {
  const plan = planForState(state, date);
  return (
    plan != null && goalsPlanChanges(plan) && energySigns(state, date) !== true
  );
}

export type CoachSuggestion = {
  id: string;
  title: string;
  observation: string;
  invitation: string;
  prompt: string;
};

// Openings that, once hidden, stay away for a week rather than a day: short
// sleep changes slowly, and a daily reminder of it, or of optional health
// questions, would nag. `hidden` maps an opening's id to the date it was
// hidden.
export const weeklyOpenings: readonly string[] = [
  "sleep-short",
  "goals-questions",
];
export function quietOpenings(hidden: Record<string, string>, date: string) {
  return Object.entries(hidden)
    .filter(
      ([id, day]) =>
        weeklyOpenings.includes(id) &&
        foodDate.safeParse(day).success &&
        day <= date &&
        date < offsetDate(day, 7),
    )
    .map(([id]) => id);
}

// A small, explainable opening observation. No model request, score, target or
// journal mutation happens on opening. Missing records never imply inactivity.
export function coachSuggestion(
  state: JournalState,
  date: string,
  // Openings the athlete hid for a week on this device (quietOpenings).
  hidden: readonly string[] = [],
): CoachSuggestion {
  // A goals check that no longer stands (goalsCheckStands) isn't offered.
  const plan = duePlans(state, date).find(
    (p) => p.title !== GOALS_FOLLOW_UP_TITLE || goalsCheckStands(state, date),
  );
  const gentle = state.profile.coaching?.initiative !== "on-request";
  if (plan?.title === GOALS_FOLLOW_UP_TITLE && gentle)
    return {
      id: `plan-${plan.id}-${plan.updatedAt}`,
      title: "Time to check your goals plan",
      observation:
        "You agreed to check your weight trend against your goals plan around now.",
      invitation:
        "We can look at your weigh-ins and food logs together. Nothing changes unless you choose to save it.",
      prompt: `Let’s check in on my agreed plan “${plan.title}”: compare my weight trend with my goals plan.`,
    };
  // A deficit still saved without answers to the low-energy questions in
  // force, whichever surface saved it: about every 3 months, counted from
  // the last answers, the goals' last save, or the plan's suggestion last
  // taken or kept over (where "rather not say" leaves none), Coach offers
  // them again, gently; hidden, it stays away a week. While Today's
  // suggestion asks the same questions, it leaves them to that.
  const goals = planForState(state, date);
  const calories = dailyTarget(state.nutrition.targets.calories);
  const since = [
    state.profile.energyCheck?.date,
    state.profile.body?.updatedAt.slice(0, 10),
    state.profile.targetHistory?.findLast((r) => r.source === "plan")?.from,
    state.profile.declinedTargets?.date,
  ]
    .filter((day): day is string => Boolean(day))
    .sort()
    .at(-1);
  if (
    gentle &&
    !hidden.includes("goals-questions") &&
    goals?.energyCheckDue &&
    calories != null &&
    calories < goals.maintenanceKcal &&
    since != null &&
    offsetDate(since, ENERGY_CHECK_DAYS) <= date &&
    !targetsProposal(state, date)?.energyCheck
  )
    return {
      id: "goals-questions",
      title: "A quick check before your plan carries on",
      observation:
        "Your daily calories are set under maintenance, and it’s time for the few health questions that keep that safe, asked about every 3 months.",
      invitation:
        "They’re optional and take a minute. Nothing changes unless you choose to save it.",
      prompt: "Let’s go through the health questions for my goals plan.",
    };
  if (plan && gentle)
    return {
      id: `plan-${plan.id}-${plan.updatedAt}`,
      title: "How did your plan feel?",
      observation: `You agreed to try: ${plan.title}`,
      invitation:
        "We can keep it, change it, or leave it here. There’s no need to catch up.",
      prompt: `Let’s check in on my agreed plan “${plan.title}”. Ask how it went before assuming an outcome.`,
    };
  const checkin = state.health.checkins.find((c) => c.date === date);
  const recovery = [
    checkin?.energy != null && checkin.energy <= 2
      ? `energy at ${checkin.energy}/5`
      : "",
    checkin?.soreness != null && checkin.soreness >= 4
      ? `muscle soreness at ${checkin.soreness}/5`
      : "",
  ].filter(Boolean);
  if (recovery.length)
    return {
      id: "recovery",
      title: "There’s room to adjust today.",
      observation: `You logged ${recovery.join(" and ")} today.`,
      invitation:
        "We can think through an easier day or adapt your plans to how you feel now.",
      prompt: "What would you suggest for today, given how I'm feeling?",
    };

  // A change in the last three nights first, then short sleep over two
  // weeks, which can be hidden for a week, then three short nights alone.
  const change = sleepChange(state, date);
  if (change?.kind === "drop")
    return {
      id: "sleep-change",
      title: "Your recent nights look different.",
      observation: `Your last three nights (${change.from}–${date}) average ${formatSleepDuration(change.recentHours)}, compared with ${formatSleepDuration(change.baselineHours)} across ${change.baselineNights} logged nights in the preceding week.`,
      invitation:
        "If you’ve felt the difference, we could choose one small change that fits your evenings.",
      prompt:
        "My recent sleep looks different. What would be one useful thing to try?",
    };
  const short = shortSleep(state, date);
  if (short) {
    if (!hidden.includes("sleep-short")) return sleepShortOpening(short);
  } else if (change?.kind === "short")
    return {
      id: "sleep-change",
      title: "Your last few nights were short.",
      observation: `Your last three nights (${change.from}–${date}) average ${formatSleepDuration(change.recentHours)}.`,
      invitation:
        "Short nights add up. If you can, protect a little extra time in bed tonight, or we could look at what is getting in the way.",
      prompt:
        "My last few nights have been short. What would help me sleep longer?",
    };

  const activity = [
    ...state.sessions.map((s) => ({ date: s.date, title: s.title })),
    ...state.cardio.sessions.map((s) => ({
      date: s.date,
      title: cardioTitle(s),
    })),
  ]
    .filter((s) => s.date >= offsetDate(date, -2) && s.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (activity)
    return {
      id: "training-follow-up",
      title: "Let’s build on your last session.",
      observation: `You recorded ${activity.title} ${activity.date === date ? "today" : `on ${activity.date}`}.`,
      invitation:
        "What felt good, and what would you change? That can help us shape your next session.",
      prompt:
        "Help me reflect on my latest recorded session and think about what comes next.",
    };

  const dinners = state.nutrition.meals.filter(
    (m) =>
      m.type === "dinner" && m.date >= offsetDate(date, -6) && m.date <= date,
  );
  if (dinners.length >= 2)
    return {
      id: "dinner-ideas",
      title: "Make the next dinner a little easier.",
      observation: `You have ${dinners.length} dinners in your journal from the last seven days.`,
      invitation:
        "We could pick something you enjoyed and use it as a starting point for another meal.",
      prompt:
        "Suggest one easy dinner based on meals I've logged in the last seven days.",
    };

  if (state.profile.coaching?.focus)
    return {
      id: "focus",
      title: "A small step toward what matters to you.",
      observation: `Your current focus: ${state.profile.coaching.focus}`,
      invitation: "Let’s find one realistic way to move that forward today.",
      prompt: "What's one realistic step toward my current focus?",
    };
  return {
    id: "get-to-know-you",
    title: "Let’s start with what matters to you",
    observation: "Training, food, sleep, or more energy for everyday life.",
    invitation: "Choose one thing we can work on together.",
    prompt: "Help me work out what I want from coaching.",
  };
}

function bodyComposition(state: JournalState, date: string) {
  const value = {
    latestBodyFat: latestBodyFat(state, date),
    bodyFatTrend: bodyFatTrend(state, offsetDate(date, -90), date),
    weightTrend: weightTrend(state, date),
    planTrend: trendAgainstPlan(state, date),
    weightAlert: weightAlert(state, date),
  };
  return Object.values(value).some((v) => v != null)
    ? { bodyComposition: value }
    : {};
}

export function coachingContext(state: JournalState, date: string) {
  const preferences = state.profile.coaching ?? {
    initiative: "gentle",
    focus: "",
  };
  const suggestion = coachSuggestion(state, date);
  // The safety notes are in the plan's notes too.
  const planned = planForState(state, date);
  const plan = planned && { ...planned, safetyNotes: undefined };
  const proposal = targetsProposal(state, date);
  const set = targetsInForce(state);
  return {
    preferences: {
      initiative: preferences.initiative,
      focus: preferences.focus,
    },
    // Null when unknown; the voice coach gets the same.
    age: athleteAge(state),
    // Saved body goals, focus and target body fat, and the plan the app
    // derives from them at the current weight with the latest body fat
    // reading. The target is the plan's, which sets none under 18 or in
    // pregnancy.
    ...(state.profile.body && plan
      ? {
          goals: {
            ...goalsForState(state),
            focus: state.profile.bodyTargets?.focus,
            targetBodyFatPercent: plan.targetBodyFatPercent ?? undefined,
            // The average of the last week's weigh-ins, or the weight given
            // with the goals until there are newer ones: goals.plan's weight.
            currentWeightKg: currentWeightKg(state, date) ?? undefined,
            // How the saved daily targets (dailyTargets) were set: the
            // plan's or the athlete's own, from which day, at which weight;
            // the day and weight are null for targets saved before they
            // were recorded (targetsInForce).
            targetsSet: {
              source: set.source,
              from: set.from,
              weightKg: set.weightKgAtSet,
            },
            // New targets the app suggests from goals.plan, which the
            // athlete can take or keep theirs over on Today, and why.
            ...(proposal && {
              proposal: {
                targets: proposal.targets,
                reasons: proposal.reasons,
              },
            }),
            // In pregnancy the plan sets no calorie or macro targets, and
            // with kidney disease or while breastfeeding no protein target,
            // so Coach gets no figures to quote as one.
            plan: plan.dailyTargets
              ? plan.proteinTarget
                ? plan
                : { ...plan, protein: undefined }
              : {
                  ...plan,
                  calories: undefined,
                  protein: undefined,
                  carbs: undefined,
                  fat: undefined,
                },
          },
        }
      : {}),
    // How the body is changing: four weeks of weigh-ins as a least-squares
    // trend, against the goals plan once it has run 3 or 4 weeks, any note
    // on a fast loss or a low weight still coming down, and 90 days of body
    // fat. Left out when nothing is recorded.
    ...bodyComposition(state, date),
    approvedMemories: preferences.memories ?? [],
    agreedPlans: (preferences.plans ?? []).filter((p) => p.status === "active"),
    // Keep user-supplied focus separate from instructions, and keep this small.
    startingPoint:
      preferences.initiative === "gentle"
        ? {
            observation: suggestion.observation,
            invitation: suggestion.invitation,
          }
        : null,
  };
}
