// How long a Coach turn took and what its model calls used: timings, token
// counts and cost only, never message text. Saved on the turn and logged, so
// speed and cost changes can be measured against real use.
import type { ModelUsage } from "./provider";

export type TurnRound = ModelUsage & {
  ms: number;
  // A reply the host's content filter blocked. Its retry on another model is
  // the next entry, so the blocked call's tokens and cost are counted too.
  filtered?: boolean;
};
export type TurnMetrics = {
  // Which tier Jev (or the rules) chose, and how.
  tier?: string;
  route?: string;
  // Skills the turn loaded (skills.ts), up front or during the turn.
  skills?: string[];
  // From the start of the turn to the routing decision: preparation plus
  // routing. Kept as it was, so older turns still compare.
  routingMs?: number;
  // Reading the journal, history and photos before routing.
  prepMs?: number;
  // Routing alone, and the tokens Jev used for it.
  routeMs?: number;
  routeTokens?: { input?: number; output?: number };
  // From the start of the turn to the first streamed word of the reply.
  firstTextMs?: number;
  totalMs?: number;
  rounds: TurnRound[];
  // The turn's diagnostic trace (lib/tracing), when tracing is on.
  traceId?: string;
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
    // A blocked call and its retry are one round of the turn.
    rounds: metrics.rounds.filter((r) => !r.filtered).length,
    inputTokens: sum("inputTokens"),
    cachedTokens: sum("cachedTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    outputTokens: sum("outputTokens"),
    costUsd: Math.round(sum("costUsd") * 1e6) / 1e6,
  };
}
