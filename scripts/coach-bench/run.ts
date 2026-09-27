// The hard Coach benchmark. Every run calls paid models, so --live is
// required. See README.md.
//
//   npm run bench:coach -- --live
//   npm run bench:coach -- --live --repeats 2 --split heldout
//   npm run bench:coach -- --live --only morning-bundle,soda-can --languages en
//   npm run bench:coach -- --live --routing   # production tier routing
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scenarios } from "./scenarios";
import type { Language, Split } from "./bench";
import {
  close,
  pool,
  prepare,
  runConversation,
  spentUsd,
  summarize,
  type ConversationResult,
} from "./runner";

const flag = (name: string) => process.argv.includes(`--${name}`);
const value = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!flag("live")) {
  process.stderr.write("Pass --live: every run calls paid models.\n");
  process.exit(2);
}
const only = value("only")?.split(",");
const split = value("split") as Split | "all" | undefined;
const languages = (value("languages")?.split(",") ?? [
  "en",
  "da",
]) as Language[];
const repeats = Number(value("repeats") ?? "1");
const maxUsd = Number(value("max-usd") ?? "2");
const routing = flag("routing");
const out = resolve(
  value("out") ?? join(tmpdir(), `lift-coach-bench-${Date.now()}`),
);
if (out.startsWith(process.cwd()))
  throw Error("Write results outside the repository (--out).");
if (!(repeats >= 1 && repeats <= 5)) throw Error("Use 1 to 5 repeats.");
const unknown = only?.filter((id) => !scenarios.some((s) => s.id === id));
if (unknown?.length) throw Error(`Unknown scenarios: ${unknown.join(", ")}`);
const selected = scenarios.filter(
  (s) =>
    (!only || only.includes(s.id)) &&
    (!split || split === "all" || s.split === split),
);

await mkdir(out, { recursive: true, mode: 0o700 });
await prepare({ maxUsd });
const work = selected.flatMap((scenario) =>
  languages.flatMap((language) =>
    Array.from({ length: repeats }, (_, repeat) => ({
      scenario,
      language,
      repeat,
    })),
  ),
);
process.stdout.write(
  `Running ${work.length} conversations (${selected.length} scenarios), ${routing ? "production routing" : "Luna"}, cap $${maxUsd}.\n`,
);
const results: ConversationResult[] = [];
try {
  await pool(work, 3, async ({ scenario, language, repeat }) => {
    if (spentUsd() >= maxUsd) return;
    const result = await runConversation(scenario, language, {
      repeat,
      routing,
    });
    results.push(result);
    await appendFile(join(out, "results.jsonl"), JSON.stringify(result) + "\n");
    const failures = result.turns.flatMap((t) => t.failures);
    process.stdout.write(
      `${result.passed ? "pass" : "FAIL"} ${scenario.id} ${language}${repeats > 1 ? ` #${repeat + 1}` : ""}` +
        ` rounds=${result.turns.map((t) => t.rounds).join("+")}` +
        (failures.length ? ` — ${failures.join("; ")}` : "") +
        "\n",
    );
  });
} finally {
  await close();
}

const fmt = (s: ReturnType<typeof summarize>) =>
  `${s.passed}/${s.conversations} | ${Math.round(s.passAllRepeats * 100)} % | ${s.roundsPerTurn.toFixed(2)} | $${s.costPerTurn.toFixed(4)} | ${s.medianSecondsPerTurn.toFixed(1)} s`;
const header =
  "| | Passed | Passed every repeat | Rounds/turn | Cost/turn | Median time/turn |\n| --- | --- | --- | --- | --- | --- |";
const by = (key: "category" | "split") =>
  [...new Set(results.map((r) => r[key]))]
    .sort()
    .map(
      (k) =>
        `| ${k} | ${fmt(summarize(results.filter((r) => r[key] === k)))} |`,
    )
    .join("\n");
const report = [
  `# Hard Coach benchmark — ${routing ? "production routing" : "Luna"}`,
  "",
  header,
  `| **All** | ${fmt(summarize(results))} |`,
  "",
  "## By category",
  "",
  header,
  by("category"),
  "",
  "## By split",
  "",
  header,
  by("split"),
  "",
  `Spent: $${spentUsd().toFixed(3)}`,
].join("\n");
await writeFile(join(out, "report.md"), report + "\n");
await writeFile(
  join(out, "summary.json"),
  JSON.stringify({ all: summarize(results), spentUsd: spentUsd() }, null, 2),
);
process.stdout.write(`\n${report}\n\nResults: ${out}\n`);
