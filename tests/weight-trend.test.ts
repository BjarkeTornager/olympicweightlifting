import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  type BodyGoalsInput,
  type BodyGoalsRequest,
} from "../lib/body-goals";
import {
  fitWeights,
  NOT_ENOUGH_WEIGH_INS,
  weightTrend,
} from "../lib/body-composition";
import { coachingContext } from "../lib/coaching";
import { weightTrendRule } from "../lib/agent/health-rules";
import { localClock } from "../lib/agent/time-context";
import { voiceContext, voiceInstruction } from "../lib/voice-checkin";
import { dailyHealth, offsetDate, saveCheckin } from "../lib/health";
import { buildToday } from "../lib/native-api";
import { recordTargets } from "../lib/target-history";
import { targetsProposal } from "../lib/target-proposals";
import {
  trendAgainstPlan,
  weekAverages,
  weightAlert,
} from "../lib/weight-trend";

// The weight trend: a least-squares line through four weeks of weigh-ins,
// "about stable" when the weigh-ins can't tell it from no change, and not
// a trend at all with fewer than 4 over 14 days; then against the goals
// plan, and a note on a fast loss or a low weight still coming down.
const today = "2026-09-26";
const athlete: BodyGoalsInput = {
  age: 34,
  sex: "male",
  heightCm: 182,
  weightKg: 88,
  targetWeightKg: 81,
  targetDate: null,
  activity: "moderate",
  trainingDays: 4,
  sessionMinutes: 75,
  experience: "developing",
};
type State = ReturnType<typeof emptyJournal>;

// A seeded generator, so every run draws the same noise: mulberry32, and
// Box–Muller for a normal spread.
function noise(seed: number, sd: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () =>
    sd *
    Math.sqrt(-2 * Math.log(1 - uniform())) *
    Math.cos(2 * Math.PI * uniform());
}

// Weigh-ins on the given days before today, at a steady rate a week from a
// starting weight, with day-to-day noise, to 0.1 kg as a scale shows.
function series(
  startKg: number,
  kgPerWeek: number,
  days: number[],
  seed = 1,
  sd = 0.5,
): [string, number][] {
  const draw = noise(seed, sd);
  const first = Math.max(...days);
  return days.map((back) => [
    offsetDate(today, -back),
    Math.round((startKg + (kgPerWeek * (first - back)) / 7 + draw()) * 10) / 10,
  ]);
}
const weigh = (state: State, weights: [string, number][]) => {
  for (const [date, bodyweight] of weights)
    saveCheckin(state, { date, bodyweight }, today);
};
const daily = (from: number) =>
  Array.from({ length: from + 1 }, (_, i) => from - i);

test("synthetic weigh-ins with 0.5 kg of noise give the right sign at the expected rate", () => {
  // Daily weigh-ins for 4 weeks, losing 0.5 kg a week or gaining 0.25.
  for (const rate of [-0.5, 0.25]) {
    const found: number[] = [];
    let right = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const state = emptyJournal();
      weigh(state, series(85, rate, daily(28), seed));
      const trend = weightTrend(state, today)!;
      // Never the wrong way.
      assert.notEqual(trend.status, rate < 0 ? "gaining" : "losing");
      if (trend.status === (rate < 0 ? "losing" : "gaining")) right++;
      found.push(trend.kg_per_week!);
      // Within about three standard errors of the true rate.
      assert.ok(Math.abs(trend.kg_per_week! - rate) <= 0.3, `${seed}`);
      // The trend weight sits on the line, not on the last noisy reading.
      assert.ok(Math.abs(trend.trend_kg! - (85 + rate * 4)) <= 0.5);
    }
    // A loss of 0.5 kg a week always shows; a gain of 0.25 nearly always,
    // and otherwise reads about stable, as the noise can hide that much.
    assert.ok(right >= (rate < 0 ? 100 : 80), `${rate}: ${right}`);
    const mean = found.reduce((a, b) => a + b, 0) / found.length;
    assert.ok(Math.abs(mean - rate) < 0.05, `${rate}: ${mean}`);
  }
  // Three weigh-ins a week: never the wrong way, and right on average.
  const found: number[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    const state = emptyJournal();
    weigh(
      state,
      series(85, -0.5, [28, 26, 23, 21, 19, 16, 14, 12, 9, 7, 5, 2, 0], seed),
    );
    const trend = weightTrend(state, today)!;
    assert.notEqual(trend.status, "gaining", `${seed}`);
    found.push(trend.kg_per_week!);
  }
  const mean = found.reduce((a, b) => a + b, 0) / found.length;
  assert.ok(Math.abs(mean + 0.5) < 0.06, `${mean}`);
  // No real change: about stable nearly always, rather than a change read
  // into the noise.
  let stable = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const state = emptyJournal();
    weigh(state, series(85, 0, daily(28), seed));
    if (weightTrend(state, today)!.status === "stable") stable++;
  }
  assert.ok(stable >= 90, `${stable}`);
});

