import { getPool } from "./db";
import { utcDay } from "./feature-use";

// The owner's usage page: the main measure and retention from
// docs/product-principles.md, and per-feature counts. Only totals and
// averages leave this module, never a person's records or identity.

export type RecordedDates = {
  sleep: string[];
  food: string[];
  movement: string[];
  // Drinks, supplements, check-ins and body fat: recorded, but not the main measure.
  other: string[];
};
export type FeatureRow = {
  userId: string;
  feature: string;
  day: string;
  count: number;
};
export type UsageReport = {
  generatedAt: string;
  people: { total: number; active7: number; active28: number };
  // Most recent first. A week runs Monday to Sunday (UTC); the first is in progress.
  weeks: {
    start: string;
    active: number;
    // Per active person: days with sleep, food and movement all recorded…
    fullDays: number;
    // …and days with anything recorded.
    anyDays: number;
  }[];
  // People by the week they joined (last twelve weeks), and how many still
  // recorded something in their fourth week (days 21–27). Null until it's over.
  retention: { week: string; joined: number; week4: number | null }[];
  // The last 28 days, most-used first.
  features: { feature: string; people: number; uses: number; last: string }[];
};

const DAY = 86400000;
const WEEKS = 8;

const addDays = (day: string, n: number) =>
  utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));

