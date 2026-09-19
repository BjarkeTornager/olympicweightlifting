import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  healthConnections,
  healthImportReceipts,
  journals,
  user,
} from "./db/schema";
import { userAllowed } from "./access";
import { calculateImportedSleep } from "./apple-health";
import { ApiError } from "./agent/http";
import { emptyJournal } from "./domain";
import { journalSchema } from "./model";
import { saveCheckin } from "./health";
import { allowRequest, writeJournal } from "./server";

export const healthTokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function createHealthConnection(userId: string) {
  const token = `lh_${randomBytes(32).toString("base64url")}`;
  await getDb()
    .insert(healthConnections)
    .values({ userId, tokenHash: healthTokenHash(token) })
    .onConflictDoUpdate({
      target: healthConnections.userId,
      set: {
        tokenHash: healthTokenHash(token),
        createdAt: new Date(),
        lastSyncAt: null,
        lastDate: null,
        lastResult: null,
      },
    });
  return token;
}
export async function authorizeHealthImport(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (lh_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new ApiError("A valid sleep-import key is required.", 401);
  const hash = healthTokenHash(token);
  const [row] = await getDb()
    .select({ user })
    .from(healthConnections)
    .innerJoin(user, eq(healthConnections.userId, user.id))
    .where(eq(healthConnections.tokenHash, hash));
  if (!row || !(await userAllowed(row.user)))
    throw new ApiError(
      "This sleep-import key is invalid or disconnected.",
      401,
    );
  if (!(await allowRequest(row.user.id, "health-import", 30)))
    throw new ApiError("Please wait a minute before importing again.", 429);
  return { userId: row.user.id, hash };
}

export async function importSleep(
  userId: string,
  tokenHash: string,
  raw: unknown,
  now = new Date(),
) {
  let sleep: ReturnType<typeof calculateImportedSleep>;
  try {
    sleep = calculateImportedSleep(raw, now);
  } catch (error) {
    throw new ApiError(
      error instanceof Error && error.name !== "ZodError"
        ? error.message
        : "Check the sleep samples, dates and time zone.",
      422,
    );
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        date: sleep.date,
        timezone: sleep.timezone,
        intervals: sleep.intervals,
      }),
    )
    .digest("hex");
  return getDb().transaction(async (tx) => {
    // Disconnect/rotation and import serialize on the same credential row.
    const [connection] = await tx
      .select()
      .from(healthConnections)
      .where(
        and(
          eq(healthConnections.userId, userId),
          eq(healthConnections.tokenHash, tokenHash),
        ),
      )
      .for("update");
    if (!connection)
      throw new ApiError(
        "This sleep-import key was disconnected. Nothing was imported.",
        401,
      );
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
    const existing = state.health.checkins.find((c) => c.date === sleep.date);
    const [receipt] = await tx
      .select()
      .from(healthImportReceipts)
      .where(
        and(
          eq(healthImportReceipts.userId, userId),
          eq(healthImportReceipts.date, sleep.date),
        ),
      );
    let result: "imported" | "updated" | "unchanged" | "preserved";
    // A manual edit, deletion, or older client removing provenance takes priority.
    const stillImported = Boolean(
      receipt &&
      existing?.sleepImport?.digest === receipt.digest &&
      existing.sleepHours === Number(receipt.hours),
    );
    if (
      (receipt && !stillImported) ||
      (!receipt && existing?.sleepHours != null)
    )
      result = "preserved";
    else if (receipt?.digest === digest) result = "unchanged";
    else {
      const checkin = saveCheckin(
        state,
        { date: sleep.date, sleepHours: sleep.hours },
        sleep.date,
      );
      checkin.sleepImport = {
        provider: "apple-health",
        digest,
        start: sleep.start,
        end: sleep.end,
        importedAt: now.toISOString(),
      };
      await writeJournal(
        userId,
        { state, revision: row.revision, mutationId: crypto.randomUUID() },
        tx,
      );
      await tx
        .insert(healthImportReceipts)
        .values({
          userId,
          date: sleep.date,
          digest,
          hours: String(sleep.hours),
        })
        .onConflictDoUpdate({
          target: [healthImportReceipts.userId, healthImportReceipts.date],
          set: { digest, hours: String(sleep.hours) },
        });
      result = receipt ? "updated" : "imported";
    }
    await tx
      .update(healthConnections)
      .set({ lastSyncAt: now, lastDate: sleep.date, lastResult: result })
      .where(eq(healthConnections.userId, userId));
    return {
      result,
      date: sleep.date,
      sleepHours:
        result === "preserved" ? (existing?.sleepHours ?? null) : sleep.hours,
      message:
        result === "preserved"
          ? "Your manual entry or deletion was kept."
          : "Sleep checked successfully.",
    };
  });
}