test("two weigh-ins, or too few over too short a time, are not enough for a trend", () => {
  const state = emptyJournal();
  assert.equal(weightTrend(state, today), null);
  weigh(state, [
    [offsetDate(today, -14), 86],
    [today, 85],
  ]);
  const two = weightTrend(state, today)!;
  assert.equal(two.status, "not_enough");
  assert.equal(two.summary, NOT_ENOUGH_WEIGH_INS);
  assert.match(two.summary, /^Not enough weigh-ins for a trend yet/);
  assert.equal(two.kg_per_week, null);
  assert.equal(two.trend_kg, null);
  assert.deepEqual(two.first, { date: offsetDate(today, -14), kg: 86 });
  // Three over three weeks: still not enough.
  weigh(state, [[offsetDate(today, -21), 86.5]]);
  assert.equal(weightTrend(state, today)!.status, "not_enough");
  // Four, but over 10 days: not enough either.
  const short = emptyJournal();
  weigh(short, series(85, -0.5, [10, 7, 3, 0]));
  assert.equal(weightTrend(short, today)!.status, "not_enough");
  // Four over two weeks make one.
  const enough = emptyJournal();
  weigh(enough, [
    [offsetDate(today, -14), 86],
    [offsetDate(today, -9), 85.6],
    [offsetDate(today, -5), 85.4],
    [today, 85],
  ]);
  const trend = weightTrend(enough, today)!;
  assert.equal(trend.status, "losing");
  assert.equal(trend.kg_per_week, -0.5);
  assert.equal(trend.percent_per_week, -0.6);
  assert.equal(trend.trend_kg, 85);
  assert.equal(
    trend.summary,
    "Down about 0.5 kg a week (0.6% of bodyweight) over the last 2 weeks",
  );
});

test("two weeks of daily weigh-ins make a trend, and an old one says when it ended", () => {
  // 14 daily weigh-ins, the first and latest counted: 14 days, a trend.
  const fortnight = emptyJournal();
  weigh(fortnight, series(85, -0.5, daily(13), 2, 0.1));
  const trend = weightTrend(fortnight, today)!;
  assert.equal(trend.status, "losing");
  assert.match(trend.summary, / over the last 2 weeks$/);
  // 13 days are not enough.
  const short = emptyJournal();
  weigh(short, series(85, -0.5, daily(12), 2, 0.1));
  assert.equal(weightTrend(short, today)!.status, "not_enough");
  // Weigh-ins that stopped two weeks ago: the trend says when it ended,
  // rather than "over the last 2 weeks" under "No measurement in the last
  // 14 days".
  const stopped = emptyJournal();
  weigh(stopped, [
    [offsetDate(today, -28), 82.2],
    [offsetDate(today, -25), 81.6],
    [offsetDate(today, -21), 81.2],
    [offsetDate(today, -18), 80.9],
    [offsetDate(today, -14), 80.4],
  ]);
  assert.equal(dailyHealth(stopped, today).latestWeight, null);
  assert.equal(
    weightTrend(stopped, today)!.summary,
    "Down about 0.9 kg a week (1.1% of bodyweight) over 2 weeks to 12 September",
  );
  // A latest weigh-in a week ago is still this week's: the weeks count
  // from the first weigh-in to today.
  const lately = emptyJournal();
  weigh(lately, series(85, 0, [21, 17, 14, 10, 7], 2, 0.1));
  assert.equal(
    weightTrend(lately, today)!.summary,
    "About stable over the last 3 weeks",
  );
});

