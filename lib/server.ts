import { canonicalJson, jsonEqual } from "./json";
import { cachedJournal, rememberJournal } from "./journal-cache";
import {
  applyJournalPatch,
  diffJournal,
  type JournalPatch,
} from "./journal-patch";
import { retainFoodClassifications } from "./nutrition";
import { createHash } from "node:crypto";
import { and, eq, sql, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  journals,
  mutations,
  workouts,
  workoutExercises,
  workoutSets,
  rateLimits,
  foodPhotos,
} from "./db/schema";
import { emptyJournal } from "./domain";
import { journalSchema, type JournalState, type Snapshot } from "./model";
import { moveCheckinWater, retainDrinkDetails } from "./hydration";
import { isValidLoggedSet } from "../js/progression.js";
export class RevisionConflict extends Error {
  constructor(public snapshot: Snapshot) {
    super(
      "Another device saved changes. Review both versions before continuing.",
    );
  }
}
export class MutationConflict extends Error {}
export class MissingMealPhoto extends Error {}
// A stored journal as the app reads it, with any older check-in water total
// moved into a drink.
const storedJournal = (raw: unknown) =>
  moveCheckinWater(journalSchema.parse(raw));
// Which journal a row holds: its revision and the row's own version, which
// any write changes, also one made outside the app.
const journalVersion = sql<string>`${journals.revision}::text || '.' || ${journals}.xmin::text`;
export type VersionedSnapshot = Snapshot & { version: string };
// The version of an account's journal, without loading it.
export async function currentJournalVersion(userId: string) {
  const [row] = await getDb()
    .select({ version: journalVersion })
    .from(journals)
    .where(eq(journals.userId, userId));
  return row?.version;
}
export async function readJournal(userId: string): Promise<VersionedSnapshot> {
  const db = getDb();
  await db
    .insert(journals)
    .values({ userId, state: emptyJournal() })
    .onConflictDoNothing();
  const [head] = await db
    .select({ revision: journals.revision, version: journalVersion })
    .from(journals)
    .where(eq(journals.userId, userId));
  const cached = cachedJournal(userId, head.version);
  if (cached) return { state: cached, ...head };
  const [row] = await db
    .select({
      state: journals.state,
      revision: journals.revision,
      version: journalVersion,
    })
    .from(journals)
    .where(eq(journals.userId, userId));
  const state = storedJournal(row.state);
  rememberJournal(userId, row.version, state);
  return {
    state: structuredClone(state),
    revision: row.revision,
    version: row.version,
  };
}
// A save is told apart from a retry of itself by this digest of what it
// asks for. Saves recorded before 5 October 2026 used canonicalJson, which
// a retry from then still matches.
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function sameSave(
  recorded: string,
  hash: string,
  state: JournalState,
  revision: number,
) {
  if (recorded === hash) return true;
  if (recorded === digest(canonicalJson({ state, revision }))) return true;
  // A retry may have been acknowledged by the release before cardio existed.
  // Only an empty additive field may be omitted for that legacy hash match.
  if (state.cardio.sessions.length) return false;
  const legacyState = { ...state } as Record<string, unknown>;
  delete legacyState.cardio;
  return recorded === digest(canonicalJson({ state: legacyState, revision }));
}
export type JournalTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];
export async function writeJournal(
  userId: string,
  input: (
    | {
        state: Omit<JournalState, "cardio"> & {
          cardio?: JournalState["cardio"];
        };
      }
    // Or only the changes to the journal as stored at this revision.
    | { patch: JournalPatch }
  ) & {
    revision: number;
    mutationId: string;
    preserveMissingFoodTags?: boolean;
    preserveMissingCoachData?: boolean;
    preserveMissingActivityPhotos?: boolean;
    // An older cached app knows neither alcohol kinds nor estimated volumes.
    preserveDrinkDetails?: boolean;
  },
  transaction?: JournalTransaction,
): Promise<VersionedSnapshot & { fix?: JournalPatch }> {
  const whole = "state" in input ? journalSchema.parse(input.state) : undefined;
  const hash = digest(
    JSON.stringify(
      whole
        ? { state: whole, revision: input.revision }
        : { patch: "patch" in input && input.patch, revision: input.revision },
    ),
  );
  const work = async (tx: JournalTransaction) => {
    await tx
      .insert(journals)
      .values({ userId, state: emptyJournal() })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ revision: journals.revision, version: journalVersion })
      .from(journals)
      .where(eq(journals.userId, userId))
      .for("update");
    // The journal as stored, parsed once for every comparison below.
    const previous =
      cachedJournal(userId, row.version) ??
      storedJournal(
        (
          await tx
            .select({ state: journals.state })
            .from(journals)
            .where(eq(journals.userId, userId))
        )[0].state,
      );
    const [prior] = await tx
      .select()
      .from(mutations)
      .where(
        and(eq(mutations.userId, userId), eq(mutations.id, input.mutationId)),
      );
    if (prior) {
      if (
        whole
          ? !sameSave(prior.hash, hash, whole, input.revision)
          : prior.hash !== hash
      )
        throw new MutationConflict(
          "A save identifier was reused with different content.",
        );
      return { state: previous, ...row };
    }
    if (row.revision !== input.revision)
      throw new RevisionConflict({ state: previous, ...row });
    // The changes made to the journal as stored, when only they came.
    const applied =
      "patch" in input
        ? applyJournalPatch(structuredClone(previous), input.patch)
        : undefined;
    const incoming = "state" in input ? input.state : applied!;
    const state = whole ?? journalSchema.parse(applied);
    // Older cached clients cannot intentionally edit a field they do not know.
    // Keep its current value; an explicit empty collection still means deletion.
    if (incoming.cardio === undefined) state.cardio = previous.cardio;
    // A client from before sleep sources keeps an imported night but not
    // where it came from. The digest covers the source, so an unchanged
    // digest means the same night from the same source.
    for (const checkin of state.health.checkins) {
      const night = checkin.sleepImport;
      const before = previous.health.checkins.find(
        (c) => c.date === checkin.date,
      )?.sleepImport;
      if (
        night &&
        !night.source &&
        before?.source &&
        before.digest === night.digest
      )
        night.source = before.source;
    }
    if (input.preserveMissingCoachData) {
      // Omission by an older client preserves the brief. Explicit null clears it.
      // Agent transactions omit this compatibility flag, so Undo restores absence.
      if (state.profile.lifting === undefined)
        state.profile.lifting = previous.profile.lifting;
      if (previous.profile.coaching) {
        state.profile.coaching ??= { ...previous.profile.coaching };
        state.profile.coaching.memories ??= previous.profile.coaching.memories;
        state.profile.coaching.plans ??= previous.profile.coaching.plans;
      }
      state.nutrition.favourites ??= previous.nutrition.favourites;
      // An app from before drink tracking omits drinks; that is not deletion.
      state.health.drinks ??= previous.health.drinks;
      state.health.supplements ??= previous.health.supplements;
      // Apple Health summaries come only from the iPhone sync.
      state.health.vitals ??= previous.health.vitals;
      state.health.bodyFat ??= previous.health.bodyFat;
      state.health.bodyMass ??= previous.health.bodyMass;
      // A day stays complete while its meals are the same, food tags aside.
      const day = (meals: JournalState["nutrition"]["meals"], date: string) =>
        meals
          .filter((m) => m.date === date)
          .map(({ items, ...meal }) => ({
            ...meal,
            items: items.map(({ classification, ...item }) => {
              void classification;
              return item;
            }),
          }));
      state.nutrition.completeDays ??= previous.nutrition.completeDays?.filter(
        (date) =>
          jsonEqual(
            day(previous.nutrition.meals, date),
            day(state.nutrition.meals, date),
          ),
      );
    }
    const previousMeals = new Map(
      previous.nutrition.meals.map((m) => [m.id, m]),
    );
    try {
      if (input.preserveMissingFoodTags)
        state.nutrition.meals = state.nutrition.meals.map((meal) => ({
          ...meal,
          items: retainFoodClassifications(
            meal.items,
            previousMeals.get(meal.id)?.items ?? [],
            true,
          ),
        }));
    } catch (error) {
      throw new MutationConflict(
        error instanceof Error
          ? error.message
          : "Review food tags before saving.",
      );
    }
    const revision = row.revision + 1;
    // Old clients omit photoIds; explicit [] is the supported unlink operation.
    // They omit where calories came from too: an unchanged figure keeps it.
    state.cardio.sessions = state.cardio.sessions.map((entry) => {
      const before = previous.cardio.sessions.find((s) => s.id === entry.id);
      const kept =
        input.preserveMissingActivityPhotos &&
        entry.photoIds === undefined &&
        before?.photoIds
          ? { ...entry, photoIds: before.photoIds }
          : entry;
      return kept.caloriesSource === undefined &&
        before?.caloriesSource &&
        before.caloriesKcal === kept.caloriesKcal
        ? { ...kept, caloriesSource: before.caloriesSource }
        : kept;
    });
    const activityPhotoIds = [
      ...new Set(state.cardio.sessions.flatMap((s) => s.photoIds ?? [])),
    ];
    if (activityPhotoIds.length) {
      const owned = await tx
        .select({ id: foodPhotos.id, category: foodPhotos.category })
        .from(foodPhotos)
        .where(
          and(
            eq(foodPhotos.userId, userId),
            inArray(foodPhotos.id, activityPhotoIds),
          ),
        );
      if (
        owned.length !== activityPhotoIds.length ||
        owned.some(
          (image) =>
            !["activity", "health", "unclassified"].includes(image.category),
        )
      )
        throw new MissingMealPhoto(
          "An activity photo is unavailable or has the wrong category. Edit the activity and remove the unavailable photo link before syncing.",
        );
      const linked = state.cardio.sessions.flatMap((s) => [
        ...new Set(s.photoIds ?? []),
      ]);
      if (linked.length !== activityPhotoIds.length)
        throw new MutationConflict(
          "An activity photo is already linked to another activity. Update the existing activity instead.",
        );
    }
    const photoIds = [
      ...new Set(state.nutrition.meals.flatMap((m) => m.photoIds)),
    ];
    if (photoIds.length) {
      const owned = await tx
        .select({ id: foodPhotos.id, category: foodPhotos.category })
        .from(foodPhotos)
        .where(
          and(eq(foodPhotos.userId, userId), inArray(foodPhotos.id, photoIds)),
        );
      if (owned.length !== photoIds.length)
        throw new MissingMealPhoto(
          "A meal photo is missing from this account. Edit the meal in Food and remove unavailable photo links before syncing.",
        );
      if (owned.some((image) => image.category !== "food"))
        throw new MissingMealPhoto(
          "Only images categorised as Food can be linked to meals. Correct the category in Images or remove the image link in Food before syncing.",
        );
    }
    if (input.preserveDrinkDetails && state.health.drinks)
      state.health.drinks = retainDrinkDetails(
        state.health.drinks,
        previous.health.drinks ?? [],
      );
    // After the omitted drinks are restored, so a check-in total moves only
    // on a day with no other drinks.
    state.health = moveCheckinWater(state).health;
    state.updatedAt = new Date().toISOString();
    // Account-level optimistic concurrency also covers deleted sessions: stale devices
    // must resolve before uploading, so old snapshots cannot resurrect deletions.
    // Keep relational projections in the same transaction as the lossless legacy snapshot.
    const oldById = new Map(previous.sessions.map((w) => [w.id, w]));
    const kept = new Set(state.sessions.map((s) => s.id));
    const removed = previous.sessions.filter((w) => !kept.has(w.id));
    const changed = state.sessions.filter(
      (w) => !jsonEqual(oldById.get(w.id), w),
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
    const [saved] = await tx
      .update(journals)
      .set({ state, revision, updatedAt: new Date() })
      .where(eq(journals.userId, userId))
      .returning({ version: journalVersion });
    await tx
      .insert(mutations)
      .values({ userId, id: input.mutationId, hash, revision });
    // Kept under the row's new version: if this transaction rolls back, no
    // row ever has that version, so the entry is never read.
    rememberJournal(userId, saved.version, structuredClone(state));
    return {
      state,
      revision,
      version: saved.version,
      // What the server changed in the journal the changes made, such as the
      // time it was saved, so the sender's copy can match it.
      ...(applied ? { fix: diffJournal(applied, state) } : {}),
    };
  };
  return transaction ? work(transaction) : getDb().transaction(work);
}
export async function allowRequest(
  userId: string,
  bucket = "journal",
  limit = 120,
): Promise<boolean> {
  const key = `${bucket}:${userId}`;
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
  return row.count <= limit;
}
