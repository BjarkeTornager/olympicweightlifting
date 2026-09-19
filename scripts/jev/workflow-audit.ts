import { config } from "dotenv";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  Budget,
  evaluateQuestions,
  summarize,
  THRESHOLD,
  type ResultRow,
} from "./core";
import { workflowQuestions } from "./workflow-questions";
import { controlCases, type AuditCase } from "./workflow-controls";

const dir = resolve(process.argv[2] || "");
if (!/^\/(private\/)?tmp\/lift-jev-workflow-[\w-]+$/.test(dir))
  throw Error("Pass the private workflow run directory.");
const live = process.argv.includes("--live");
type Trace = {
  id: string;
  family: string;
  language: "en" | "da";
  message: string;
  history: unknown;
  before: unknown;
  after: unknown;
  result: { reply: string; proposals: unknown[]; visuals?: unknown } | null;
  error: string | null;
  failures: string[];
};
type Annotation = {
  expected: Record<string, boolean>;
  rationale: string;
  ambiguous?: boolean;
};
const traces: Trace[] = (await readFile(join(dir, "traces.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const labels: Record<string, Annotation> = JSON.parse(
  await readFile(join(dir, "annotations.json"), "utf8"),
);
const keySet = Object.keys(workflowQuestions).sort().join("|");
const cases: AuditCase[] = traces
  .filter((t) => !t.error)
  .map<AuditCase>((t) => {
    const label = labels[t.id];
    if (
      !label?.rationale ||
      Object.keys(label.expected).sort().join("|") !== keySet ||
      Object.values(label.expected).some((v) => typeof v !== "boolean")
    )
      throw Error(`Missing/invalid independent labels: ${t.id}`);
    return {
      id: t.id,
      family: t.family,
      language: t.language,
      source: "coach",
      state: {
        user_message: t.message,
        coach_reply: t.result!.reply,
        conversation_history: t.history,
        evidence: {
          journal_before: t.before,
          journal_after: t.after,
          final_receipts: t.result!.proposals,
          visuals: t.result!.visuals ?? [],
        },
      },
      expected: label.expected,
      rationale: label.rationale,
      ambiguous: label.ambiguous === true,
    };
  })
  .concat(controlCases());
const sha = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const manifest = {
  questionHash: sha(workflowQuestions),
  casesHash: sha(cases),
  cases: cases.length,
  coachCases: cases.filter((c) => c.source === "coach").length,
  controlCases: cases.filter((c) => c.source === "control").length,
  excludedExecutionErrors: traces.filter((t) => t.error).map((t) => t.id),
  ambiguousCasesExcludedFromPrimaryScores: cases
    .filter((c) => c.ambiguous)
    .map((c) => c.id),
  threshold: THRESHOLD,
  annotationMethod:
    "Assistant-reviewed synthetic traces, deterministic journal comparisons and preset control labels. Labels frozen before Jev calls; no independent human adjudication.",
};
if (!live) {
  await writeFile(
    join(dir, "audit-cases.json"),
    JSON.stringify(cases, null, 2),
    { mode: 0o600 },
  );
  await writeFile(
    join(dir, "audit-manifest.json"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(manifest));
} else {
  const frozen = JSON.parse(
    await readFile(join(dir, "audit-manifest.json"), "utf8"),
  );
  if (
    frozen.questionHash !== manifest.questionHash ||
    frozen.casesHash !== manifest.casesHash
  )
    throw Error("Audit data changed after freeze.");
  // Exclusive creation prevents a repeat invocation from accidentally spending again.
  await writeFile(
    join(dir, "audit-started.json"),
    JSON.stringify({ startedAt: new Date().toISOString(), ...manifest }),
    { mode: 0o600, flag: "wx" },
  );
  config({ path: ".env.local", quiet: true });
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw Error("TYPESAFE_API_KEY missing.");
  const budget = new Budget(0.1);
  const rows: (ResultRow & {
      source: AuditCase["source"];
      ambiguous?: boolean;
    })[] = [],
    errors: unknown[] = [];
  try {
    for (const c of cases) {
      try {
        const r = await evaluateQuestions(
          c.state,
          workflowQuestions,
          key,
          budget,
        );
        const row = {
          id: c.id,
          family: c.family,
          language: c.language,
          suite: "reply" as const,
          split: "heldout" as const,
          source: c.source,
          ambiguous: c.ambiguous,
          expected: c.expected,
          ...r,
        };
        rows.push(row);
        await appendFile(
          join(dir, "audit-responses.jsonl"),
          JSON.stringify(row) + "\n",
          { mode: 0o600 },
        );
      } catch (e) {
        errors.push({
          id: c.id,
          error: e instanceof Error ? e.message : "Unknown error",
        });
        break;
      }
      if (rows.length % 20 === 0)
        console.log(
          JSON.stringify({
            evaluated: rows.length,
            accountedUsd: budget.accountedUsd,
          }),
        );
    }
  } finally {
    function binaryAlarm(
      rs: typeof rows,
      threshold: number,
      fields = Object.keys(workflowQuestions),
    ) {
      let tp = 0,
        fp = 0,
        tn = 0,
        fn = 0;
      for (const r of rs) {
        const actual = Object.values(r.expected).some(Boolean);
        const alarm = fields.some((field) => {
          const p = r.predictions[field];
          return p?.label === true && p.probability >= threshold;
        });
        if (actual && alarm) tp++;
        else if (actual) fn++;
        else if (alarm) fp++;
        else tn++;
      }
      return {
        threshold,
        tp,
        fp,
        tn,
        fn,
        precision: tp + fp ? tp / (tp + fp) : null,
        recall: tp + fn ? tp / (tp + fn) : null,
      };
    }
    const report = {
      ...manifest,
      evaluated: rows.length,
      errors,
      budget,
      groups: Object.fromEntries(
        ["coach", "control"].map((source) => {
          const all = rows.filter((r) => r.source === source);
          const rs = all.filter((r) => !r.ambiguous);
          return [
            source,
            {
              ...summarize(rs),
              includingAmbiguous: {
                ...summarize(all),
                alarmAt85: binaryAlarm(all, 0.85),
              },
              alarmAt50: binaryAlarm(rs, 0.5),
              alarmAt85: binaryAlarm(rs, 0.85),
              originalThreeAlarmAt85: binaryAlarm(rs, 0.85, [
                "unsupported_claim",
                "ignores_constraint",
                "false_save_claim",
              ]),
              languages: Object.fromEntries(
                ["en", "da"].map((lang) => [
                  lang,
                  summarize(rs.filter((r) => r.language === lang)),
                ]),
              ),
            },
          ];
        }),
      ),
      mismatches: rows.flatMap((r) =>
        Object.entries(r.expected)
          .filter(([k, v]) => r.predictions[k]?.label !== v)
          .map(([field, expected]) => ({
            id: r.id,
            field,
            expected,
            prediction: r.predictions[field],
            ambiguous: r.ambiguous === true,
          })),
      ),
    };
    await writeFile(
      join(dir, "audit-report.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        outputDir: dir,
        evaluated: rows.length,
        errors,
        accountedUsd: budget.accountedUsd,
      }),
    );
  }
}
