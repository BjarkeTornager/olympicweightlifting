// Experiment: do a few worked examples of correct tool use help Coach?
// DSPy's "bootstrap few-shot" idea without DSPy: take passing conversations
// from a run on the train split, keep the shortest correct tool sequence per
// scenario, add them to the fixed instructions (still cached), and compare
// with the current prompt on validation and held-out only.
//
//   node --import tsx scripts/coach-bench/examples.ts --live \
//     --from /tmp/.../results.jsonl --repeats 3 --max-usd 2 --out /tmp/...
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { scenarios } from "./scenarios";
import type { Language } from "./bench";
import {
  close,
  pool,
  prepare,
  runConversation,
  spentUsd,
  summarize,
  type ConversationResult,
  type Variant,
} from "./runner";

const value = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!process.argv.includes("--live")) {
  process.stderr.write("Pass --live: every run calls paid models.\n");
  process.exit(2);
}
const from = value("from");
const out = resolve(value("out") ?? "");
if (!from || !value("out") || out.startsWith(process.cwd()))
  throw Error("Pass --from results.jsonl and --out outside the repository.");
const repeats = Number(value("repeats") ?? "3");
const maxUsd = Number(value("max-usd") ?? "2");
const count = Number(value("examples") ?? "5");

// ---- Harvest -----------------------------------------------------------------

const train = new Set(
  scenarios.filter((s) => s.split === "train").map((s) => s.id),
);
const runs = (await readFile(from, "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as ConversationResult)
  .filter(
    (r) =>
      r.passed &&
      r.language === "en" &&
      train.has(r.scenario) &&
      r.turns.every((t) => t.tools.every((c) => c.ok && c.args)),
  );
const rounds = (r: ConversationResult) =>
  r.turns.reduce((n, t) => n + t.rounds, 0);
const best = new Map<string, ConversationResult>();
for (const r of runs)
  if (!best.has(r.scenario) || rounds(r) < rounds(best.get(r.scenario)!))
    best.set(r.scenario, r);
// One per category first, then the rest, so the few examples cover the most.
const picked: ConversationResult[] = [];
for (const r of [...best.values()].sort((a, b) => rounds(a) - rounds(b)))
  if (!picked.some((p) => p.category === r.category)) picked.push(r);
for (const r of best.values())
  if (picked.length < count && !picked.includes(r)) picked.push(r);
const examples = picked.slice(0, count).map((r) => {
  const title = scenarios.find((s) => s.id === r.scenario)!.title;
  const turns = r.turns.map((t) =>
    [
      `Athlete: "${t.message}"`,
      ...t.tools.map((c) => `Coach calls ${c.name}(${c.args})`),
    ].join("\n"),
  );
  return `Example: ${title}\n${turns.join("\n")}`;
});
if (!examples.length) throw Error("No passing train conversations to use.");
const block =
  "Worked examples of correct tool use, from earlier synthetic conversations. They show the rules above in practice: the fewest reads needed and one save. They are not this athlete's data; their dates, ids and numbers don't apply.\n\n" +
  examples.join("\n\n");

// ---- Compare ---------------------------------------------------------------

const withExamples: Variant = {
  name: "examples",
  transform: (messages, tools) => ({
    messages: messages.map((m, i) =>
      i === 0 ? { ...m, content: `${m.content}\n\n${block}` } : m,
    ),
    tools,
  }),
};
const current: Variant = { name: "current" };

await mkdir(out, { recursive: true, mode: 0o700 });
await writeFile(join(out, "examples.txt"), block + "\n");
await prepare({ maxUsd });
const tested = scenarios.filter((s) => s.split !== "train");
const work = tested.flatMap((scenario) =>
  (["en", "da"] as Language[]).flatMap((language) =>
    Array.from({ length: repeats }, (_, repeat) =>
      [current, withExamples].map((variant) => ({
        scenario,
        language,
        repeat,
        variant,
      })),
    ).flat(),
  ),
);
process.stdout.write(
  `${examples.length} examples (${block.length} characters) from ${picked
    .slice(0, count)
    .map((p) => p.scenario)
    .join(", ")}.\n` +
    `Comparing on ${tested.length} validation and held-out scenarios: ${work.length} conversations, cap $${maxUsd}.\n`,
);
const results: ConversationResult[] = [];
try {
  await pool(work, 3, async ({ scenario, language, repeat, variant }) => {
    if (spentUsd() >= maxUsd) return;
    const result = await runConversation(scenario, language, {
      repeat,
      variant,
    });
    results.push(result);
    await appendFile(join(out, "results.jsonl"), JSON.stringify(result) + "\n");
    process.stdout.write(
      `${result.passed ? "pass" : "FAIL"} ${variant.name} ${scenario.id} ${language} #${repeat + 1} rounds=${result.turns.map((t) => t.rounds).join("+")}\n`,
    );
  });
} finally {
  await close();
}
const table = ["current", "examples"].map((name) => {
  const s = summarize(results.filter((r) => r.variant === name));
  return `| ${name} | ${s.passed}/${s.conversations} | ${Math.round(s.passAllRepeats * 100)} % | ${s.roundsPerTurn.toFixed(2)} | $${s.costPerTurn.toFixed(4)} | ${s.medianSecondsPerTurn.toFixed(1)} s |`;
});
const report = [
  "| | Passed | Passed every repeat | Rounds/turn | Cost/turn | Median time/turn |",
  "| --- | --- | --- | --- | --- | --- |",
  ...table,
  "",
  `Spent: $${spentUsd().toFixed(3)}`,
].join("\n");
await writeFile(join(out, "report.md"), report + "\n");
process.stdout.write(`\n${report}\n\nResults: ${out}\n`);
