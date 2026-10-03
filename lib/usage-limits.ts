import { eq } from "drizzle-orm";
import { getDb, getPool } from "./db";
import { user, userLimits } from "./db/schema";
import { isOwnerEmail } from "./access";
import { countUse } from "./feature-use";
import { MAX_CALL_MINUTES } from "./ai-usage";
import { providerBudget } from "./provider-budget";
import { localClock } from "./agent/time-context";
import { VOICE_PREFIX } from "./coach-tasks";

// Per-account usage limits on Coach and voice, read from the AI cost ledger
// (lib/ai-usage.ts), the account's Coach messages and its voice calls. Daily
// limits reset at the athlete's local midnight, in the time zone the message
// or call sends, and monthly ones on the first of their local month.
//
// LIMITS_MODE=log, the default, only logs and counts a would-be refusal; the
// owner usage page shows the counts. LIMITS_MODE=enforce refuses: Coach
// replies with the limit's text instead of working, and a voice call doesn't
// start. Manual logging, the offline outbox and Health sync never come here,
// so they are never limited.

export type LimitKey =
  | "coach-messages-day"
  | "spend-day-usd"
  | "spend-month-usd"
  | "spend-turn-usd"
  | "voice-minutes-day";
// A number for each limit: an account's caps, or what it has used.
export type PerLimit = Record<LimitKey, number>;
// The provider's key has run out for everyone; not a per-account limit.
type Limit = LimitKey | "provider";
export type LimitCheck =
  "turn-start" | "round" | "voice-start" | "voice-resume";

// Placeholders until calibrated from the ledger: about three times the 95th
// percentile account. The owner gets higher caps but is still recorded.
export const DEFAULT_CAPS: PerLimit = {
  "coach-messages-day": 150,
  "spend-day-usd": 1,
  "spend-month-usd": 15,
  "spend-turn-usd": 0.25,
  "voice-minutes-day": 60,
};
export const OWNER_CAPS: PerLimit = {
  "coach-messages-day": 500,
  "spend-day-usd": 10,
  "spend-month-usd": 100,
  "spend-turn-usd": 1,
  "voice-minutes-day": 240,
};

const COACH_DAY =
  "That's today's Coach limit; it resets at midnight. Logging in Train and Food still works.";
// What the athlete sees instead, as Coach's reply or the voice call's error.
export const LIMIT_REPLIES: Record<Limit, string> = {
  provider:
    "Coach is paused for everyone right now. Logging in Train and Food still works.",
  "coach-messages-day": COACH_DAY,
  "spend-day-usd": COACH_DAY,
  "spend-month-usd":
    "That's this month's Coach limit; it resets on the 1st. Logging in Train and Food still works.",
  "spend-turn-usd":
    "That needed more steps than one reply allows, so I stopped here. Ask about one part at a time.",
  "voice-minutes-day":
    "Voice time for today is used up; it resets at midnight.",
};

export function limitsMode(): "log" | "enforce" {
  return process.env.LIMITS_MODE?.trim() === "enforce" ? "enforce" : "log";
}

