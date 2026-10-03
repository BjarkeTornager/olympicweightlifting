// Runs hard-benchmark conversations through the real Coach engine and models
// on disposable accounts in the local *_test database. Used by the CLI
// (run.ts) and by prompt experiments, which pass a Variant that rewrites
// what is sent to the model.
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { mock } from "node:test";
import type {
  ModelMessage,
  ModelOptions,
  ModelResponse,
  ToolDefinition,
} from "../../lib/agent/provider";
import { turnTotals, type TurnMetrics } from "../../lib/agent/turn-metrics";
import {
  BENCH_NOW,
  TIMEZONE,
  dates,
  type Language,
  type Scenario,
} from "./bench";

export const LUNA = "openai/gpt-5.6-luna";

export type Variant = {
  name: string;
  // Rewrites the request (prompt, examples, tool descriptions). Only with
  // the fixed model: production routing can't be combined with a rewrite.
  transform?: (
    messages: ModelMessage[],
    tools: ToolDefinition[],
  ) => { messages: ModelMessage[]; tools: ToolDefinition[] };
};
export type TurnResult = {
  message: string;
  reply: string;
  proposals: { title: string; status?: string }[];
  tools: { name: string; ok: boolean; args?: string }[];
  // What rejected tool calls said back to the model, for diagnosis.
  toolErrors: string[];
  failures: string[];
  rounds: number;
  costUsd: number;
  inputTokens: number;
  cachedTokens: number;
  tier?: string;
  ms: number;
};
export type ConversationResult = {
  scenario: string;
  category: string;
  split: string;
  language: Language;
  repeat: number;
  variant: string;
  passed: boolean;
  turns: TurnResult[];
};

let engine: Awaited<ReturnType<typeof load>> | undefined;
let spent = 0;
let capUsd = 2;
export const spentUsd = () => spent;

async function load() {
  const [{ getPool }, { runTurn }, { readJournal, writeJournal }, provider] =
    await Promise.all([
      import("../../lib/db"),
      import("../../lib/agent/engine"),
      import("../../lib/server"),
      import("../../lib/agent/provider"),
    ]);
  return { pool: getPool(), runTurn, readJournal, writeJournal, provider };
}

// Points the app at the test database and OpenRouter, fixes the clock, and
// keeps the app's own logs off stdout. Call once before running.
export async function prepare(options: { maxUsd: number }) {
  config({ path: ".env.local", quiet: true });
  console.log = console.info = console.debug = console.warn = console.error;
  const testDb = process.env.TEST_DATABASE_URL ?? "";
  if (!testDb || !new URL(testDb).pathname.endsWith("_test"))
    throw Error("TEST_DATABASE_URL must name a disposable *_test database.");
  process.env.DATABASE_URL = testDb;
  process.env.OPENROUTER_API_KEY ||= (
    await readFile(
      join(homedir(), ".config/lift-journal/openrouter.key"),
      "utf8",
    )
  ).trim();
  process.env.AGENT_PROVIDER = "openrouter";
  process.env.AGENT_MODEL = LUNA;
  if (!(options.maxUsd > 0 && options.maxUsd <= 10))
    throw Error("The budget must be above 0 and at most $10.");
  capUsd = options.maxUsd;
  mock.timers.enable({ apis: ["Date"], now: Date.parse(BENCH_NOW) });
  engine = await load();
}
export async function close() {
  await engine?.pool.end();
}

// "07:30" on the benchmark day in Copenhagen (summer time, UTC+2).
const at = (time = "19:30") =>
  new Date(`${dates.today}T${time}:00+02:00`).toISOString();

