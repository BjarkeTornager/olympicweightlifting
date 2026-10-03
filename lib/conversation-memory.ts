import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "./db";
import { agentProposals, agentTurns, voiceCalls } from "./db/schema";
import { displayMessage, VOICE_PREFIX } from "./coach-tasks";
import type { SavedVisual } from "./coach-visuals";
import { tidyTranscript, withoutLabel } from "./voice-transcript";
import { withoutEmDashes } from "./agent/coach-style";
import { pruneAiUsage, withAiUsage } from "./ai-usage";
import { traced } from "./tracing/spans";
import { callSession } from "./tracing/ids";

// Coach's memory of conversations: typed Coach messages (agent_turns) and
// spoken calls (voice_calls), both private to the account. Search is
// PostgreSQL full-text matching without a dedicated index, which is ample
// for one person's history.

export type Exchange = {
  at: string;
  // A card is one the voice coach put on screen during a call.
  kind: "chat" | "voice" | "card";
  // What the athlete said, and Coach's reply or the call transcript.
  text: string;
};

/** Removes Coach conversation older than 90 days, with the cards and
 * pictures in it, expired proposals (they hold recovery snapshots) and AI
 * cost records older than 13 months. Runs whenever the athlete uses the
 * assistant, typed or by voice. */
export async function pruneConversations(userId: string) {
  const db = getDb();
  await db
    .delete(agentProposals)
    .where(
      and(
        eq(agentProposals.userId, userId),
        lt(agentProposals.expiresAt, new Date()),
      ),
    );
  await db
    .delete(agentTurns)
    .where(
      and(
        eq(agentTurns.userId, userId),
        lt(agentTurns.createdAt, new Date(Date.now() - 90 * 86400000)),
      ),
    );
  await pruneAiUsage(userId);
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const chatText = (question: string, reply: string | undefined) => {
  const { label, text } = displayMessage(question);
  return `Athlete: ${[label, text].filter(Boolean).join(" · ")}\nCoach: ${reply ?? ""}`;
};

// What a card held, so the next call knows what the athlete was shown.
const cardText = (question: string, visuals: SavedVisual[]) =>
  [
    `Athlete: ${displayMessage(question).text}`,
    ...visuals.map(({ content: card }) =>
      [
        `Card shown: ${card.title} (${card.kind})`,
        ...(card.kind === "recipe"
          ? [
              `ingredients: ${card.ingredients.map((i) => [i.amount, i.item].filter(Boolean).join(" ")).join(", ")}`,
            ]
          : []),
      ].join("; "),
    ),
  ].join("\n");

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
  // Coach's lines keep no em dashes, as in typed replies.
  const entries = call.entries.map(coachLine);
  const content = transcriptContent(entries);
  await getDb()
    .insert(voiceCalls)
    .values({
      id: call.id,
      userId,
      purpose: call.purpose,
      transcript: entries,
      content,
    })
    .onConflictDoUpdate({
      target: voiceCalls.id,
      // The database's clock, as for the first save and the tidy stamp, so
      // a call that goes on just after a tidy is never taken as tidied.
      set: { transcript: entries, content, updatedAt: sql`now()` },
      // A call id belongs to the account that started it.
      where: eq(voiceCalls.userId, userId),
    });
}

// Tidies a call's transcript when it has none, or the call went on after
// the last tidy. The tidy text replaces the raw text for Coach's memory and
// search; the raw lines stay in transcript. Traced as voice_tidy
// (lib/tracing), with the call: what started it (the call ending, or the
// Coach thread catching up on a call no app marked as ended), line and
// chunk counts and each chunk's model call, never the transcript.
export async function tidyVoiceCall(
  userId: string,
  id: string,
  tidyWith: typeof tidyTranscript = tidyTranscript,
  trigger: "final" | "catch_up" = "final",
) {
  const db = getDb();
  const [call] = await db
    .select()
    .from(voiceCalls)
    .where(and(eq(voiceCalls.id, id), eq(voiceCalls.userId, userId)));
  if (!call || (call.tidiedAt && call.tidiedAt >= call.updatedAt)) return;
  await traced(
    "voice_tidy",
    { userId, session: () => callSession(userId, id) },
    {
      "lift.trigger": trigger,
      "lift.lines": call.transcript.length,
    },
    async (trace) => {
      const tidy = await withAiUsage(
        { userId, feature: "transcript-tidy", sourceId: id },
        () => tidyWith(call.transcript, undefined, trace),
      );
      trace.set({ "lift.ok": Boolean(tidy) });
      if (!tidy) return;
      await db
        .update(voiceCalls)
        // Stamped with the version it tidied, so it's current until a new save.
        .set({
          tidy,
          tidiedAt: sql`${voiceCalls.updatedAt}`,
          content: transcriptContent(tidy),
        })
        .where(
          and(
            eq(voiceCalls.id, id),
            eq(voiceCalls.userId, userId),
            // Not if the call was saved again meanwhile: that needs a new tidy.
            // PostgreSQL keeps microseconds; the Date read back has milliseconds.
            sql`date_trunc('milliseconds', ${voiceCalls.updatedAt}) = ${call.updatedAt}`,
          ),
        );
    },
  );
}

export type VoiceCallSummary = {
  id: string;
  purpose: string;
  startedAt: string;
  endedAt: string;
  // Tidy lines when current, otherwise what was transcribed live.
  lines: { role: "you" | "coach"; text: string }[];
  tidied: boolean;
};

const coachLine = <T extends { role: string; text: string }>(line: T): T =>
  line.role === "coach" ? { ...line, text: withoutEmDashes(line.text) } : line;

// The account's recent calls, newest last, for the Coach thread.
export async function listVoiceCalls(
  userId: string,
  { since, limit = 30 }: { since: Date; limit?: number },
): Promise<VoiceCallSummary[]> {
  const rows = await getDb()
    .select()
    .from(voiceCalls)
    .where(and(eq(voiceCalls.userId, userId), gte(voiceCalls.startedAt, since)))
    .orderBy(desc(voiceCalls.startedAt))
    .limit(limit);
  return rows.reverse().map((c) => {
    const tidied = Boolean(c.tidy && c.tidiedAt && c.tidiedAt >= c.updatedAt);
    return {
      id: c.id,
      purpose: c.purpose,
      startedAt: c.startedAt.toISOString(),
      endedAt: c.updatedAt.toISOString(),
      // Calls tidied before labels were stripped may still carry them.
      lines: (tidied
        ? c.tidy!.map((l, i) => ({
            ...l,
            text: withoutLabel(l.text, c.transcript[i]?.text ?? ""),
          }))
        : c.transcript
      ).map(coachLine),
      tidied,
    };
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
      .orderBy(desc(agentTurns.createdAt), desc(agentTurns.startedAt))
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
    ...chats.flatMap((t): Exchange[] => {
      const at = t.createdAt.toISOString();
      if (!t.question.startsWith(VOICE_PREFIX))
        return [
          {
            at,
            kind: "chat",
            text: clip(chatText(t.question, t.response?.reply), 1500),
          },
        ];
      // Saves from a voice call are part of that call's transcript; a card
      // it showed is not, so it is remembered here.
      const visuals = t.response?.visuals ?? [];
      return visuals.length
        ? [
            {
              at,
              kind: "card",
              text: clip(cardText(t.question, visuals), 1500),
            },
          ]
        : [];
    }),
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
