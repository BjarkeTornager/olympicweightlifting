// Developer-only synthetic benchmark. No imports from the live app or its database.
import { config } from "dotenv";
import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { fixtures, validateFixtures, type Fixture } from "./fixtures";
import {
  Budget,
  evaluateJev,
  groupedSummaries,
  intentQuestions,
  replyQuestions,
  MODEL,
  PRICE_PER_MILLION,
  QUESTION_VERSION,
  THRESHOLD,
  rulesBaseline,
  type ResultRow,
} from "./core";

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    split: { type: "string", default: "all" },
    limit: { type: "string" },
    "max-usd": { type: "string", default: "0.10" },
  },
});
if (!["all", "calibration", "heldout"].includes(values.split!))
  throw Error("--split must be all, calibration or heldout.");
const limit =
  values.limit === undefined ? fixtures.length : Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > fixtures.length)
  throw Error(`--limit must be between 1 and ${fixtures.length}.`);
const budget = new Budget(Number(values["max-usd"]));
validateFixtures(fixtures);
const selected = fixtures
  .filter((f) => values.split === "all" || f.split === values.split)
  .slice(0, limit);
// Load credentials only for an explicitly requested live run. Never print values.
if (values.live) config({ path: ".env.local", quiet: true });
const key = values.live ? process.env.TYPESAFE_API_KEY?.trim() : undefined;
if (values.live && !key) {
  console.error(
    "Live benchmark not started: add TYPESAFE_API_KEY to .env.local or the environment. No request was sent.",
  );
  process.exit(2);
}
const output = await mkdtemp("/tmp/lift-jev-");
await chmod(output, 0o700);
const write = (name: string, data: unknown) =>
  writeFile(join(output, name), JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const sourceHashes = Object.fromEntries(
  await Promise.all(
    ["fixtures.ts", "core.ts", "benchmark.ts"].map(async (name) => [
      name,
      hash(await readFile(new URL(name, import.meta.url), "utf8")),
    ]),
  ),
);
await write("manifest.json", {
  startedAt: new Date().toISOString(),
  mode: values.live ? "live" : "baseline-only",
  model: MODEL,
  questionVersion: QUESTION_VERSION,
  threshold: THRESHOLD,
  thresholdPolicy:
    "Preset; no held-out tuning. Choice uses selected probability, not confidence.",
  datasetHash: hash(JSON.stringify(fixtures)),
  questionsHash: hash(JSON.stringify({ intentQuestions, replyQuestions })),
  sourceHashes,
  datasetCases: fixtures.length,
  selectedCases: selected.length,
  split: values.split,
  limit,
  maxUsd: budget.maxUsd,
  pricePerMillion: PRICE_PER_MILLION,
  labelProvenance:
    "Assistant-authored synthetic examples and labels; no independent human annotation.",
  dataScope:
    "Only the committed synthetic fixture state is sent; no database, app tools, images or production conversation.",
});
function row(
  f: Fixture,
  predictions: ResultRow["predictions"],
  latencyMs: number,
): ResultRow {
  return {
    id: f.id,
    family: f.family,
    split: f.split,
    language: f.language,
    suite: f.suite,
    expected: f.expected,
    predictions,
    latencyMs,
  };
}
const baselineRows = selected
  .filter((f) => f.suite === "intent")
  .map((f) => {
    const start = performance.now();
    const predictions = rulesBaseline(f);
    return row(f, predictions, performance.now() - start);
  });
const liveRows: ResultRow[] = [];
let failure: string | null = null;
console.log(`${selected.length} synthetic cases selected. Results: ${output}`);
if (values.live) {
  for (const f of selected) {
    try {
      const result = await evaluateJev(f, key!, budget);
      const r = row(f, result.predictions, result.latencyMs);
      liveRows.push(r);
      await appendFile(
        join(output, "responses.jsonl"),
        JSON.stringify({ ...r, usage: result.usage, model: result.model }) +
          "\n",
        { mode: 0o600 },
      );
      if (liveRows.length % 10 === 0 || liveRows.length === selected.length)
        console.log(
          `Jev ${liveRows.length}/${selected.length}; usage-priced estimate $${budget.usageEstimatedUsd.toFixed(6)}.`,
        );
    } catch (error) {
      // evaluateJev emits fixed diagnostics, never provider text, request content or credentials.
      failure = error instanceof Error ? error.message : "Benchmark stopped.";
      console.error(`Stopped at ${f.id}: ${failure}`);
      break;
    }
  }
}
const report = {
  completedAt: new Date().toISOString(),
  mode: values.live ? "live" : "baseline-only",
  status: failure
    ? "incomplete"
    : values.live
      ? "complete"
      : "awaiting-live-run",
  failure,
  selectedCases: selected.length,
  liveCases: liveRows.length,
  baseline: groupedSummaries(baselineRows),
  jev: groupedSummaries(liveRows),
  cost: {
    currency: "USD",
    pricePerMillion: PRICE_PER_MILLION,
    requests: budget.requests,
    inputTokens: budget.inputTokens,
    outputTokens: budget.outputTokens,
    usageEstimatedUsd: budget.usageEstimatedUsd,
    accountedUsd: budget.accountedUsd,
    maxUsd: budget.maxUsd,
  },
  notes: [
    "Cost is token usage multiplied by the documented price, not a provider billing receipt. Failed/uncertain requests retain the maximum-input reservation.",
    "Rules baseline covers intent only; its one-hot confidence is not calibrated. No rules baseline is claimed for reply judging.",
    "Held-out labels and bilingual families were fixed before live inference. Labels are assistant-authored and need human review before deployment decisions.",
    "Reply cases are authored positive/negative controls, not measured live Coach outputs or an end-to-end GEPA run.",
    "Danish cases have Danish user/reply text and English fixture context; this is not a fully Danish conversation benchmark.",
    "The 0.85 abstention threshold is an exploratory preset, not validated permission to automate writes.",
    "No routing changes, downstream calls or actual saves are executed; savings and end-to-end correctness are unmeasured.",
  ],
  downstreamModelCallsAvoided: null,
  productionEnabled: false,
};
await write("baseline.json", baselineRows);
await write("report.json", report);
const pct = (x: number | null) =>
  x === null ? "—" : `${(x * 100).toFixed(1)}%`;
const rows = Object.entries(report.baseline)
  .filter(([key, s]) => key.endsWith("/all") && s.cases)
  .map(
    ([name, s]) =>
      `| Rules | ${name} | ${s.cases} | ${pct(s.accuracy)} | ${pct(s.exactCaseAccuracy)} | ${pct(s.coverage)} | ${pct(s.acceptedAccuracy)} |`,
  );
rows.push(
  ...Object.entries(report.jev)
    .filter(([key, s]) => key.endsWith("/all") && s.cases)
    .map(
      ([name, s]) =>
        `| Jev | ${name} | ${s.cases} | ${pct(s.accuracy)} | ${pct(s.exactCaseAccuracy)} | ${pct(s.coverage)} | ${pct(s.acceptedAccuracy)} |`,
    ),
);
await writeFile(
  join(output, "report.md"),
  [
    "# Synthetic Jev benchmark",
    `Status: ${report.status}. ${liveRows.length}/${selected.length} live cases completed.`,
    "",
    "| Method | Suite/split | Cases | Atomic accuracy | All labels correct | Coverage | Accepted accuracy |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    `Usage-priced estimate: $${budget.usageEstimatedUsd.toFixed(6)}. Accounted including uncertain reservations: $${budget.accountedUsd.toFixed(6)}.`,
    ...(failure ? [`Stopped: ${failure}`] : []),
    "",
    ...report.notes.map((n) => `- ${n}`),
    "",
    "See report.json for field-level errors, English/Danish breakdowns, false-event/finish counts, probability bins, Brier scores and latency. No production promotion is performed.",
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log(`Report: ${join(output, "report.md")}`);
if (failure) process.exitCode = 1;