// How far a time zone's clock is ahead of UTC at an instant, in ms.
function offsetAt(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

// The instant a local date began in a time zone. Worked out twice, for a
// day on which the clocks change.
function localMidnight(date: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - offsetAt(wall, timezone);
  return new Date(wall - offsetAt(first, timezone));
}

// When the athlete's day and month began, in their time zone.
export function localPeriods(timezone: string, now = new Date()) {
  const { date } = localClock(now, timezone);
  return {
    day: localMidnight(date, timezone),
    month: localMidnight(`${date.slice(0, 8)}01`, timezone),
  };
}

// An account's caps: the owner's or everyone's, then any value set for it
// in user_limits. A value for an unknown limit, or not a number, is ignored.
export function capsWith(
  owner: boolean,
  overrides: { key: string; value: number }[],
): PerLimit {
  const caps = { ...(owner ? OWNER_CAPS : DEFAULT_CAPS) };
  for (const { key, value } of overrides)
    if (Object.hasOwn(caps, key) && Number.isFinite(value) && value >= 0)
      caps[key as LimitKey] = value;
  return caps;
}

async function capsFor(userId: string) {
  const rows = await getDb()
    .select({
      email: user.email,
      key: userLimits.key,
      value: userLimits.value,
    })
    .from(user)
    .leftJoin(userLimits, eq(userLimits.userId, user.id))
    .where(eq(user.id, userId));
  return capsWith(
    isOwnerEmail(rows[0]?.email ?? ""),
    rows.flatMap((r) =>
      r.key !== null && r.value !== null
        ? [{ key: r.key, value: r.value }]
        : [],
    ),
  );
}

// What the account has used today and this month, and on one Coach turn.
// Coach messages leave out this turn, ones a limit refused and saves from a
// voice call; voice minutes are each call's, up to the 30-minute cap.
const usageQuery = `
SELECT
  (SELECT count(*)::int FROM agent_turns
    WHERE user_id = $1 AND created_at >= $2 AND id IS DISTINCT FROM $4
      AND status <> 'limited' AND NOT starts_with(question, $5)
  ) AS "coach-messages-day",
  (SELECT coalesce(sum(cost_usd), 0)::float8 FROM ai_usage
    WHERE user_id = $1 AND created_at >= $2) AS "spend-day-usd",
  (SELECT coalesce(sum(cost_usd), 0)::float8 FROM ai_usage
    WHERE user_id = $1 AND created_at >= $3) AS "spend-month-usd",
  (SELECT coalesce(sum(cost_usd), 0)::float8 FROM ai_usage
    WHERE user_id = $1 AND source_id = $4) AS "spend-turn-usd",
  (SELECT coalesce(sum(least(
      extract(epoch FROM updated_at - started_at) / 60, $6)), 0)::float8
    FROM voice_calls WHERE user_id = $1 AND started_at >= $2
  ) AS "voice-minutes-day"`;

export async function usageFor(
  userId: string,
  timezone: string,
  turnId: string | null,
  now = new Date(),
): Promise<PerLimit> {
  const { day, month } = localPeriods(timezone, now);
  const { rows } = await getPool().query<PerLimit>(usageQuery, [
    userId,
    day,
    month,
    turnId,
    VOICE_PREFIX,
    MAX_CALL_MINUTES,
  ]);
  return rows[0];
}

// The limits among keys that the usage has reached, in the order given.
// Coach messages count the ones before this one, so the cap-th is the last
// allowed; spend and minutes are refused once they reach the cap.
export function reachedLimits(
  usage: PerLimit,
  caps: PerLimit,
  keys: readonly LimitKey[],
) {
  return keys.filter((key) => usage[key] >= caps[key]);
}

// One line per limit reached, with no content, and a count for the owner
// usage page (lib/usage-report.ts). True when the limit refuses.
async function reached(userId: string, limit: Limit, check: LimitCheck) {
  const mode = limitsMode();
  console.info(
    JSON.stringify({
      event: "usage_limit",
      mode,
      limit,
      check,
      account: userId.slice(0, 8),
    }),
  );
  await countUse(userId, `limit.${mode}.${limit}`);
  return mode === "enforce";
}

// A failed check is logged with the PostgreSQL code only, and lets the work
// go ahead: a limit is never a reason for an outage.
function failed(check: LimitCheck, error: unknown) {
  const code =
    (error as { cause?: { code?: unknown } }).cause?.code ??
    (error as { code?: unknown }).code;
  console.warn(
    JSON.stringify({
      event: "usage_limit_failed",
      check,
      code: typeof code === "string" ? code : undefined,
    }),
  );
}

// Reports each limit reached once, and returns the reply of the first one
// that refuses.
async function report(
  userId: string,
  limits: Limit[],
  check: LimitCheck,
  seen: Set<Limit>,
) {
  let reply: string | undefined;
  for (const limit of limits) {
    if (seen.has(limit)) continue;
    seen.add(limit);
    if ((await reached(userId, limit, check)) && !reply)
      reply = LIMIT_REPLIES[limit];
  }
  return reply;
}

const START_LIMITS = [
  "coach-messages-day",
  "spend-day-usd",
  "spend-month-usd",
] as const;
const ROUND_LIMITS = [
  "spend-turn-usd",
  "spend-day-usd",
  "spend-month-usd",
] as const;

// The checks for one Coach turn. Each returns the reply Coach gives instead
// when a limit refuses, or nothing to go on. A limit is logged once a turn.
export function coachLimits(
  userId: string,
  turn: {
    id: string;
    timezone: string;
    // Whether the turn uses the configured provider, whose key can run out
    // (not a model passed in by a test or an eval).
    provider: boolean;
  },
) {
  const seen = new Set<Limit>();
  let caps: Promise<PerLimit> | undefined;
  return {
    // Before the turn's first paid call.
    async start(now = new Date()) {
      try {
        const [budget, usage, limits] = await Promise.all([
          turn.provider ? providerBudget() : undefined,
          usageFor(userId, turn.timezone, turn.id, now),
          (caps ??= capsFor(userId)),
        ]);
        return await report(
          userId,
          [
            ...(budget === "exhausted" ? ["provider" as const] : []),
            ...reachedLimits(usage, limits, START_LIMITS),
          ],
          "turn-start",
          seen,
        );
      } catch (error) {
        failed("turn-start", error);
      }
    },
    // Between model rounds: the turn, if refused, finishes with what it has.
    async round(now = new Date()) {
      try {
        const [usage, limits] = await Promise.all([
          usageFor(userId, turn.timezone, turn.id, now),
          (caps ??= capsFor(userId)),
        ]);
        return await report(
          userId,
          reachedLimits(usage, limits, ROUND_LIMITS),
          "round",
          seen,
        );
      } catch (error) {
        failed("round", error);
      }
    },
  };
}

// At the start of a voice call and each time it resumes, as resumes run on
// into the day's minutes too. The error to show when they're used up.
export async function voiceLimit(
  userId: string,
  timezone: string,
  check: "voice-start" | "voice-resume",
  now = new Date(),
) {
  try {
    const [usage, caps] = await Promise.all([
      usageFor(userId, timezone, null, now),
      capsFor(userId),
    ]);
    return await report(
      userId,
      reachedLimits(usage, caps, ["voice-minutes-day"]),
      check,
      new Set(),
    );
  } catch (error) {
    failed(check, error);
  }
}
