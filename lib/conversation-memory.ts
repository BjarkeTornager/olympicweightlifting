import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { agentTurns, voiceCalls } from "./db/schema";
import { displayMessage } from "./coach-tasks";

// Coach's memory of conversations: typed Coach messages (agent_turns) and
// spoken calls (voice_calls), both private to the account. Search is
// PostgreSQL full-text matching without a dedicated index, which is ample
// for one person's history.

export type Exchange = {
  at: string;
  kind: "chat" | "voice";
  // What the athlete said, and Coach's reply or the call transcript.
  text: string;
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const chatText = (question: string, reply: string | undefined) => {
  const { label, text } = displayMessage(question);
  return `Athlete: ${[label, text].filter(Boolean).join(" · ")}\nCoach: ${reply ?? ""}`;
};

const voiceText = (transcript: { role: string; text: string }[]) =>
  transcript
    .map((l) => `${l.role === "you" ? "Athlete" : "Coach"}: ${l.text}`)
    .join("\n");

export function transcriptContent(
  transcript: { role: "you" | "coach"; text: string }[],
) {
  return voiceText(transcript);
}

export async function saveVoiceTranscript(
  userId: string,
  call: {
    id: string;
    purpose: string;
    entries: { role: "you" | "coach"; text: string }[];
  },
) {
  const content = transcriptContent(call.entries);
  await getDb()
    .insert(voiceCalls)
    .values({
      id: call.id,
      userId,
      purpose: call.purpose,
      transcript: call.entries,
      content,
    })
    .onConflictDoUpdate({
      target: voiceCalls.id,
      set: { transcript: call.entries, content, updatedAt: new Date() },
      // A call id belongs to the account that started it.
      where: eq(voiceCalls.userId, userId),
    });
}

// Today's conversations and the most recent ones before that, newest last.
export async function recentConversations(
  userId: string,
  { limit = 10, since }: { limit?: number; since?: Date } = {},
): Promise<Exchange[]> {
  const db = getDb();
  const [chats, calls] = await Promise.all([
    db
      .select()
      .from(agentTurns)
      .where(
        and(
          eq(agentTurns.userId, userId),
          eq(agentTurns.status, "done"),
          since ? gte(agentTurns.createdAt, since) : undefined,
        ),
      )
      .orderBy(desc(agentTurns.createdAt))
      .limit(limit),
    db
      .select()
      .from(voiceCalls)
      .where(
        and(
          eq(voiceCalls.userId, userId),
          since ? gte(voiceCalls.startedAt, since) : undefined,
        ),
      )
      .orderBy(desc(voiceCalls.startedAt))
      .limit(limit),
  ]);
  return [
    ...chats
      // Saves from a voice call are part of that call's transcript.
      .filter((t) => !t.question.startsWith("[voice] "))
      .map((t) => ({
        at: t.createdAt.toISOString(),
        kind: "chat" as const,
        text: clip(chatText(t.question, t.response?.reply), 1500),
      })),
    ...calls.map((c) => ({
      at: c.startedAt.toISOString(),
      kind: "voice" as const,
      text: clip(c.content, 3000),
    })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-limit);
}

// Finds earlier conversations about a topic across the whole history.
export async function searchConversations(
  userId: string,
  query: string,
  limit = 8,
): Promise<Exchange[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const db = getDb();
  // "simple" keeps Danish and English words alike; a prefix match also
  // catches word forms ("knees" for "knee").
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .slice(0, 8);
  if (!terms.length) return [];
  const tsquery = terms.map((w) => `${w}:*`).join(" | ");
  const chatDoc = sql`to_tsvector('simple', ${agentTurns.question} || ' ' || coalesce(${agentTurns.response}->>'reply', ''))`;
  const voiceDoc = sql`to_tsvector('simple', ${voiceCalls.content})`;
  const match = sql`to_tsquery('simple', ${tsquery})`;
  const [chats, calls] = await Promise.all([
    db
      .select({
        at: agentTurns.createdAt,
        question: agentTurns.question,
        reply: sql<string | null>`${agentTurns.response}->>'reply'`,
        rank: sql<number>`ts_rank(${chatDoc}, ${match})`,
      })
      .from(agentTurns)
      .where(
        and(
          eq(agentTurns.userId, userId),
          eq(agentTurns.status, "done"),
          sql`${chatDoc} @@ ${match}`,
        ),
      )
      .orderBy(desc(sql`ts_rank(${chatDoc}, ${match})`))
      .limit(limit),
    db
      .select({
        at: voiceCalls.startedAt,
        content: voiceCalls.content,
        headline: sql<string>`ts_headline('simple', ${voiceCalls.content}, ${match}, 'MaxFragments=3, MaxWords=30, MinWords=10, StartSel="", StopSel=""')`,
        rank: sql<number>`ts_rank(${voiceDoc}, ${match})`,
      })
      .from(voiceCalls)
      .where(and(eq(voiceCalls.userId, userId), sql`${voiceDoc} @@ ${match}`))
      .orderBy(desc(sql`ts_rank(${voiceDoc}, ${match})`))
      .limit(limit),
  ]);
  return [
    ...chats.map((c) => ({
      rank: c.rank,
      at: c.at.toISOString(),
      kind: "chat" as const,
      text: clip(chatText(c.question, c.reply ?? undefined), 1200),
    })),
    ...calls.map((c) => ({
      rank: c.rank,
      at: c.at.toISOString(),
      kind: "voice" as const,
      text: clip(c.headline, 1200),
    })),
  ]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ at, kind, text }) => ({ at, kind, text }));
}