test("the fit is ordinary least squares, and a slip is passed over", () => {
  // y = 80 − 0.1 t, exactly: −0.7 kg a week with no error.
  const fit = fitWeights(
    [0, 3, 7, 14].map((d) => ({
      date: offsetDate(today, d - 14),
      kg: 80 - 0.1 * d,
    })),
  )!;
  assert.ok(Math.abs(fit.kgPerWeek + 0.7) < 1e-9);
  assert.ok(fit.seKgPerWeek < 1e-6);
  assert.ok(Math.abs(fit.trendKg - 78.6) < 1e-9);
  assert.equal(fit.days, 14);
  assert.equal(fitWeights([{ date: today, kg: 80 }]), null);
  // 185 typed for 85 among steady weigh-ins: about stable, not a crash.
  const state = emptyJournal();
  weigh(state, [
    [offsetDate(today, -21), 85.2],
    [offsetDate(today, -14), 85],
    [offsetDate(today, -10), 185],
    [offsetDate(today, -7), 85.1],
    [today, 85],
  ]);
  const trend = weightTrend(state, today)!;
  assert.equal(trend.weigh_ins, 4);
  assert.equal(trend.status, "stable");
  assert.equal(trend.summary, "About stable over the last 3 weeks");
});

test("after 3 weeks the trend is compared with the plan: on track, slower or faster", () => {
  const start = offsetDate(today, -28);
  const plan = (rate: number, seed = 3) => {
    const state = emptyJournal();
    applyGoals(state, athlete, start);
    weigh(state, series(88, rate, daily(27), seed, 0.3));
    return state;
  };
  // The plan loses about 0.44 kg a week at 88 kg.
  const onTrack = trendAgainstPlan(plan(-0.45), today)!;
  assert.equal(onTrack.state, "on_track");
  assert.equal(onTrack.planned_kg_per_week, -0.4);
  assert.equal(
    onTrack.text,
    "On track with your goals plan, which loses about 0.4 kg a week.",
  );
  const slower = trendAgainstPlan(plan(0), today)!;
  assert.equal(slower.state, "slower");
  assert.equal(
    slower.text,
    "Slower than your goals plan, which loses about 0.4 kg a week.",
  );
  assert.equal(trendAgainstPlan(plan(-1.2), today)!.state, "faster");
  // Not before the targets have run 3 weeks: the weigh-ins since then.
  const early = emptyJournal();
  applyGoals(early, athlete, offsetDate(today, -15));
  weigh(early, series(88, 0, daily(15)));
  assert.equal(trendAgainstPlan(early, today), null);
  // 4 weeks for women, as the cycle moves weight.
  const woman = emptyJournal();
  applyGoals(
    woman,
    {
      ...athlete,
      sex: "female",
      heightCm: 168,
      weightKg: 70,
      targetWeightKg: 65,
    },
    offsetDate(today, -24),
  );
  weigh(woman, series(70, -0.35, daily(23), 3, 0.3));
  assert.equal(trendAgainstPlan(woman, today), null);
  assert.equal(
    trendAgainstPlan(woman, offsetDate(today, 4))?.state,
    "on_track",
  );
  // Targets the athlete set themselves aren't the plan's to compare.
  const own = plan(0);
  recordTargets(
    own,
    { ...own.nutrition.targets, calories: 2400 },
    offsetDate(today, -27),
    { source: "manual", weightKg: 88 },
  );
  assert.equal(trendAgainstPlan(own, today), null);
  // Without enough weigh-ins since the targets were set, none.
  const sparse = emptyJournal();
  applyGoals(sparse, athlete, start);
  weigh(sparse, series(88, -0.45, [20, 0]));
  assert.equal(trendAgainstPlan(sparse, today), null);
});

