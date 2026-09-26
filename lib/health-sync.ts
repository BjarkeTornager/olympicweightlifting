import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import {
  healthImportReceipts,
  healthWorkoutImports,
  journals,
} from "./db/schema";
import { calculateImportedSleep, sleepImportSchema } from "./apple-health";
import {
  applySleepImport,
  saveSleepReceipt,
  type ImportedSleep,
  type SleepImportResult,
} from "./apple-health-store";
import {
  cardioActivitySchema,
  cardioEntrySchema,
  type CardioEntry,
} from "./cardio";
import { emptyJournal } from "./domain";
import { vitalsSchema, type Vitals } from "./health";
import { journalSchema, type JournalState } from "./model";
import { nativeRequests } from "./native-api";
import { foodDate } from "./nutrition";
import { localClock, timeZoneSchema } from "./reminders";
import { writeJournal } from "./server";
import { healthRouteSchema, pruneRoutes, saveRoutes } from "./workout-routes";
import { saveBodyFat } from "./body-composition";

// What the iPhone app reads from Apple Health and sends in one batch: nights
// of sleep samples, daily heart-rate and movement summaries, and workouts.
// The phone does the HealthKit queries; every rule about what is saved, kept
// or left alone lives here, next to the website's own import.
const night = sleepImportSchema
  .omit({ timezone: true })
  .register(nativeRequests, { id: "SleepNight" });
const workoutKinds = [...cardioActivitySchema.options, "strength"] as const;
export const healthWorkoutSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(workoutKinds),
    name: z.string().trim().min(1).max(80),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    durationSeconds: z.number().int().min(1).max(604800),
    distanceKm: z.number().finite().min(0).max(10000).optional(),
    caloriesKcal: z.number().finite().min(0).max(50000).optional(),
    averageHeartRate: z.number().int().min(30).max(300).optional(),
    maxHeartRate: z.number().int().min(30).max(300).optional(),
    elevationGainM: z.number().finite().min(0).max(30000).optional(),
  })
  .strict()
  .register(nativeRequests, { id: "HealthWorkout" });
export const healthDaySchema = vitalsSchema
  .omit({ source: true, updatedAt: true })
  .partial()
  .required({ date: true })
  // The day's latest body fat reading from a smart scale, in percent.
  .extend({ bodyFatPercent: z.number().finite().min(3).max(70).optional() })
  .strict()
  .register(nativeRequests, { id: "HealthDay" });
export const healthSyncSchema = z
  .object({
    timezone: timeZoneSchema,
    sleep: z.array(night).max(31).default([]),
    days: z.array(healthDaySchema).max(62).default([]),
    workouts: z.array(healthWorkoutSchema).max(200).default([]),
    // Workouts Apple Health reports as deleted since the app's last sync.
    deletedWorkoutIds: z.array(z.string().uuid()).max(500).default([]),
    // GPS tracks of workouts, sent once each after the workout itself.
    routes: z.array(healthRouteSchema).max(20).default([]),
  })
  .strict()
  .register(nativeRequests, { id: "HealthSyncRequest" });
export type HealthSyncInput = z.input<typeof healthSyncSchema>;
export type HealthWorkout = z.infer<typeof healthWorkoutSchema>;

export type WorkoutImportResult =
  | "imported"
  | "updated"
  | "matched"
  | "unchanged"
  | "preserved"
  | "removed"
  | "skipped";

const workoutDigest = (w: HealthWorkout) =>
  createHash("sha256").update(JSON.stringify(w)).digest("hex");

// The fields an import sets. If they still match, the athlete has not edited
// the entry since, so a newer version from Apple Health may replace it.
const importedFields = (e: CardioEntry) => ({
  activity: e.activity,
  date: e.date,
  durationSeconds: e.durationSeconds,
  distanceKm: e.distanceKm,
  title: e.title,
  durationType: e.durationType,
  averageHeartRate: e.averageHeartRate,
  maxHeartRate: e.maxHeartRate,
  elevationGainM: e.elevationGainM,
  caloriesKcal: e.caloriesKcal,
  notes: e.notes,
});
export const entryDigest = (e: CardioEntry) =>
  createHash("sha256")
    .update(JSON.stringify(importedFields(e)))
    .digest("hex");

const round = (value: number | undefined, places: number) =>
  value == null ? null : Math.round(value * 10 ** places) / 10 ** places;

