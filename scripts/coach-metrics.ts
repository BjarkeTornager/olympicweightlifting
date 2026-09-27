// Summarises Coach's saved turn metrics: how long turns take, how many model
// rounds they need, how much of the prompt came from the provider's cache and
// what they cost. Reads timings and counts only, never messages.
//
//   npm run coach:metrics                              # last 7 days, by day
//   npm run coach:metrics -- --since 2026-09-20        # from a date, by day
//   npm run coach:metrics -- --split 2026-09-28T10:00Z # before vs after a release
//
// Uses DATABASE_URL (from .env.local unless set). For production, run it with
// the production database URL in the environment.
import { config } from "dotenv";
import { getPool } from "../lib/db";
import { turnTotals, type TurnMetrics } from "../lib/agent/turn-metrics";
config({ path: ".env.local", quiet: true });

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const since = new Date(arg("since") ?? Date.now() - 7 * 86400000);
const split = arg("split") ? new Date(arg("split")!) : undefined;
if (Number.isNaN(since.getTime()) || (split && Number.isNaN(split.getTime())))
  throw Error("Pass dates as YYYY-MM-DD or an ISO time.");

const quantile = (values: number[], q: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const seconds = (ms: number | null) =>
  ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

async function main() {
  const { rows } = await getPool().query<{
    created_at: Date;
    status: string;
    metrics: TurnMetrics;
  }>(
    "SELECT created_at, status, metrics FROM agent_turns WHERE metrics IS NOT NULL AND created_at >= $1 ORDER BY created_at",
    [since],
  );
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = split
      ? row.created_at < split
        ? "before"
        : "after"
      : row.created_at.toISOString().slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  console.log(
    "| Period | Turns (failed) | Median turn | p95 turn | Median first word | Rounds/turn | Input tokens/turn | From cache | Cache writes/turn | Cost/turn | Cost |",
  );
  console.log(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [period, turns] of groups) {
    const totals = turns.map((t) => turnTotals(t.metrics));
    const input = totals.reduce((n, t) => n + t.inputTokens, 0);
    const cached = totals.reduce((n, t) => n + t.cachedTokens, 0);
    const cost = totals.reduce((n, t) => n + t.costUsd, 0);
    const total = turns.flatMap((t) => t.metrics.totalMs ?? []);
    const first = turns.flatMap((t) => t.metrics.firstTextMs ?? []);
    console.log(
      `| ${period} | ${turns.length} (${turns.filter((t) => t.status !== "done").length}) | ${seconds(quantile(total, 0.5))} | ${seconds(quantile(total, 0.95))} | ${seconds(quantile(first, 0.5))} | ${mean(totals.map((t) => t.rounds)).toFixed(1)} | ${Math.round(input / turns.length).toLocaleString("en")} | ${input ? Math.round((100 * cached) / input) : 0} % | ${Math.round(mean(totals.map((t) => t.cacheWriteTokens))).toLocaleString("en")} | $${(cost / turns.length).toFixed(4)} | $${cost.toFixed(2)} |`,
    );
  }
  if (!rows.length) console.log("No turns with metrics in this period.");
  await getPool().end();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