test("a fast loss gets an amber or red note, and a low weight still coming down gets one too", () => {
  // 1.2 % of bodyweight a week for 3 weeks: amber.
  const amber = emptyJournal();
  weigh(amber, series(80, -0.96, daily(21), 5, 0.3));
  const note = weightAlert(amber, today)!;
  assert.equal(note.level, "amber");
  assert.equal(note.kind, "fast_loss");
  assert.match(
    note.text,
    /^Your weight has come down by about 1\.\d% of your bodyweight a week over the last 3 weeks, faster than the 1% a week usually advised\. If that's more than you meant, eating a little more can ease it, and if you feel tired, low or unwell, a doctor or sports dietitian can help\.$/,
  );
  // 2 % a week over 2 weeks: red.
  const red = emptyJournal();
  weigh(red, series(80, -1.6, daily(14), 5, 0.3));
  const urgent = weightAlert(red, today)!;
  assert.equal(urgent.level, "red");
  assert.match(
    urgent.text,
    /^Your weight has come down quickly, about [12]\.\d% of your bodyweight a week over the last 2 weeks\. /,
  );
  assert.match(urgent.text, /please check in with a doctor soon/);
  // Weigh-ins only from 2 weeks ago say 2 weeks, not 3.
  const fortnight = emptyJournal();
  weigh(fortnight, series(80, -1.04, daily(14), 5, 0.1));
  const recent = weightAlert(fortnight, today)!;
  assert.equal(recent.level, "amber");
  assert.match(recent.text, /a week over the last 2 weeks, faster than/);
  // Just over 1 % a week, which shows as 1 %, isn't faster than 1 %: 80 kg
  // losing 0.8 kg a week for 3 weeks is about 1.03 % of 77.6 kg.
  const edge = emptyJournal();
  weigh(edge, series(80, -0.8, daily(21), 5, 0));
  assert.equal(weightTrend(edge, today)!.percent_per_week, -1);
  assert.equal(weightAlert(edge, today), null);
  const over = emptyJournal();
  weigh(over, series(80, -0.88, daily(21), 5, 0));
  assert.match(
    weightAlert(over, today)!.text,
    /^Your weight has come down by about 1\.1% of your bodyweight a week over the last 3 weeks, faster than the 1% a week usually advised\./,
  );
  // At the plan's rate, or with noise alone, nothing.
  const steady = emptyJournal();
  weigh(steady, series(80, -0.4, daily(21), 5));
  assert.equal(weightAlert(steady, today), null);
  const flat = emptyJournal();
  weigh(flat, series(80, 0, daily(21), 7));
  assert.equal(weightAlert(flat, today), null);
  // Under 18, a parent too; in pregnancy, the midwife.
  const teen = emptyJournal();
  teen.profile.age = 16;
  weigh(teen, series(60, -1.2, daily(14), 5, 0.3));
  assert.match(weightAlert(teen, today)!.text, /a parent and a doctor/);
  const pregnant = emptyJournal();
  pregnant.profile.goalChecks = {
    pregnancy: "pregnant",
    lowWeightConfirmedKg: null,
    updatedAt: new Date().toISOString(),
  };
  weigh(pregnant, series(70, -1.4, daily(14), 5, 0.3));
  assert.match(
    weightAlert(pregnant, today)!.text,
    /In pregnancy that's worth telling your midwife or doctor about soon\.$/,
  );
  // Breastfeeding a baby under 6 weeks old: weight comes off quickly after
  // a birth, so no note on the speed.
  const newborn = emptyJournal();
  newborn.profile.goalChecks = {
    pregnancy: "breastfeeding",
    lowWeightConfirmedKg: null,
    updatedAt: new Date().toISOString(),
  };
  newborn.profile.goalHealth = {
    babyBornOn: offsetDate(today, -21),
    updatedAt: new Date().toISOString(),
  };
  weigh(newborn, series(72, -1.4, daily(14), 5, 0.3));
  assert.equal(weightAlert(newborn, today), null);
  // With the baby's age not given, as the goals plan sets no deficit then:
  // no note for 6 weeks after she said she was breastfeeding, as the baby
  // was born by then, and a note as usual after that.
  const birth: [string, number][] = [
    [offsetDate(today, -14), 78],
    [offsetDate(today, -12), 77.6],
    [offsetDate(today, -9), 72.5],
    [offsetDate(today, -7), 71.8],
    [offsetDate(today, -4), 71.2],
    [offsetDate(today, -2), 70.9],
    [today, 70.6],
  ];
  const unknown = emptyJournal();
  unknown.profile.goalChecks = {
    pregnancy: "breastfeeding",
    lowWeightConfirmedKg: null,
    updatedAt: `${offsetDate(today, -10)}T09:00:00.000Z`,
  };
  weigh(unknown, birth);
  assert.equal(weightAlert(unknown, today), null);
  const older = structuredClone(unknown);
  older.profile.goalChecks!.updatedAt = `${offsetDate(today, -43)}T09:00:00.000Z`;
  const later = weightAlert(older, today)!;
  assert.equal(later.level, "red");
  assert.match(later.text, /your midwife, health visitor or doctor soon/);

  // A BMI under 18.5 (55 kg at 175 cm is 18.0) and falling slowly: amber,
  // a doctor; under 17.5, red.
  const low = emptyJournal();
  applyGoals(
    low,
    {
      ...athlete,
      sex: "female",
      heightCm: 175,
      weightKg: 56.5,
      targetWeightKg: 56,
    },
    offsetDate(today, -28),
  );
  weigh(low, series(56.5, -0.35, daily(28), 5, 0.2));
  const thin = weightAlert(low, today)!;
  assert.equal(thin.kind, "low_weight");
  assert.equal(thin.level, "amber");
  assert.equal(
    thin.text,
    "Your weight is below the healthy range for your height and still coming down. Please talk to a doctor or sports dietitian about it.",
  );
  const lower = emptyJournal();
  applyGoals(
    lower,
    {
      ...athlete,
      sex: "female",
      heightCm: 175,
      weightKg: 54,
      targetWeightKg: 54,
    },
    offsetDate(today, -28),
  );
  weigh(lower, series(54, -0.35, daily(28), 5, 0.2));
  const well = weightAlert(lower, today)!;
  assert.equal(well.level, "red");
  assert.equal(
    well.text,
    "Your weight is well below the healthy range for your height and still coming down. Please talk to a doctor about it soon.",
  );
  // Under 18 the adult line is only a prompt to check: a 14-year-old girl
  // at a BMI of about 17.1 is within the healthy range for her age, so the
  // note stays amber and says the low side, never well below.
  const young = emptyJournal();
  applyGoals(
    young,
    {
      ...athlete,
      age: 14,
      sex: "female",
      heightCm: 160,
      weightKg: 44.5,
      targetWeightKg: 44.5,
    },
    offsetDate(today, -28),
  );
  weigh(young, series(44.5, -0.2, daily(28), 5, 0.05));
  const teenNote = weightAlert(young, today)!;
  assert.equal(teenNote.kind, "low_weight");
  assert.equal(teenNote.level, "amber");
  assert.equal(
    teenNote.text,
    "Your weight is on the low side for your height and age and still coming down. Please talk to a parent and a doctor about it.",
  );
});