export async function runConversation(
  scenario: Scenario,
  language: Language,
  options: { repeat?: number; variant?: Variant; routing?: boolean } = {},
): Promise<ConversationResult> {
  if (!engine) throw Error("Call prepare() first.");
  const { pool, runTurn, readJournal, writeJournal, provider } = engine;
  if (options.routing && options.variant?.transform)
    throw Error("A rewriting variant needs the fixed model, not routing.");
  if (spent >= capUsd) throw Error("Benchmark budget reached.");
  // Tool results the model has seen, to collect rejections.
  let seenTools = new Set<string>();
  let toolErrors: string[] = [];
  const collect = (messages: ModelMessage[]) => {
    for (const m of messages)
      if (
        m.role === "tool" &&
        m.tool_call_id &&
        !seenTools.has(m.tool_call_id)
      ) {
        seenTools.add(m.tool_call_id);
        const error = m.content.match(/"error":"((?:[^"\\]|\\.)*)"/)?.[1];
        if (error) toolErrors.push(`${m.tool_name}: ${error.slice(0, 300)}`);
      }
  };
  const model = options.routing
    ? undefined
    : async (
        messages: ModelMessage[],
        tools: ToolDefinition[],
        signal: AbortSignal,
        onText?: (delta: string) => void,
        modelOptions?: ModelOptions,
      ): Promise<ModelResponse> => {
        // Stop before a call, not after, so the cap holds.
        if (spent >= capUsd) throw Error("Benchmark budget reached.");
        collect(messages);
        const sent = options.variant?.transform?.(messages, tools) ?? {
          messages,
          tools,
        };
        return provider.callModel(
          sent.messages,
          sent.tools,
          signal,
          onText,
          modelOptions,
        );
      };
  const userId = randomUUID();
  await pool.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic bench','bench-'||$1||'@example.test',true)",
    [userId],
  );
  const turns: TurnResult[] = [];
  try {
    const seed = await readJournal(userId);
    seed.state.profile.timezone = TIMEZONE;
    scenario.seed?.(seed.state);
    await writeJournal(userId, { ...seed, mutationId: randomUUID() });
    for (const turn of scenario.turns) {
      const message = turn[language];
      const before = await readJournal(userId);
      const tools: TurnResult["tools"] = [];
      seenTools = new Set();
      toolErrors = [];
      const id = randomUUID();
      const started = performance.now();
      let reply = "",
        proposals: TurnResult["proposals"] = [],
        error: string | undefined;
      let response: Awaited<ReturnType<typeof runTurn>> | undefined;
      try {
        response = await runTurn(
          userId,
          {
            id,
            message,
            revision: before.revision,
            timezone: TIMEZONE,
            submittedAt: at(turn.at),
          },
          model,
          {
            directLogging: true,
            onToolCall: (name, args, ok) =>
              tools.push({
                name,
                ok,
                args: JSON.stringify(args).slice(0, 1500),
              }),
          },
        );
        reply = response.reply;
        proposals = response.proposals.map((p) => ({
          title: p.title,
          ...(p.status ? { status: p.status } : {}),
        }));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        if (/budget reached/i.test(error)) throw e;
      }
      const ms = performance.now() - started;
      const after = await readJournal(userId);
      const metrics: TurnMetrics | undefined = (
        await pool.query("SELECT metrics FROM agent_turns WHERE id=$1", [id])
      ).rows[0]?.metrics;
      const rounds = metrics?.rounds ?? [];
      const costUsd = rounds.reduce((n, r) => n + (r.costUsd ?? 0), 0);
      spent += costUsd;
      turns.push({
        message,
        reply: reply.slice(0, 2000),
        proposals,
        tools,
        toolErrors,
        failures: error
          ? [`Turn failed: ${error}`]
          : turn.check({
              before: before.state,
              after: after.state,
              reply,
              proposals: response?.proposals ?? [],
              tools,
            }),
        // A call the content filter blocked and its retry are one round,
        // though both count towards the cost and tokens.
        rounds: metrics ? turnTotals(metrics).rounds : 0,
        costUsd,
        inputTokens: rounds.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
        cachedTokens: rounds.reduce((n, r) => n + (r.cachedTokens ?? 0), 0),
        ...(metrics?.tier ? { tier: metrics.tier } : {}),
        ms: Math.round(ms),
      });
    }
  } finally {
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  return {
    scenario: scenario.id,
    category: scenario.category,
    split: scenario.split,
    language,
    repeat: options.repeat ?? 0,
    variant: options.variant?.name ?? (options.routing ? "routing" : "current"),
    passed: turns.every((t) => !t.failures.length),
    turns,
  };
}

// Runs work items a few at a time.
export async function pool<T, R>(
  items: T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]);
      }
    }),
  );
  return results;
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export type Summary = {
  conversations: number;
  passed: number;
  passRate: number;
  // Share of scenario-language pairs that passed on every repeat.
  passAllRepeats: number;
  turns: number;
  roundsPerTurn: number;
  costPerTurn: number;
  medianSecondsPerTurn: number;
};
export function summarize(results: ConversationResult[]): Summary {
  const turns = results.flatMap((r) => r.turns);
  const pairs = new Map<string, boolean>();
  for (const r of results) {
    const key = `${r.scenario}-${r.language}`;
    pairs.set(key, (pairs.get(key) ?? true) && r.passed);
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    conversations: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    passAllRepeats: pairs.size
      ? [...pairs.values()].filter(Boolean).length / pairs.size
      : 0,
    turns: turns.length,
    roundsPerTurn: turns.length
      ? turns.reduce((n, t) => n + t.rounds, 0) / turns.length
      : 0,
    costPerTurn: turns.length
      ? turns.reduce((n, t) => n + t.costUsd, 0) / turns.length
      : 0,
    medianSecondsPerTurn: median(turns.map((t) => t.ms)) / 1000,
  };
}