export function weekStart(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function usageReport(
  people: { id: string; joined: string }[],
  recorded: Map<string, RecordedDates>,
  features: FeatureRow[],
  now = new Date(),
): UsageReport {
  const today = utcDay(now);
  // Days on which each person recorded something, and recorded everything.
  const any = new Map<string, Set<string>>(),
    full = new Map<string, Set<string>>();
  for (const [userId, dates] of recorded) {
    const sleep = new Set(dates.sleep),
      food = new Set(dates.food),
      movement = new Set(dates.movement);
    any.set(userId, new Set([...sleep, ...food, ...movement, ...dates.other]));
    full.set(
      userId,
      new Set([...sleep].filter((d) => food.has(d) && movement.has(d))),
    );
  }
  // Days on which each person used any feature, recorded or not.
  const used = new Map<string, Set<string>>();
  for (const row of features)
    used.set(row.userId, (used.get(row.userId) ?? new Set()).add(row.day));
  const activeBetween = (userId: string, from: string, to: string) =>
    [any.get(userId), used.get(userId)].some((days) =>
      [...(days ?? [])].some((d) => d >= from && d <= to),
    );
  const countIn = (days: Set<string> | undefined, from: string, to: string) =>
    [...(days ?? [])].filter((d) => d >= from && d <= to).length;
  const round = (n: number) => Math.round(n * 10) / 10;

  const weeks: UsageReport["weeks"] = [];
  for (let i = 0; i < WEEKS; i++) {
    const start = addDays(weekStart(today), -7 * i),
      end = addDays(start, 6);
    const active = people.filter((p) => activeBetween(p.id, start, end));
    weeks.push({
      start,
      active: active.length,
      fullDays: active.length
        ? round(
            active.reduce(
              (t, p) => t + countIn(full.get(p.id), start, end),
              0,
            ) / active.length,
          )
        : 0,
      anyDays: active.length
        ? round(
            active.reduce((t, p) => t + countIn(any.get(p.id), start, end), 0) /
              active.length,
          )
        : 0,
    });
  }

  // Twelve weeks of cohorts, so eight have finished their fourth week.
  const retention: UsageReport["retention"] = [];
  for (let i = 0; i < WEEKS + 4; i++) {
    const week = addDays(weekStart(today), -7 * i);
    const joined = people.filter((p) => weekStart(p.joined) === week);
    if (!joined.length) continue;
    const over = joined.every((p) => addDays(p.joined, 27) < today);
    retention.push({
      week,
      joined: joined.length,
      week4: over
        ? joined.filter((p) =>
            activeBetween(p.id, addDays(p.joined, 21), addDays(p.joined, 27)),
          ).length
        : null,
    });
  }

  const since = addDays(today, -27);
  const byFeature = new Map<
    string,
    { people: Set<string>; uses: number; last: string }
  >();
  for (const row of features) {
    if (row.day < since) continue;
    const entry = byFeature.get(row.feature) ?? {
      people: new Set<string>(),
      uses: 0,
      last: row.day,
    };
    entry.people.add(row.userId);
    entry.uses += row.count;
    if (row.day > entry.last) entry.last = row.day;
    byFeature.set(row.feature, entry);
  }

  return {
    generatedAt: now.toISOString(),
    people: {
      total: people.length,
      active7: people.filter((p) =>
        activeBetween(p.id, addDays(today, -6), today),
      ).length,
      active28: people.filter((p) => activeBetween(p.id, since, today)).length,
    },
    weeks,
    retention,
    features: [...byFeature]
      .map(([feature, e]) => ({
        feature,
        people: e.people.size,
        uses: e.uses,
        last: e.last,
      }))
      .sort(
        (a, b) =>
          b.people - a.people ||
          b.uses - a.uses ||
          a.feature.localeCompare(b.feature),
      ),
  };
}

// Dates only, projected in PostgreSQL so journals never leave the database.
const recordedDatesQuery = `
SELECT j.user_id AS "userId",
  ARRAY(
    SELECT DISTINCT c->>'date'
    FROM jsonb_array_elements(coalesce(j.state->'health'->'checkins', '[]'::jsonb)) c
    WHERE jsonb_typeof(c->'sleepHours') = 'number' AND c->>'date' >= $1
  ) AS sleep,
  ARRAY(
    SELECT DISTINCT m->>'date'
    FROM jsonb_array_elements(coalesce(j.state->'nutrition'->'meals', '[]'::jsonb)) m
    WHERE m->>'date' >= $1
  ) AS food,
  ARRAY(
    SELECT DISTINCT d FROM (
      SELECT s->>'date' AS d
      FROM jsonb_array_elements(coalesce(j.state->'sessions', '[]'::jsonb)) s
      UNION
      SELECT s->>'date'
      FROM jsonb_array_elements(coalesce(j.state->'cardio'->'sessions', '[]'::jsonb)) s
      UNION
      SELECT v->>'date'
      FROM jsonb_array_elements(coalesce(j.state->'health'->'vitals', '[]'::jsonb)) v
      WHERE jsonb_typeof(v->'steps') = 'number' AND (v->>'steps')::numeric > 0
    ) movement
    WHERE d >= $1
  ) AS movement,
  ARRAY(
    SELECT DISTINCT d FROM (
      SELECT x->>'date' AS d
      FROM jsonb_array_elements(coalesce(j.state->'health'->'checkins', '[]'::jsonb)) x
      UNION
      SELECT x->>'date'
      FROM jsonb_array_elements(coalesce(j.state->'health'->'drinks', '[]'::jsonb)) x
      UNION
      SELECT x->>'date'
      FROM jsonb_array_elements(coalesce(j.state->'health'->'supplements', '[]'::jsonb)) x
      UNION
      SELECT x->>'date'
      FROM jsonb_array_elements(coalesce(j.state->'health'->'bodyFat', '[]'::jsonb)) x
    ) other
    WHERE d >= $1
  ) AS other
FROM journals j`;

// Each person's recorded dates since a day, as dates only.
export async function loadRecordedDates(since: string) {
  const { rows } = await getPool().query<RecordedDates & { userId: string }>(
    recordedDatesQuery,
    [since],
  );
  return new Map(rows.map(({ userId, ...dates }) => [userId, dates] as const));
}

export async function loadUsageReport(now = new Date()) {
  const pool = getPool();
  // Eight weeks of weeks and cohorts, plus the four weeks a cohort needs.
  const since = addDays(weekStart(utcDay(now)), -7 * (WEEKS + 4));
  const [people, recorded, features] = await Promise.all([
    pool.query<{ id: string; joined: string }>(
      `SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS joined FROM users`,
    ),
    loadRecordedDates(since),
    pool.query<FeatureRow>(
      `SELECT user_id AS "userId", feature, day::text AS day, count FROM feature_use WHERE day >= $1`,
      [since],
    ),
  ]);
  return usageReport(people.rows, recorded, features.rows, now);
}