test("a loss faster than the plan never brings a suggestion to cut further", () => {
  const losing = (rate: number, days: number) => {
    const state = emptyJournal();
    applyGoals(state, athlete, offsetDate(today, -days));
    weigh(state, series(88, rate, daily(days - 1), 3, 0.3));
    return state;
  };
  // At about the plan's rate for 6 weeks the weight has moved over 2.5 %,
  // and the plan at the new weight suggests a little less.
  const steady = losing(-0.5, 42);
  assert.equal(trendAgainstPlan(steady, today)?.state, "on_track");
  const suggestion = targetsProposal(steady, today)!;
  assert.match(suggestion.reasons[0]!, /^Your weight is about 85\.\d kg now/);
  assert.ok(suggestion.targets.calories! < steady.nutrition.targets.calories!);
  // Twice as fast, it has moved further, but the loss is already faster
  // than the plan, with a note: no lower target.
  const fast = losing(-1, 28);
  assert.equal(trendAgainstPlan(fast, today)?.state, "faster");
  assert.equal(weightAlert(fast, today)?.level, "amber");
  assert.equal(targetsProposal(fast, today), null);
});

test("under a BMI of 18.5 a falling weight never brings a suggestion to eat less", () => {
  // A woman with a confirmed goal just under the healthy range, weighed
  // daily with a small weekly wiggle since her targets were set.
  const thin = (
    heightCm: number,
    weightKg: number,
    targetWeightKg: number,
    rate: number,
    days: number,
  ) => {
    const state = emptyJournal();
    const goals: BodyGoalsRequest = {
      ...athlete,
      age: 28,
      sex: "female",
      heightCm,
      weightKg,
      targetWeightKg,
      confirmLowWeight: true,
      energySigns: false,
    };
    applyGoals(state, goals, offsetDate(today, -days));
    const wiggle = [0.15, -0.1, 0.05, -0.15, 0.1, 0, -0.05];
    for (let d = days; d >= 0; d--)
      saveCheckin(
        state,
        {
          date: offsetDate(today, -d),
          bodyweight:
            Math.round(
              (weightKg + (rate * (days - d)) / 7 + wiggle[d % 7]!) * 10,
            ) / 10,
        },
        today,
      );
    return state;
  };
  // Losing about 1.3 % a week, 3 weeks after her targets were set: too
  // soon to compare with the plan, and the low weight hides the fast loss
  // at amber. The weight has moved over 2.5 %, but nothing lower.
  for (const state of [
    thin(175, 58, 54.5, -0.7, 21),
    thin(170, 54.6, 51, -0.75, 22),
  ]) {
    assert.equal(trendAgainstPlan(state, today), null);
    const note = weightAlert(state, today)!;
    assert.equal(note.kind, "low_weight");
    assert.equal(note.level, "amber");
    assert.equal(targetsProposal(state, today), null);
  }
  // On track at the plan's slow rate for 7 weeks, under 18.5 now: the same.
  const slow = thin(175, 58.2, 54.5, -0.25, 49);
  assert.equal(trendAgainstPlan(slow, today)?.state, "on_track");
  assert.equal(weightAlert(slow, today)?.kind, "low_weight");
  assert.equal(targetsProposal(slow, today), null);
  // The same loss at a BMI of 22 has no note, and the plan suggests a
  // little less at the lower weight.
  const usual = thin(175, 70, 66, -0.4, 49);
  assert.equal(weightAlert(usual, today), null);
  const suggestion = targetsProposal(usual, today)!;
  assert.ok(suggestion.targets.calories! < usual.nutrition.targets.calories!);
});

