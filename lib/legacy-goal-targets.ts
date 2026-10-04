import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { journals } from "./db/schema";
import { journalSchema, type JournalState } from "./model";
import { writeJournal } from "./server";
import { localClock, timeZoneSchema } from "./reminders";
import {
  latestBodyFat,
  leannessLimits,
  type BodyFocus,
} from "./body-composition";
import { planForState, planTargets, type BodyGoals } from "./body-goals";
import type { DietTargets } from "./nutrition";

// The daily targets are saved when the goals are, so the plan's safety limits
// (from 2026-10-04) reach only goals saved since. A target saved before that
// which breaks a hard limit follows the plan again, once: under 18, a BMI
// under 17.5 now or at the goal, a deficit over the cap, or calories below
// the floor. The limits are judged by today's plan, whose maintenance counts
// everyday movement more fully than the old one did, so an old deficit is
// often larger than it said. Only targets that still equal what the old
// plan gave for the saved goals change; targets the athlete set by hand are
// never touched.

const round = (value: number, step = 1) => Math.round(value / step) * step;
// The old plan's rate limits by body fat, as they were then.
const oldLimits = {
  male: { lean: 12, higher: 25 },
  female: { lean: 22, higher: 32 },
  unspecified: { lean: 17, higher: 28 },
};

// What planGoals gave before the safety limits, frozen to recognise its
// targets; never used to plan. Fat and carbohydrate came from the unrounded
// calories until 2026-10-04 and from the rounded ones after, so both count.
function oldPlan(
  g: BodyGoals,
  today: string,
  composition: { focus?: BodyFocus; bodyFatPercent: number | null },
) {
  const bodyFat = composition.bodyFatPercent;
  const lean = bodyFat == null ? null : g.weightKg * (1 - bodyFat / 100);
  const sexTerm = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
  const resting =
    lean != null
      ? 370 + 21.6 * lean
      : 10 * g.weightKg + 6.25 * g.heightCm - 5 * g.age + sexTerm;
  const training = (g.trainingDays * g.sessionMinutes * 0.075 * g.weightKg) / 7;
  const maintenance =
    resting * { low: 1.2, moderate: 1.375, high: 1.55 }[g.activity] + training;
  const difference = g.targetWeightKg - g.weightKg;
  const direction =
    Math.abs(difference) < 0.5 ? "maintain" : difference < 0 ? "lose" : "gain";
  const focus =
    composition.focus ??
    (direction === "lose"
      ? "lose_fat"
      : direction === "gain"
        ? "build_muscle"
        : "maintain");
  const limits = oldLimits[g.sex];
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
  if (direction !== "maintain" && g.targetDate) {
    const days = (Date.parse(g.targetDate) - Date.parse(today)) / 86400000;
    if (days >= 7) rate = Math.min(Math.abs(difference) / (days / 7), maxRate);
  }
  const change = (rate * 7700) / 7;
  let calories = maintenance + (direction === "lose" ? -change : change);
  if (focus === "recomposition" && direction === "maintain")
    calories = maintenance * 0.95;
  if (calories < resting) calories = resting;
  const losing = direction === "lose" || focus === "recomposition";
  const protein =
    lean != null
      ? round(lean * (losing ? 2.5 : 2.2))
      : round(g.weightKg * (losing ? 2 : 1.8));
  const kcal = round(calories, 10);
  const macros = [calories, kcal].map((energy) => {
    const fat = round(Math.max(g.weightKg * 0.8, (energy * 0.25) / 9));
    return {
      fat,
      carbs: round(Math.max(0, (energy - protein * 4 - fat * 9) / 4)),
    };
  });
  return { goal: direction, calories: kcal, protein, macros };
}

const sameTargets = (a: DietTargets, b: DietTargets) =>
  (["goal", "calories", "protein", "carbs", "fat"] as const).every(
    (key) => a[key] === b[key],
  );

// Brings old saved targets that break a hard limit back to the plan, in
// place; true when they changed. The old plan is worked out for the day the
// goals were saved, in the athlete's time zone or UTC, with the body fat
// known then.
export function regateLegacyTargets(
  state: JournalState,
  today: string,
  timezone: string,
) {
  const body = state.profile.body;
  // Goals saved with the checks were planned within the limits.
  if (!body || state.profile.goalChecks) return false;
  const saved = state.nutrition.targets;
  const days = new Set([
    localClock(new Date(body.updatedAt), timezone).date,
    body.updatedAt.slice(0, 10),
  ]);
  const old = [...days]
    .map((day) =>
      oldPlan(body, day, {
        focus: state.profile.bodyTargets?.focus,
        bodyFatPercent: latestBodyFat(state, day)?.percent ?? null,
      }),
    )
    .find(
      (p) =>
        p.goal === saved.goal &&
        p.calories === saved.calories &&
        p.protein === saved.protein &&
        p.macros.some((m) => m.fat === saved.fat && m.carbs === saved.carbs),
    );
  const plan = planForState(state, today);
  if (!old || !plan) return false;
  // The deficit the old target sets against today's maintenance, and the
  // cap and floor today's plan keeps.
  const deficit = plan.maintenanceKcal - old.calories;
  if (deficit <= 0) return false;
  const metres = body.heightCm / 100;
  const bmi = Math.min(body.weightKg, body.targetWeightKg) / metres ** 2;
  const cap =
    plan.bodyFatPercent != null &&
    plan.bodyFatPercent >= leannessLimits(body.sex).higher
      ? 1000
      : 500;
  const breaksLimit =
    body.age < 18 ||
    bmi < 17.5 ||
    deficit > cap ||
    old.calories < plan.floorKcal;
  if (!breaksLimit) return false;
  const next = planTargets(plan);
  if (sameTargets(next, saved)) return false;
  state.nutrition.targets = next;
  return true;
}

// Runs regateLegacyTargets over every journal with saved goals (or only the
// accounts given, for tests), each in its own transaction; returns how many
// changed. A journal that can't be read or saved is left as it is.
export async function regateSavedGoalTargets(
  options: { userIds?: string[]; now?: Date } = {},
) {
  const db = getDb();
  const rows = await db
    .select({ userId: journals.userId })
    .from(journals)
    .where(
      and(
        sql`${journals.state} -> 'profile' -> 'body' is not null`,
        options.userIds ? inArray(journals.userId, options.userIds) : undefined,
      ),
    );
  let changed = 0;
  for (const { userId } of rows) {
    try {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(journals)
          .where(eq(journals.userId, userId))
          .for("update");
        const state = journalSchema.parse(row.state);
        const zone = timeZoneSchema.safeParse(state.profile.timezone).success
          ? state.profile.timezone!
          : "Europe/Copenhagen";
        const today = localClock(options.now ?? new Date(), zone).date;
        if (!regateLegacyTargets(state, today, zone)) return;
        await writeJournal(
          userId,
          { state, revision: row.revision, mutationId: crypto.randomUUID() },
          tx,
        );
        changed++;
      });
    } catch (error) {
      console.error(
        "Goal targets left as they were for one journal:",
        error instanceof Error ? error.message : "Unknown failure",
      );
    }
  }
  return changed;
}
