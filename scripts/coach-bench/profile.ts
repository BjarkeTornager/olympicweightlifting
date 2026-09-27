// Experiment: does a smaller "core" context hurt everyday Coach turns?
// Leaves out the prompt paragraphs and tools for skills (photos, routes, web
// search, programmes, lifting reviews, weekly review, body goals) and the
// matching prepare_change fields, then compares with the full context on
// every scenario that doesn't need those skills.
//
//   node --import tsx scripts/coach-bench/profile.ts --live --repeats 2 --out /tmp/...
import { appendFile, mkdir, writeFile } from "node:fs/promises";
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
const out = resolve(value("out") ?? "");
if (!value("out") || out.startsWith(process.cwd()))
  throw Error("Pass --out outside the repository.");
const repeats = Number(value("repeats") ?? "2");
const maxUsd = Number(value("max-usd") ?? "2");

const skillParagraphs = [
  /^Attachments are general images/,
  /^You CAN retrieve and display saved photos/,
  /^Showing photos does not require/,
  /^When the athlete asks for a running, walking or cycling route/,
  /^When the athlete asks about something outside this journal/,
  /^When asked to create or edit a reusable training routine/,
  /^For individualized Olympic weightlifting assessment/,
  /^For weekly reflection/,
  /^When the athlete wants to set goals/,
  /^Coach fat loss, muscle gain/,
  /^General reference material/,
];
const skillTools = new Set([
  "inspect_images",
  "show_images",
  "image_library",
  "food_photos",
  "plan_route",
  "show_activity_route",
  "search_web",
  "training_library",
  "lifting_review",
  "lifting_knowledge",
  "lifting_videos",
  "weekly_review",
  "show_visual",
  "coach_memory",
]);
const skillFields = [
  "programChanges",
  "trainingProgram",
  "bodyGoals",
  "routine",
  "liftingBrief",
  "plan",
  "targets",
  "memory",
];
const core: Variant = {
  name: "core",
  transform: (messages, tools) => ({
    messages: messages.map((m, i) =>
      i === 0
        ? {
            ...m,
            content: m.content
              .split("\n")
              .filter((line) => !skillParagraphs.some((p) => p.test(line)))
              .join("\n"),
          }
        : m,
    ),
    tools: tools
      .filter((t) => !skillTools.has(t.function.name))
      .map((t) => {
        if (t.function.name !== "prepare_change") return t;
        const parameters = structuredClone(t.function.parameters) as {
          properties: Record<string, unknown>;
        };
        for (const field of skillFields) delete parameters.properties[field];
        return { ...t, function: { ...t.function, parameters } };
      }),
  }),
};
const full: Variant = { name: "full" };

await mkdir(out, { recursive: true, mode: 0o700 });
await prepare({ maxUsd });
// Starting a saved routine needs the programmes skill, so it's left out.
const tested = scenarios.filter((s) => s.category !== "routines");
const work = tested.flatMap((scenario) =>
  (["en", "da"] as Language[]).flatMap((language) =>
    Array.from({ length: repeats }, (_, repeat) =>
      [full, core].map((variant) => ({ scenario, language, repeat, variant })),
    ).flat(),
  ),
);
process.stdout.write(
  `Comparing full and core context on ${tested.length} scenarios: ${work.length} conversations, cap $${maxUsd}.\n`,
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
const tokens = (name: string) => {
  const turns = results
    .filter((r) => r.variant === name)
    .flatMap((r) => r.turns);
  const rounds = turns.reduce((n, t) => n + t.rounds, 0);
  return rounds
    ? Math.round(turns.reduce((n, t) => n + t.inputTokens, 0) / rounds)
    : 0;
};
const report = [
  "| | Passed | Passed every repeat | Rounds/turn | Input tokens/round | Cost/turn | Median time/turn |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...["full", "core"].map((name) => {
    const s = summarize(results.filter((r) => r.variant === name));
    return `| ${name} | ${s.passed}/${s.conversations} | ${Math.round(s.passAllRepeats * 100)} % | ${s.roundsPerTurn.toFixed(2)} | ${tokens(name).toLocaleString("en")} | $${s.costPerTurn.toFixed(4)} | ${s.medianSecondsPerTurn.toFixed(1)} s |`;
  }),
  "",
  `Spent: $${spentUsd().toFixed(3)}`,
].join("\n");
await writeFile(join(out, "report.md"), report + "\n");
process.stdout.write(`\n${report}\n\nResults: ${out}\n`);