test("week averages need 3 weigh-ins in each week", () => {
  const state = emptyJournal();
  weigh(state, [
    [offsetDate(today, -13), 86],
    [offsetDate(today, -10), 85.8],
    [offsetDate(today, -6), 85.4],
    [offsetDate(today, -3), 85.2],
    [today, 85],
  ]);
  assert.equal(weekAverages(state, today), null);
  weigh(state, [[offsetDate(today, -8), 85.9]]);
  assert.deepEqual(weekAverages(state, today), {
    kg: 85.2,
    previousKg: 85.9,
    changeKg: -0.7,
  });
});

test("Today on the iPhone, health_overview and Coach carry the trend, the plan's state and any note", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, offsetDate(today, -28));
  weigh(state, series(88, -0.45, daily(27), 3, 0.3));
  const body = buildToday(state, 1, today, new Set()).body!;
  const trend = weightTrend(state, today)!;
  assert.equal(trend.status, "losing");
  assert.deepEqual(body.weightTrend, {
    status: "losing",
    text: trend.summary,
    weighIns: 28,
    kgPerWeek: trend.kg_per_week,
    percentPerWeek: trend.percent_per_week,
    trendKg: trend.trend_kg,
  });
  assert.equal(body.weeklyWeightChangeKg, trend.kg_per_week);
  assert.equal(body.planTrend, "on_track");
  assert.match(body.planTrendText!, /^On track with your goals plan/);
  assert.ok(body.weekAverageKg != null && body.previousWeekAverageKg != null);
  assert.equal(body.weightAlert, undefined);
  assert.equal(body.bodyweightDate, today);

  const health = dailyHealth(state, today);
  assert.equal(health.weightTrend?.status, "losing");
  assert.equal(health.planTrend?.state, "on_track");
  assert.equal(health.weightAlert, null);
  const context = coachingContext(state, today);
  assert.equal(context.bodyComposition?.weightTrend?.status, "losing");
  assert.equal(context.bodyComposition?.planTrend?.state, "on_track");

  // About stable: older apps get 0 a week.
  const stable = emptyJournal();
  weigh(stable, series(85, 0, daily(21), 2, 0.2));
  const steady = buildToday(stable, 1, today, new Set()).body!;
  assert.equal(steady.weightTrend?.status, "stable");
  assert.equal(steady.weeklyWeightChangeKg, 0);
  // Not enough weigh-ins: no change a week for older apps either.
  const few = emptyJournal();
  weigh(few, [
    [offsetDate(today, -7), 85.4],
    [offsetDate(today, -2), 85],
  ]);
  const sparse = buildToday(few, 1, today, new Set()).body!;
  assert.equal(sparse.weightTrend?.status, "not_enough");
  assert.equal(sparse.weightTrend?.text, NOT_ENOUGH_WEIGH_INS);
  assert.equal(sparse.weeklyWeightChangeKg, undefined);
  assert.equal(sparse.bodyweightDate, offsetDate(today, -2));
  // A fast loss: the note on Today and in Coach's context.
  const fast = emptyJournal();
  weigh(fast, series(80, -1.6, daily(14), 5, 0.3));
  const alert = buildToday(fast, 1, today, new Set()).body!.weightAlert!;
  assert.equal(alert.level, "red");
  assert.equal(
    coachingContext(fast, today).bodyComposition?.weightAlert?.text,
    alert.text,
  );

  // The voice coach hears the same, with the rule for it.
  const clock = localClock("2026-09-26T07:00:00Z", "Europe/Copenhagen");
  const heard = voiceContext(state, today).weight!;
  assert.ok(
    heard.startsWith(`${trend.summary}. On track with your goals plan`),
  );
  const voice = voiceInstruction(voiceContext(fast, today), clock);
  assert.ok(voice.includes(`- Weight trend: Down about `));
  assert.ok(voice.includes(`Note: ${alert.text}`));
  assert.ok(voice.includes(weightTrendRule));
  assert.match(
    voiceInstruction(voiceContext(emptyJournal(), today), clock),
    /- Weight trend: no weigh-ins in the last 4 weeks/,
  );
});
