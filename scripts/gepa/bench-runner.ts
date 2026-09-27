// GEPA bridge for a tool description, scored on the hard Coach benchmark
// (scripts/coach-bench). A candidate replaces one tool's description in what
// is sent to the model; the conversation then runs through the real engine,
// tools and guards on a disposable test account. JSON lines on stdin/stdout.
//
// Nothing here changes the app. A winning description goes through review
// and the normal tests like any other change.
import { appendFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { scenarios } from "../coach-bench/scenarios";
import type { Language } from "../coach-bench/bench";
import {
  close,
  prepare,
  runConversation,
  spentUsd,
  type Variant,
} from "../coach-bench/runner";

const runDir = resolve(process.env.GEPA_RUN_DIR ?? "");
if (
  !basename(runDir).startsWith("lift-gepa-") ||
  runDir.startsWith(process.cwd())
)
  throw Error("GEPA_RUN_DIR must be a lift-gepa-* directory outside the repo.");
const maxUsd = Number(process.env.GEPA_MAX_COST_USD ?? "4");
const TOOL = process.env.GEPA_TOOL ?? "log_entry";
const REFLECTION_MODEL = "openai/gpt-5.6-terra";

await prepare({ maxUsd });
const { toolDefinitions } = await import("../../lib/agent/tools");
const provider = await import("../../lib/agent/provider");
const baseline = toolDefinitions.find((t) => t.function.name === TOOL)?.function
  .description;
if (!baseline) throw Error(`No tool named ${TOOL}.`);
let reflectionUsd = 0;
const spent = () => spentUsd() + reflectionUsd;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const log = (file: string, data: unknown) =>
  appendFile(join(runDir, `${file}.jsonl`), JSON.stringify(data) + "\n", {
    mode: 0o600,
  });

const variant = (description: string): Variant => ({
  name: sha(description).slice(0, 8),
  transform: (messages, tools) => ({
    messages,
    tools: tools.map((t) =>
      t.function.name === TOOL
        ? { ...t, function: { ...t.function, description } }
        : t,
    ),
  }),
});

async function evaluate(
  candidate: string,
  example: { scenario: string; language: Language },
) {
  const scenario = scenarios.find((s) => s.id === example.scenario);
  if (!scenario) throw Error(`Unknown scenario ${example.scenario}`);
  if (candidate.length < 500 || candidate.length > baseline!.length * 1.25)
    return {
      score: 0,
      passed: false,
      rounds: 0,
      costUsd: 0,
      turns: [],
      failures: ["Candidate description outside the allowed length."],
    };
  if (spent() >= maxUsd) throw Error("Budget reached before dispatch.");
  const result = await runConversation(scenario, example.language, {
    variant: variant(candidate),
  });
  // Correctness first; each model round beyond the first costs a little.
  const turnScores = result.turns.map((t) =>
    t.failures.length ? 0 : Math.max(0.5, 1 - 0.1 * Math.max(0, t.rounds - 1)),
  );
  const summary = {
    scenario: result.scenario,
    language: result.language,
    candidateHash: sha(candidate),
    score: turnScores.reduce((a, b) => a + b, 0) / scenario.turns.length,
    passed: result.passed,
    rounds: result.turns.reduce((n, t) => n + t.rounds, 0),
    costUsd: result.turns.reduce((n, t) => n + t.costUsd, 0),
    turns: result.turns.map((t) => ({
      message: t.message,
      reply: t.reply.slice(0, 800),
      tools: t.tools.map((c) => `${c.name}${c.ok ? "" : " (rejected)"}`),
      toolErrors: t.toolErrors,
      failures: t.failures,
      rounds: t.rounds,
    })),
  };
  await log("evaluations", summary);
  return summary;
}

async function reflect(messages: { role: string; content: string }[]) {
  const cfg = provider.providerConfig();
  if (!cfg) throw Error("No provider configured.");
  if (spent() + 0.3 > maxUsd) throw Error("Budget reached before dispatch.");
  const request = provider.modelRequest(
    messages.map((m) => ({
      role: m.role === "system" ? ("system" as const) : ("user" as const),
      content: m.content,
    })),
    [],
    cfg,
    { model: REFLECTION_MODEL },
  );
  const response = await fetch(request.url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(180000),
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...request.body, max_completion_tokens: 8000 }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    reflectionUsd += 0.05;
    throw Error(`Reflection returned HTTP ${response.status}.`);
  }
  const parsed = provider.parseModelResponse(
    await response.json(),
    "openrouter",
  );
  reflectionUsd += parsed.served?.costUsd ?? 0.05;
  if (parsed.truncated) throw Error("Reflection was truncated.");
  await log("reflections", { costUsd: parsed.served?.costUsd });
  return parsed.content;
}

const splits = Object.fromEntries(
  (["train", "validation", "heldout"] as const).map((split) => [
    split,
    scenarios.filter((s) => s.split === split).map((s) => s.id),
  ]),
);
const info = () => ({
  tool: TOOL,
  baseline,
  baselineHash: sha(baseline),
  reflectionModel: REFLECTION_MODEL,
  splits,
  spent: Math.round(spent() * 1e6) / 1e6,
  maxUsd,
});

const input = createInterface({ input: process.stdin });
const pending: Promise<void>[] = [];
input.on("line", (line) => {
  const request = JSON.parse(line) as {
    id: number;
    op: "info" | "evaluate" | "reflect";
    candidate?: string;
    example?: { scenario: string; language: Language };
    messages?: { role: string; content: string }[];
  };
  pending.push(
    (async () => {
      try {
        const result =
          request.op === "info"
            ? info()
            : request.op === "evaluate"
              ? await evaluate(request.candidate!, request.example!)
              : await reflect(request.messages!);
        process.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
      } catch (e) {
        process.stdout.write(
          JSON.stringify({
            id: request.id,
            error: e instanceof Error ? e.message : String(e),
          }) + "\n",
        );
      }
    })(),
  );
});
input.on("close", async () => {
  await Promise.allSettled(pending);
  await close();
});
