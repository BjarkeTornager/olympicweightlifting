import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { aiUsage } from "./db/schema";
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

// One model call, with what the provider reported it served and cost.
// Outside a usage context, such as a unit test, nothing is recorded.
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
