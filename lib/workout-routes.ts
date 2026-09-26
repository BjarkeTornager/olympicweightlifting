import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { healthWorkoutImports, healthWorkoutRoutes } from "./db/schema";
import type { JournalState } from "./model";
import type { JournalTransaction } from "./server";
import { nativeRequests } from "./native-api";
import {
  isLoop,
  pathKm,
  type Point,
  type RecordedRoute,
  type RouteNote,
} from "./route-summary";

// The GPS track of a workout from Apple Health. The phone simplifies it to at
// most 200 points and names the start, end and farthest point with Apple
// Maps, so place lookups never leave the device from here.
const place = z.string().trim().min(1).max(120);
const clean = (s?: string) =>
  s?.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim() || null;
export const healthRouteSchema = z
  .object({
    workoutId: z.string().uuid(),
    // Latitude and longitude pairs, in the order they were recorded.
    path: z.array(z.array(z.number().finite()).length(2)).min(2).max(200),
    startPlace: place.optional(),
    endPlace: place.optional(),
    farthestPlace: place.optional(),
  })
  .strict()
  .superRefine((route, ctx) => {
    if (
      route.path.some(
        ([lat, lng]) => Math.abs(lat!) > 90 || Math.abs(lng!) > 180,
      )
    )
      ctx.addIssue({ code: "custom", message: "Check the route coordinates." });
  })
  .register(nativeRequests, { id: "HealthRoute" });
export type HealthRoute = z.infer<typeof healthRouteSchema>;

export type RouteImportResult = "saved" | "unchanged" | "skipped" | "pending";

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
type Receipt = Pick<
  typeof healthWorkoutImports.$inferSelect,
  "workoutId" | "cardioId" | "status"
>;

// Store each route against the journal entry its workout became. A route
// whose workout has not been imported yet is reported as pending, so the
// phone sends it again with a later sync.
export async function saveRoutes(
  tx: JournalTransaction,
  userId: string,
  state: JournalState,
  routes: HealthRoute[],
  receipts: Receipt[],
  now: Date,
) {
  const results: { workoutId: string; result: RouteImportResult }[] = [];
  if (!routes.length) return results;
  const entries = new Set(state.cardio.sessions.map((s) => s.id));
  const stored = await tx
    .select({
      workoutId: healthWorkoutRoutes.workoutId,
      digest: healthWorkoutRoutes.digest,
    })
    .from(healthWorkoutRoutes)
    .where(
      and(
        eq(healthWorkoutRoutes.userId, userId),
        inArray(
          healthWorkoutRoutes.workoutId,
          routes.map((r) => r.workoutId),
        ),
      ),
    );
  for (const route of routes) {
    const receipt = receipts.find((r) => r.workoutId === route.workoutId);
    if (!receipt) {
      results.push({ workoutId: route.workoutId, result: "pending" });
      continue;
    }
    if (
      !["imported", "matched"].includes(receipt.status) ||
      !receipt.cardioId ||
      !entries.has(receipt.cardioId)
    ) {
      results.push({ workoutId: route.workoutId, result: "skipped" });
      continue;
    }
    const path = route.path.map(([lat, lng]) => [
      round5(lat!),
      round5(lng!),
    ]) as Point[];
    const values = {
      cardioId: receipt.cardioId,
      path,
      distanceKm: pathKm(path),
      startPlace: clean(route.startPlace),
      endPlace: clean(route.endPlace),
      farthestPlace: clean(route.farthestPlace),
    };
    const digest = createHash("sha256")
      .update(JSON.stringify(values))
      .digest("hex");
    if (
      stored.find((s) => s.workoutId === route.workoutId)?.digest === digest
    ) {
      results.push({ workoutId: route.workoutId, result: "unchanged" });
      continue;
    }
    await tx
      .insert(healthWorkoutRoutes)
      .values({
        userId,
        workoutId: route.workoutId,
        ...values,
        digest,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [healthWorkoutRoutes.userId, healthWorkoutRoutes.workoutId],
        set: { ...values, digest, updatedAt: now },
      });
    results.push({ workoutId: route.workoutId, result: "saved" });
  }
  return results;
}

