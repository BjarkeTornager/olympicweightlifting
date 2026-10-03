import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { getDb } from "./db";
import { aiUsage, voiceCalls } from "./db/schema";
import type { ModelUsage } from "./agent/provider";

// The AI cost ledger: one row per paid AI call, charged to the account it was
// for. Model calls are recorded where the provider's reply is read
// (lib/agent/provider.ts), with the cost the provider reported. Jev routing
// and Exa searches are charged a fixed price per request, and voice calls an
// estimate from their minutes. Counts, models and costs only: never what was
// said, asked or shown.

export type AiFeature =
  | "coach"
  | "routing"
  | "image-tag"
  | "video"
  | "transcript-tidy"
  | "web-search"
  | "voice-gemini"
  | "voice-elevenlabs";
export type UsageContext = {
  userId: string;
  feature: AiFeature;
  // The Coach turn, image, video or call the work is for.
  sourceId?: string;
};

const context = new AsyncLocalStorage<UsageContext>();

// Charges the AI calls made while fn runs to this account and feature. Call
// sites set it once, so the functions in between need no new parameters.
export function withAiUsage<T>(usage: UsageContext, fn: () => T): T {
  return context.run(usage, fn);
}

// List prices for calls the provider doesn't price one by one, in US
// dollars. Set in the environment when a price changes.
function price(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : fallback;
}
export function aiPrices() {
  return {
    // About 2,000 input tokens at Jev's listed rate, rounded up
    // (docs/jev-assessment-2026-09-19.md).
    jevRequest: price("AI_PRICE_JEV_REQUEST", 0.0001),
    // A search plus page text for five results, at Exa's list prices.
    exaSearch: price("AI_PRICE_EXA_SEARCH", 0.01),
    // Per minute of call (docs/voice-elevenlabs-2026-09-30.md).
    geminiVoiceMinute: price("AI_PRICE_VOICE_GEMINI_MINUTE", 0.023),
    elevenLabsVoiceMinute: price("AI_PRICE_VOICE_ELEVENLABS_MINUTE", 0.08),
  };
}

const usd = (n: number) => Math.round(Math.max(0, n) * 1e6) / 1e6;
const tokens = (n: number | undefined) =>
  n === undefined ? null : Math.round(n);

// A failed write is logged with the PostgreSQL code only.
function failed(feature: string, error: unknown) {
  // Drizzle wraps the PostgreSQL error, which carries the code.
  const code =
    (error as { cause?: { code?: unknown } }).cause?.code ??
    (error as { code?: unknown }).code;
  console.warn(
    JSON.stringify({
      event: "ai_usage_failed",
      feature,
      code: typeof code === "string" ? code : undefined,
    }),
  );
}

type Row = {
  feature: AiFeature;
  model: string;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  estimated?: boolean;
  createdAt?: Date;
};

// Awaited, so the row is there before the next step reads the ledger. A
// failed write is logged without account data and never fails the call that
// was already paid for.
async function record(usage: UsageContext, row: Row) {
  try {
    await getDb()
      .insert(aiUsage)
      .values({
        id: randomUUID(),
        userId: usage.userId,
        sourceId: usage.sourceId ?? null,
        feature: row.feature,
        model: row.model.slice(0, 200),
        inputTokens: tokens(row.inputTokens),
        outputTokens: tokens(row.outputTokens),
        costUsd: usd(row.costUsd),
        estimated: row.estimated ?? false,
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      });
  } catch (error) {
    failed(row.feature, error);
  }
}

// One model call, with what the provider reported it served and cost. A
// call that ended before its cost was reported (stopped, timed out or cut
// short) is recorded at no cost and marked estimated. Outside a usage
// context, such as a unit test, nothing is recorded.
export async function recordModelCall(
  served: ModelUsage | undefined,
  model: string,
) {
  const usage = context.getStore();
  if (!usage) return;
  await record(usage, {
    feature: usage.feature,
    model: served?.model ?? model,
    inputTokens: served?.inputTokens,
    outputTokens: served?.outputTokens,
    costUsd: served?.costUsd ?? 0,
    estimated: served?.costUsd === undefined,
  });
}

// One request at a fixed price, charged to the work it was made for: Jev
// routing or an Exa search inside a Coach turn.
export async function recordFixedPrice(
  feature: "routing" | "web-search",
  model: string,
  costUsd: number,
) {
  const usage = context.getStore();
  if (!usage) return;
  await record(usage, { feature, model, costUsd });
}

export type VoiceProvider = "google" | "elevenlabs";
const voiceFeatures = ["voice-gemini", "voice-elevenlabs"] as const;
const voiceRate = (feature: string) =>
  feature === "voice-elevenlabs"
    ? aiPrices().elevenLabsVoiceMinute
    : aiPrices().geminiVoiceMinute;

// A voice connection has opened: a fresh call, or a reconnect without a
// resumption handle. Its row is costed when the call ends.
export async function recordVoiceStart(
  userId: string,
  provider: VoiceProvider,
  model: string,
  now = new Date(),
) {
  const feature = provider === "google" ? "voice-gemini" : "voice-elevenlabs";
  await record(
    { userId, feature },
    { feature, model, costUsd: 0, estimated: true, createdAt: now },
  );
}

// A voice connection opened this long before the call's first saved line
// belongs to the call.
const VOICE_START_SLACK_MS = 5 * 60000;
// The phone ends a call after 30 minutes, so an end that arrives later (the
// app was suspended mid-call) is not charged beyond that.
const MAX_CALL_MINUTES = 30;

// The call has ended. Each connection opened for it is costed at its
// provider's rate, for the minutes from its start to the next connection or
// the end of the call, and linked to the call. A repeated end changes nothing.
export async function recordVoiceEnd(
  userId: string,
  callId: string,
  now = new Date(),
) {
  try {
    await getDb().transaction(async (tx) => {
      const [call] = await tx
        .select({ startedAt: voiceCalls.startedAt })
        .from(voiceCalls)
        .where(and(eq(voiceCalls.id, callId), eq(voiceCalls.userId, userId)));
      if (!call) return;
      const open = await tx
        .select({
          id: aiUsage.id,
          feature: aiUsage.feature,
          at: aiUsage.createdAt,
        })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userId, userId),
            inArray(aiUsage.feature, [...voiceFeatures]),
            isNull(aiUsage.sourceId),
            gte(
              aiUsage.createdAt,
              new Date(call.startedAt.getTime() - VOICE_START_SLACK_MS),
            ),
            lte(aiUsage.createdAt, now),
          ),
        )
        .orderBy(asc(aiUsage.createdAt))
        .for("update");
      for (const [i, row] of open.entries()) {
        const end = open[i + 1]?.at ?? now;
        const minutes = Math.min(
          MAX_CALL_MINUTES,
          Math.max(0, end.getTime() - row.at.getTime()) / 60000,
        );
        await tx
          .update(aiUsage)
          .set({
            sourceId: callId,
            costUsd: usd(minutes * voiceRate(row.feature)),
          })
          .where(eq(aiUsage.id, row.id));
      }
    });
  } catch (error) {
    failed("voice", error);
  }
}
