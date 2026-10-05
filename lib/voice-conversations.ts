import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "./db";
import { voiceConversations } from "./db/schema";

// An ElevenLabs conversation id has the shape ElevenLabs gives it.
export const conversationIdPattern = /^[A-Za-z0-9_-]{8,80}$/;

// An ElevenLabs conversation belongs to the account that registered it
// first: the caller's own phone, as the call starts (or with its first photo
// from an app that does not register). Whether it is this account's.
// Registrations older than two days are cleared, as a call lasts minutes.
export async function claimVoiceConversation(
  userId: string,
  conversationId: string,
  callId?: string,
) {
  const db = getDb();
  await db
    .delete(voiceConversations)
    .where(
      and(
        eq(voiceConversations.userId, userId),
        lt(voiceConversations.createdAt, sql`now() - interval '2 days'`),
      ),
    );
  await db
    .insert(voiceConversations)
    .values({ conversationId, userId, callId })
    .onConflictDoNothing();
  const [owner] = await db
    .select({ userId: voiceConversations.userId })
    .from(voiceConversations)
    .where(eq(voiceConversations.conversationId, conversationId));
  return owner?.userId === userId;
}
