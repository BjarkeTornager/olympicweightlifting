import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { journals } from "./db/schema";
import { journalSchema, type JournalState } from "./model";
import { writeJournal } from "./server";
import { localClock, timeZoneSchema } from "./reminders";
import { planForState, planTargets } from "./body-goals";
import type { DietTargets } from "./nutrition";
import { oldLimits, oldPlanOfTargets } from "./old-goal-plan";
import { currentWeightKg, recordTargets } from "./target-history";

// The daily targets are saved when the goals are, so the plan's safety limits
// (from 2026-10-04) reach only goals saved since. A target saved before that
// which breaks a hard limit follows the plan again, once: under 18, a BMI
// under 17.5 now or at the goal, a deficit over the cap, or calories below
// the floor. Only targets that still equal what the old plan gave for the
// saved goals change, recorded as the plan's; targets the athlete set by
// hand are never touched. Other old targets stay, and the plan suggests
// new ones beside them (target-proposals.ts).

const sameTargets = (a: DietTargets, b: DietTargets) =>
  (["goal", "calories", "protein", "carbs", "fat"] as const).every(
    (key) => a[key] === b[key],
  );

// Brings old saved targets that break a hard limit back to the plan, in
// place; true when they changed. The old plan is the one the saved targets
// are (oldPlanOfTargets).
export function regateLegacyTargets(
  state: JournalState,
  today: string,
  timezone: string,
) {
  const body = state.profile.body;
  // Goals saved with the checks were planned within the limits.
  if (!body || state.profile.goalChecks) return false;
  const saved = state.nutrition.targets;
  const old = oldPlanOfTargets(state, timezone);
  if (!old || old.deficit <= 0) return false;
  const metres = body.heightCm / 100;
  const bmi = Math.min(body.weightKg, body.targetWeightKg) / metres ** 2;
  const cap =
    old.bodyFat != null && old.bodyFat >= oldLimits[body.sex].higher
      ? 1000
      : 500;
  const breaksLimit =
    body.age < 18 ||
    bmi < 17.5 ||
    old.deficit > cap ||
    old.unrounded < old.floor;
  if (!breaksLimit) return false;
  const plan = planForState(state, today);
  if (!plan) return false;
  const next = planTargets(plan);
  if (sameTargets(next, saved)) return false;
  recordTargets(state, next, today, {
    source: "plan",
    weightKg: currentWeightKg(state, today),
    leanMassKg: plan.leanMassKg,
  });
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
