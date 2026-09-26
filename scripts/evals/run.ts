// Runs the Coach evals: npm run eval -- --live [--only a,b] [--k 3] [--text]
// Voice scenarios use the Gemini key; typed Coach scenarios (--text) spend
// the production OpenRouter budget, so they are opt-in and budget-checked.
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { localClock } from "../../lib/agent/time-context";
import type { Check, Scenario, Trial } from "./core";
import { judge, JUDGE_MODEL } from "./models";
import { scenarios } from "./scenarios";

config({ path: ".env.local", quiet: true });
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const db = new URL(process.env.TEST_DATABASE_URL || "http://invalid");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) ||
  !db.pathname.endsWith("_test")
)
  throw Error("A local TEST_DATABASE_URL ending in _test is required.");
if (!process.argv.includes("--live"))
  throw Error("Use --live to authorize real model calls (they cost money).");
if (!process.env.GEMINI_API_KEY) throw Error("GEMINI_API_KEY is required.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const k = Number(arg("--k") ?? 3);
const only = arg("--only")?.split(",");
const includeText = process.argv.includes("--text");
const useJudge = !process.argv.includes("--no-judge");
const timezone = "Europe/Copenhagen";
const selected = scenarios.filter(
  (s) => (!only || only.includes(s.id)) && (s.coach === "voice" || includeText),
);
if (only?.some((id) => !scenarios.some((s) => s.id === id)))
  throw Error(
    `Unknown scenario. Known: ${scenarios.map((s) => s.id).join(", ")}`,
  );

if (selected.some((s) => s.coach === "text")) {
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  process.env.OPENROUTER_API_KEY ||= (
    await readFile(
      join(homedir(), ".config/lift-journal/openrouter.key"),
      "utf8",
    )
  ).trim();
  process.env.AGENT_PROVIDER ||= "openrouter";
  process.env.AGENT_MODEL ||= "openai/gpt-5.6-luna";
  const key = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  }).then((r) => r.json());
  const remaining = key.data?.limit_remaining;
  console.log(`OpenRouter allowance remaining: $${remaining}`);
  if (typeof remaining === "number" && remaining < 1)
    throw Error(
      "Less than $1 of OpenRouter allowance left; typed Coach evals would starve production.",
    );
}

const { getPool } = await import("../../lib/db");
const { readJournal, writeJournal } = await import("../../lib/server");
const { runVoice } = await import("./voice-runner");
const { runText } = await import("./text-runner");
const pool = getPool();

async function trial(
  scenario: Scenario,
  today: string,
): Promise<Trial & { checks: Check[] }> {
  const userId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Sam',$1||'@eval.example.test',true)",
    [userId],
  );
  try {
    let snapshot = await readJournal(userId);
    const seeded = structuredClone(snapshot.state);
    scenario.seed?.(seeded, today);
    snapshot = await writeJournal(userId, {
      state: seeded,
      revision: snapshot.revision,
      mutationId: crypto.randomUUID(),
    });
    for (const [i, [question, reply]] of (scenario.memory ?? []).entries())
      await pool.query(
        "INSERT INTO agent_turns(id,user_id,question,status,response,created_at) VALUES ($1,$2,$3,'done',$4,now() - ($5 || ' days')::interval)",
        [
          crypto.randomUUID(),
          userId,
          question,
          { reply, proposals: [] },
          String(10 - i),
        ],
      );
    const run =
      scenario.coach === "voice"
        ? await runVoice(scenario, userId, timezone)
        : await runText(scenario, userId, timezone);
    const result: Trial = {
      ...run,
      before: snapshot.state,
      after: (await readJournal(userId)).state,
    };
    const checks = [
      ...(result.error
        ? [
            {
              name: "completes without error",
              kind: "procedure" as const,
              pass: false,
              detail: result.error,
            },
          ]
        : []),
      ...scenario.checks(result, today),
      ...(useJudge && scenario.judge
        ? await judge(result, today, scenario.judge, scenario.memory)
        : []),
    ];
    return { ...result, checks };
  } finally {
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
}

const today = localClock(new Date(), timezone).date;
const started = new Date();
const results: {
  scenario: Scenario;
  trials: (Trial & { checks: Check[] })[];
}[] = [];
for (const scenario of selected) {
  const trials = [];
  for (let i = 0; i < k; i++) {
    process.stdout.write(`${scenario.id} ${i + 1}/${k} … `);
    const t = await trial(scenario, today);
    const failed = t.checks.filter((c) => !c.pass);
    console.log(
      failed.length ? `FAIL (${failed.map((c) => c.name).join("; ")})` : "pass",
    );
    trials.push(t);
  }
  results.push({ scenario, trials });
}
await pool.end();

// pass^k: the scenario passed in every trial; pass rate: share of trials.
const passed = (t: { checks: Check[] }) => t.checks.every((c) => c.pass);
const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;
const rows = results.map(({ scenario, trials }) => ({
  id: scenario.id,
  title: scenario.title,
  coach: scenario.coach,
  type: scenario.type,
  passAll: trials.every(passed),
  passRate: trials.filter(passed).length / trials.length,
  medianFirstAudioMs: median(trials.flatMap((t) => t.latencies)),
  failures: [
    ...new Set(
      trials.flatMap((t) =>
        t.checks
          .filter((c) => !c.pass)
          .map((c) => `${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
      ),
    ),
  ],
}));
const stamp = started.toISOString().replace(/[:.]/g, "-");
const dir = join("artifacts", "evals");
await mkdir(dir, { recursive: true });
await writeFile(
  join(dir, `${stamp}.json`),
  JSON.stringify(
    {
      started: started.toISOString(),
      k,
      judgeModel: useJudge ? JUDGE_MODEL : null,
      rows,
      trials: results.flatMap((r) =>
        r.trials.map((t) => ({
          scenario: t.scenario,
          transcript: t.transcript,
          calls: t.calls,
          latencies: t.latencies,
          checks: t.checks,
          error: t.error,
        })),
      ),
    },
    null,
    2,
  ),
);
const md = [
  `# Coach evals — ${started.toISOString()}`,
  "",
  `${k} trials per scenario. pass^${k} means every trial passed. Judge: ${useJudge ? JUDGE_MODEL : "off"}.`,
  "",
  `| Scenario | Coach | Type | pass^${k} | Pass rate | First audio (median) |`,
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (r) =>
      `| ${r.title} (\`${r.id}\`) | ${r.coach} | ${r.type} | ${r.passAll ? "yes" : "**no**"} | ${Math.round(r.passRate * 100)}% | ${r.medianFirstAudioMs ?? "—"} ms |`,
  ),
  "",
  ...rows
    .filter((r) => r.failures.length)
    .flatMap((r) => [`## ${r.id}`, "", ...r.failures.map((f) => `- ${f}`), ""]),
  "Transcripts, tool calls and every check are in the JSON file beside this report. Read failing transcripts before trusting a score.",
].join("\n");
await writeFile(join(dir, `${stamp}.md`), md);
console.log(`\n${md}\n\nReport: ${join(dir, `${stamp}.md`)}`);
if (rows.some((r) => r.type === "regression" && !r.passAll))
  process.exitCode = 1;