export function cardioFromWorkout(
  w: HealthWorkout,
  timezone: string,
  now: Date,
  existing?: CardioEntry,
): CardioEntry {
  const stamp = now.toISOString();
  return cardioEntrySchema.parse({
    id: existing?.id ?? w.id,
    activity: w.kind === "strength" ? "other" : w.kind,
    date: localClock(new Date(w.start), timezone).date,
    durationSeconds: w.durationSeconds,
    distanceKm: round(w.distanceKm, 3),
    title: w.name,
    durationType: "elapsed",
    averageHeartRate: w.averageHeartRate ?? null,
    maxHeartRate:
      w.maxHeartRate != null &&
      w.averageHeartRate != null &&
      w.maxHeartRate < w.averageHeartRate
        ? null
        : (w.maxHeartRate ?? null),
    effort: existing?.effort ?? null,
    elevationGainM: round(w.elevationGainM, 0),
    caloriesKcal: round(w.caloriesKcal, 0),
    notes: "",
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  });
}

// A manual entry for the same activity on the same day with a similar length
// is the same workout: enrich its empty measurements instead of duplicating it.
function manualMatch(
  state: JournalState,
  entry: CardioEntry,
  imported: Set<string>,
) {
  return state.cardio.sessions.find(
    (s) =>
      !imported.has(s.id) &&
      s.date === entry.date &&
      s.activity === entry.activity &&
      Math.abs(s.durationSeconds - entry.durationSeconds) <=
        Math.max(300, entry.durationSeconds * 0.15),
  );
}

type Receipt = typeof healthWorkoutImports.$inferSelect;

export function applyWorkout(
  state: JournalState,
  w: HealthWorkout,
  receipt: Receipt | undefined,
  imported: Set<string>,
  timezone: string,
  now: Date,
): { result: WorkoutImportResult; receipt?: Omit<Receipt, "userId"> } {
  const digest = workoutDigest(w);
  const date = localClock(new Date(w.start), timezone).date;
  if (date > localClock(now, timezone).date) return { result: "skipped" };
  if (receipt) {
    if (receipt.digest === digest) return { result: "unchanged" };
    const current = state.cardio.sessions.find(
      (s) => s.id === receipt.cardioId,
    );
    // Deleted, matched to a manual entry, or edited since: the athlete's version wins.
    if (
      !current ||
      receipt.status !== "imported" ||
      entryDigest(current) !== receipt.entryDigest
    )
      return { result: "preserved" };
    const next = cardioFromWorkout(w, timezone, now, current);
    state.cardio.sessions = state.cardio.sessions.map((s) =>
      s.id === current.id ? next : s,
    );
    return {
      result: "updated",
      receipt: { ...receipt, digest, entryDigest: entryDigest(next) },
    };
  }
  // A strength workout on a day with logged lifting is that session: skip it.
  if (w.kind === "strength" && state.sessions.some((s) => s.date === date))
    return {
      result: "skipped",
      receipt: {
        workoutId: w.id,
        cardioId: null,
        status: "skipped",
        digest,
        entryDigest: null,
        importedAt: now,
      },
    };
  const entry = cardioFromWorkout(w, timezone, now);
  const match = manualMatch(state, entry, imported);
  if (match) {
    const enriched = cardioEntrySchema.parse({
      ...match,
      distanceKm: match.distanceKm ?? entry.distanceKm,
      averageHeartRate: match.averageHeartRate ?? entry.averageHeartRate,
      maxHeartRate:
        match.maxHeartRate ??
        (match.averageHeartRate == null ||
        (entry.maxHeartRate ?? 0) >= match.averageHeartRate
          ? entry.maxHeartRate
          : null),
      elevationGainM: match.elevationGainM ?? entry.elevationGainM,
      caloriesKcal: match.caloriesKcal ?? entry.caloriesKcal,
      updatedAt: now.toISOString(),
    });
    state.cardio.sessions = state.cardio.sessions.map((s) =>
      s.id === match.id ? enriched : s,
    );
    return {
      result: "matched",
      receipt: {
        workoutId: w.id,
        cardioId: match.id,
        status: "matched",
        digest,
        entryDigest: null,
        importedAt: now,
      },
    };
  }
  if (state.cardio.sessions.some((s) => s.id === entry.id))
    entry.id = crypto.randomUUID();
  state.cardio.sessions = [...state.cardio.sessions, entry];
  imported.add(entry.id);
  return {
    result: "imported",
    receipt: {
      workoutId: w.id,
      cardioId: entry.id,
      status: "imported",
      digest,
      entryDigest: entryDigest(entry),
      importedAt: now,
    },
  };
}

