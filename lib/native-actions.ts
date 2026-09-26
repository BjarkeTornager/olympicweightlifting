import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "./agent/http";
import { actionSchema } from "./agent/action-schema";
import { prepareAction } from "./agent/actions";
import { getDb } from "./db";
import { mutations } from "./db/schema";
import { actionRequest } from "./native-api";
import {
  nativeClient,
  nativeSupported,
  nativeUpdateMessage,
} from "./native-client";
import { localClock, timeZoneSchema } from "./reminders";
import {
  MutationConflict,
  readJournal,
  RevisionConflict,
  writeJournal,
} from "./server";

// Every /api/v1 route is for the installed app only, and an unsupported build
// gets a 426 it can show as "update in TestFlight".
export function requireNative(request: Request) {
  const client = nativeClient(request);
  if (!client) throw new ApiError("This endpoint is for the iPhone app.", 400);
  if (!nativeSupported(client)) throw new ApiError(nativeUpdateMessage, 426);
  return client;
}

const saved = async (userId: string, id: string) =>
  (
    await getDb()
      .select({ id: mutations.id })
      .from(mutations)
      .where(and(eq(mutations.userId, userId), eq(mutations.id, id)))
  ).length > 0;

// Apply one action the app queued. The request ID is the save's identity: a
// retry after a lost response, or from the offline queue, is saved once. The
// action applies to the journal as it is now, so a phone that was offline
// never overwrites what another device saved in the meantime.
export async function applyNativeAction(
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = actionRequest.parse(raw);
  const timezone = timeZoneSchema.parse(input.timezone);
  const action = actionSchema.parse(input.action);
  const today = localClock(now, timezone).date;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await saved(userId, input.id)) {
      const { revision } = await readJournal(userId);
      return {
        id: input.id,
        status: "duplicate" as const,
        title: "Already saved",
        detail: "This change was saved earlier.",
        revision,
      };
    }
    const snapshot = await readJournal(userId);
    let prepared: ReturnType<typeof prepareAction>;
    try {
      prepared = prepareAction(snapshot.state, action, today);
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      throw new ApiError(
        error instanceof Error ? error.message : "This change was refused.",
        422,
      );
    }
    try {
      const result = await writeJournal(userId, {
        state: prepared.state,
        revision: snapshot.revision,
        mutationId: input.id,
      });
      return {
        id: input.id,
        status: "saved" as const,
        title: prepared.title,
        detail: prepared.detail,
        revision: result.revision,
      };
    } catch (error) {
      // Another save landed first: prepare again against the newer journal.
      if (error instanceof RevisionConflict) continue;
      // The same ID was saved concurrently: report it as a duplicate.
      if (error instanceof MutationConflict) continue;
      throw error;
    }
  }
  throw new ApiError(
    "Your journal is busy saving other changes. This change is kept and will retry.",
    409,
  );
}