// A workout deleted in Apple Health, or a journal entry deleted since,
// takes its route with it.
export async function pruneRoutes(
  tx: JournalTransaction,
  userId: string,
  state: JournalState,
  deletedWorkoutIds: string[],
) {
  const entries = new Set(state.cardio.sessions.map((s) => s.id));
  const rows = await tx
    .select({
      workoutId: healthWorkoutRoutes.workoutId,
      cardioId: healthWorkoutRoutes.cardioId,
    })
    .from(healthWorkoutRoutes)
    .where(eq(healthWorkoutRoutes.userId, userId));
  const gone = rows
    .filter(
      (r) =>
        deletedWorkoutIds.includes(r.workoutId) || !entries.has(r.cardioId),
    )
    .map((r) => r.workoutId);
  if (gone.length)
    await tx
      .delete(healthWorkoutRoutes)
      .where(
        and(
          eq(healthWorkoutRoutes.userId, userId),
          inArray(healthWorkoutRoutes.workoutId, gone),
        ),
      );
  return gone.length;
}

async function rows(userId: string, state: JournalState, cardioIds: string[]) {
  const entries = new Set(state.cardio.sessions.map((s) => s.id));
  const wanted = [...new Set(cardioIds)].filter((id) => entries.has(id));
  if (!wanted.length) return [];
  return getDb()
    .select()
    .from(healthWorkoutRoutes)
    .where(
      and(
        eq(healthWorkoutRoutes.userId, userId),
        inArray(healthWorkoutRoutes.cardioId, wanted),
      ),
    );
}

// Place names and shape of each recorded route, for the coaches. Never the
// coordinates: a model does not need them to talk about a walk.
export async function routeNotes(
  userId: string,
  state: JournalState,
  cardioIds: string[],
) {
  const notes = new Map<string, RouteNote>();
  for (const r of await rows(userId, state, cardioIds)) {
    const loop = isLoop(r.path);
    notes.set(r.cardioId, {
      start: r.startPlace ?? undefined,
      end: loop ? undefined : (r.endPlace ?? undefined),
      farthest_point: r.farthestPlace ?? undefined,
      loop,
      route_km: r.distanceKm,
    });
  }
  return notes;
}

// Route notes for every entry in a date range. A coach still answers if the
// routes cannot be read; it just does not mention them.
export async function routeNotesFor(
  userId: string,
  state: JournalState,
  from: string,
  to: string,
) {
  try {
    return await routeNotes(
      userId,
      state,
      state.cardio.sessions
        .filter((s) => s.date >= from && s.date <= to)
        .map((s) => s.id),
    );
  } catch (error) {
    console.error("Workout routes could not be read", error);
    return new Map<string, RouteNote>();
  }
}

export async function recordedRoute(
  userId: string,
  state: JournalState,
  cardioId: string,
): Promise<RecordedRoute | null> {
  const [r] = await rows(userId, state, [cardioId]);
  return r
    ? {
        path: r.path,
        distanceKm: r.distanceKm,
        startPlace: r.startPlace,
        endPlace: r.endPlace,
        farthestPlace: r.farthestPlace,
        loop: isLoop(r.path),
      }
    : null;
}

// Journal entries with a recorded route, so the app can offer the map.
export async function routedCardioIds(userId: string, state: JournalState) {
  const entries = new Set(state.cardio.sessions.map((s) => s.id));
  const found = await getDb()
    .select({ cardioId: healthWorkoutRoutes.cardioId })
    .from(healthWorkoutRoutes)
    .where(eq(healthWorkoutRoutes.userId, userId));
  return new Set(found.map((r) => r.cardioId).filter((id) => entries.has(id)));
}