// A scale's body fat reading for a day, kept beside anything the athlete
// reported; an unchanged reading writes nothing.
export function applyBodyFatImport(
  state: JournalState,
  day: z.infer<typeof healthDaySchema>,
  today: string,
  now: Date,
) {
  if (day.bodyFatPercent == null) return false;
  const percent = Math.round(day.bodyFatPercent * 10) / 10;
  const previous = state.health.bodyFat?.find(
    (b) => b.date === day.date && b.source === "apple-health",
  );
  if (previous?.percent === percent) return false;
  saveBodyFat(
    state,
    { date: day.date, percent, method: "scale" },
    today,
    "apple-health",
    now,
  );
  return true;
}

// A daily summary replaces the previous one for that date; unchanged values
// do not count as a change, so a repeated sync writes nothing.
export function applyVitals(
  state: JournalState,
  day: z.infer<typeof healthDaySchema>,
  now: Date,
) {
  const previous = state.health.vitals?.find((v) => v.date === day.date);
  const next: Vitals = vitalsSchema.parse({
    date: day.date,
    restingHeartRate: day.restingHeartRate ?? null,
    heartRateVariabilityMs: round(day.heartRateVariabilityMs ?? undefined, 1),
    averageHeartRate: day.averageHeartRate ?? null,
    steps: day.steps ?? null,
    activeEnergyKcal: day.activeEnergyKcal ?? null,
    source: "apple-health",
    updatedAt: now.toISOString(),
  });
  const same =
    previous &&
    JSON.stringify({ ...previous, updatedAt: "" }) ===
      JSON.stringify({ ...next, updatedAt: "" });
  const empty = [
    next.restingHeartRate,
    next.heartRateVariabilityMs,
    next.averageHeartRate,
    next.steps,
    next.activeEnergyKcal,
  ].every((v) => v == null);
  if (same || empty) return false;
  state.health.vitals = [
    ...(state.health.vitals ?? []).filter((v) => v.date !== day.date),
    next,
  ].sort((a, b) => a.date.localeCompare(b.date));
  return true;
}

