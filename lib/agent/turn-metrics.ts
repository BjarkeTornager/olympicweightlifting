// How long a Coach turn took and what its model calls used: timings, token
// counts and cost only, never message text. Saved on the turn and logged, so
// speed and cost changes can be measured against real use.
import type { ModelUsage } from "./provider";

export type TurnRound = ModelUsage & { ms: number };
export type TurnMetrics = {
  // Which tier Jev (or the rules) chose, and how.
  tier?: string;
  route?: string;
  routingMs?: number;
  // From the start of the turn to the first streamed word of the reply.
  firstTextMs?: number;
  totalMs?: number;
  rounds: TurnRound[];
};

export type TurnTotals = {
  rounds: number;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
};

export function turnTotals(metrics: TurnMetrics): TurnTotals {
  const sum = (key: keyof ModelUsage) =>
    metrics.rounds.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  return {
    rounds: metrics.rounds.length,
    inputTokens: sum("inputTokens"),
    cachedTokens: sum("cachedTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    outputTokens: sum("outputTokens"),
    costUsd: Math.round(sum("costUsd") * 1e6) / 1e6,
  };
}
