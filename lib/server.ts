import { canonicalJson } from "./json";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  journals,
  mutations,
  workouts,
  workoutExercises,
  workoutSets,
  rateLimits,
} from "./db/schema";
import { emptyJournal } from "./domain";
import { journalSchema, type JournalState, type Snapshot } from "./model";
import { isValidLoggedSet } from "../js/progression.js";
export class RevisionConflict extends Error {
  constructor(public snapshot: Snapshot) {
    super(
      "Another device saved changes. Review both versions before continuing.",
    );
  }
}
export class MutationConflict extends Error {}
export async function readJournal(userId: string): Promise<Snapshot> {
  const db = getDb();
  await db
    .insert(journals)
    .values({ userId, state: emptyJournal() })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(journals)
    .where(eq(journals.userId, userId));
  return { state: journalSchema.parse(row.state), revision: row.revision };
}
export async function writeJournal(
  userId: string,
  input: { state: JournalState; revision: number; mutationId: string },
): Promise<Snapshot> {
  const state = journalSchema.parse(input.state);
  const hash = createHash("sha256")
    .update(canonicalJson({ state, revision: input.revision }))
    .digest("hex");
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
    const [prior] = await tx
      .select()
      .from(mutations)
      .where(
        and(eq(mutations.userId, userId), eq(mutations.id, input.mutationId)),
      );
    if (prior) {
      if (prior.hash !== hash)
        throw new MutationConflict(
          "A save identifier was reused with different content.",
        );
      return { state: row.state, revision: row.revision };
    }
    if (row.revision !== input.revision)
      throw new RevisionConflict({ state: row.state, revision: row.revision });
    const revision = row.revision + 1;
    state.updatedAt = new Date().toISOString();
    // Account-level optimistic concurrency also covers deleted sessions: stale devices
    // must resolve before uploading, so old snapshots cannot resurrect deletions.
    // Keep relational projections in the same transaction as the lossless legacy snapshot.
    const oldById = new Map(row.state.sessions.map((w) => [w.id, w]));
    const removed = row.state.sessions.filter(
      (w) => !state.sessions.some((s) => s.id === w.id),
    );
    const changed = state.sessions.filter(
      (w) => canonicalJson(oldById.get(w.id)) !== canonicalJson(w),
    );
    for (const w of [...removed, ...changed]) {
      await tx
        .delete(workoutSets)
        .where(
          and(eq(workoutSets.userId, userId), eq(workoutSets.workoutId, w.id)),
        );
      await tx
        .delete(workoutExercises)
        .where(
          and(
            eq(workoutExercises.userId, userId),
            eq(workoutExercises.workoutId, w.id),
          ),
        );
      await tx
        .delete(workouts)
        .where(and(eq(workouts.userId, userId), eq(workouts.id, w.id)));
    }
    for (const w of changed) {
      await tx.insert(workouts).values({
        userId,
        id: w.id,
        trainingDate: w.date,
        programDayId: w.programDayId,
        snapshot: w,
      });
      for (const [position, e] of w.exercises.entries()) {
        await tx.insert(workoutExercises).values({
          userId,
          workoutId: w.id,
          id: e.id,
          exerciseId: e.exerciseId,
          position,
          prescription: e.prescribed,
        });
        if (e.sets.length)
          await tx.insert(workoutSets).values(
            e.sets.map((s, position) => ({
              userId,
              workoutId: w.id,
              entryId: e.id,
              id: s.id,
              position,
              weight: s.weight === "" ? null : String(s.weight),
              reps: s.reps === "" ? null : Number(s.reps),
              rpe: s.rpe == null || s.rpe === "" ? null : String(s.rpe),
              result: s.result,
              logged: isValidLoggedSet(s),
            })),
          );
      }
    }
    await tx
      .update(journals)
      .set({ state, revision, updatedAt: new Date() })
      .where(eq(journals.userId, userId));
    await tx
      .insert(mutations)
      .values({ userId, id: input.mutationId, hash, revision });
    return { state, revision };
  });
}
export async function allowRequest(userId: string): Promise<boolean> {
  const key = `journal:${userId}`;
  const [row] = await getDb()
    .insert(rateLimits)
    .values({ key, count: 1, expiresAt: new Date(Date.now() + 60000) })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN request_limits.expires_at < now() THEN 1 ELSE request_limits.count + 1 END`,
        expiresAt: sql`CASE WHEN request_limits.expires_at < now() THEN now() + interval '1 minute' ELSE request_limits.expires_at END`,
      },
    })
    .returning();
  return row.count <= 120;
}