export async function syncHealth(
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = healthSyncSchema.parse(raw);
  const today = localClock(now, input.timezone).date;
  const nights: ImportedSleep[] = [];
  const sleepErrors: { date: string; error: string }[] = [];
  for (const n of input.sleep) {
    try {
      nights.push(
        calculateImportedSleep({ ...n, timezone: input.timezone }, now),
      );
    } catch (error) {
      sleepErrors.push({
        date: n.date,
        error:
          error instanceof Error && error.name !== "ZodError"
            ? error.message
            : "Check the sleep samples.",
      });
    }
  }
  const days = input.days.filter((d) => foodDate.safeParse(d.date).success);
  return getDb().transaction(async (tx) => {
    await tx
      .insert(journals)
      .values({ userId, state: emptyJournal() })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(journals)
      .where(eq(journals.userId, userId))
      .for("update");
    const state = journalSchema.parse(row.state);
    let changed = false;

    const sleepReceipts = nights.length
      ? await tx
          .select()
          .from(healthImportReceipts)
          .where(
            and(
              eq(healthImportReceipts.userId, userId),
              inArray(
                healthImportReceipts.date,
                nights.map((n) => n.date),
              ),
            ),
          )
      : [];
    const sleep: {
      date: string;
      result: SleepImportResult | "failed";
      hours: number | null;
      error?: string;
    }[] = sleepErrors.map((e) => ({ ...e, result: "failed", hours: null }));
    const newSleepReceipts: { night: ImportedSleep; digest: string }[] = [];
    for (const n of nights) {
      const outcome = applySleepImport(
        state,
        sleepReceipts.find((r) => r.date === n.date),
        n,
        now,
      );
      if (outcome.changed) {
        changed = true;
        newSleepReceipts.push({ night: n, digest: outcome.digest });
      }
      sleep.push({
        date: n.date,
        result: outcome.result,
        hours: outcome.sleepHours,
      });
    }

    let daysUpdated = 0;
    let bodyFatUpdated = 0;
    for (const day of days) {
      if (day.date > today) continue;
      if (applyVitals(state, day, now)) daysUpdated++;
      if (applyBodyFatImport(state, day, today, now)) bodyFatUpdated++;
    }
    if (daysUpdated || bodyFatUpdated) changed = true;

    const ids = [
      ...new Set([
        ...input.workouts.map((w) => w.id),
        ...input.deletedWorkoutIds,
        ...input.routes.map((r) => r.workoutId),
      ]),
    ];
    const receipts = ids.length
      ? await tx
          .select()
          .from(healthWorkoutImports)
          .where(
            and(
              eq(healthWorkoutImports.userId, userId),
              inArray(healthWorkoutImports.workoutId, ids),
            ),
          )
      : [];
    const importedIds = new Set(
      (
        await tx
          .select({ cardioId: healthWorkoutImports.cardioId })
          .from(healthWorkoutImports)
          .where(
            and(
              eq(healthWorkoutImports.userId, userId),
              eq(healthWorkoutImports.status, "imported"),
            ),
          )
      ).flatMap((r) => (r.cardioId ? [r.cardioId] : [])),
    );
    const workouts: { id: string; result: WorkoutImportResult }[] = [];
    const receiptWrites: Omit<Receipt, "userId">[] = [];
    for (const w of [...input.workouts].sort((a, b) =>
      a.start.localeCompare(b.start),
    )) {
      if (input.deletedWorkoutIds.includes(w.id)) continue;
      const outcome = applyWorkout(
        state,
        w,
        receipts.find((r) => r.workoutId === w.id),
        importedIds,
        input.timezone,
        now,
      );
      if (["imported", "updated", "matched"].includes(outcome.result))
        changed = true;
      if (outcome.receipt) receiptWrites.push(outcome.receipt);
      workouts.push({ id: w.id, result: outcome.result });
    }
    // Deleted in Apple Health: remove the entry only if the athlete never changed it.
    for (const id of input.deletedWorkoutIds) {
      const receipt = receipts.find((r) => r.workoutId === id);
      if (!receipt || receipt.status !== "imported") continue;
      const current = state.cardio.sessions.find(
        (s) => s.id === receipt.cardioId,
      );
      if (current && entryDigest(current) === receipt.entryDigest) {
        state.cardio.sessions = state.cardio.sessions.filter(
          (s) => s.id !== current.id,
        );
        changed = true;
      }
      receiptWrites.push({ ...receipt, status: "removed" });
      workouts.push({ id, result: "removed" });
    }

    let revision = row.revision;
    if (changed) {
      state.updatedAt = now.toISOString();
      revision = (
        await writeJournal(
          userId,
          { state, revision: row.revision, mutationId: crypto.randomUUID() },
          tx,
        )
      ).revision;
      for (const { night, digest } of newSleepReceipts)
        await saveSleepReceipt(tx, userId, night, digest);
    }
    for (const receipt of receiptWrites)
      await tx
        .insert(healthWorkoutImports)
        .values({ userId, ...receipt })
        .onConflictDoUpdate({
          target: [healthWorkoutImports.userId, healthWorkoutImports.workoutId],
          set: {
            cardioId: receipt.cardioId,
            status: receipt.status,
            digest: receipt.digest,
            entryDigest: receipt.entryDigest,
            importedAt: receipt.importedAt,
          },
        });
    const routes = await saveRoutes(
      tx,
      userId,
      state,
      input.routes,
      [
        ...receiptWrites,
        ...receipts.filter(
          (r) => !receiptWrites.some((w) => w.workoutId === r.workoutId),
        ),
      ],
      now,
    );
    await pruneRoutes(tx, userId, state, input.deletedWorkoutIds);
    return {
      revision,
      changed,
      sleep: sleep.sort((a, b) => a.date.localeCompare(b.date)),
      daysUpdated,
      bodyFatUpdated,
      workouts,
      routes,
    };
  });
}

// Cardio entries that came from Apple Health, so the app can label them.
export async function importedCardioIds(userId: string) {
  const rows = await getDb()
    .select({ cardioId: healthWorkoutImports.cardioId })
    .from(healthWorkoutImports)
    .where(
      and(
        eq(healthWorkoutImports.userId, userId),
        inArray(healthWorkoutImports.status, ["imported", "matched"]),
      ),
    );
  return new Set(rows.flatMap((r) => (r.cardioId ? [r.cardioId] : [])));
}
