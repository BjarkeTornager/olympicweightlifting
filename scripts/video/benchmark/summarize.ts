/** Re-score saved public outputs without any model calls. */
import fs from "node:fs/promises";
import path from "node:path";
import { parseVideoReview } from "../../../lib/video/review";
import { identifyLift } from "../../../lib/video/identification";
import { committed, type Charge } from "./budget";

const root = path.resolve(
  process.argv[2] ?? "/private/tmp/lift-youtube-benchmark",
);
const manifest = JSON.parse(
  await fs.readFile(new URL("./cases.json", import.meta.url), "utf8"),
);
type Row = {
  case: string;
  model: string;
  input: string;
  responseReceived: boolean;
  httpStatus: number;
  providerError: number | null;
  costUsd: number | null;
  latencyMs: number;
  acceptedAtCallTime: boolean;
  acceptedAfterFix: boolean;
  visibleFeedbackPreserved: boolean;
  expectedLift: string | null;
  suggestedLift: string | null;
  unexpectedConfidentLabel: boolean;
  requiredPhasesFound: string[];
  requiredPhaseCount: number;
  moments: number;
  independentCoachScore: null;
};
const rows: Row[] = [];
for (const c of manifest.cases) {
  const work = path.join(root, c.id);
  const { analysis } = JSON.parse(
    await fs.readFile(path.join(work, "result.json"), "utf8"),
  );
  const input = JSON.parse(
    await fs.readFile(path.join(work, "input.json"), "utf8"),
  );
  for (const name of await fs.readdir(work)) {
    if (!/-(sheets|native)-v2\.json$/.test(name)) continue;
    const raw = JSON.parse(await fs.readFile(path.join(work, name), "utf8"));
    let evidence = null;
    try {
      evidence = identifyLift(
        JSON.stringify(JSON.parse(raw.content).evidence),
        analysis,
      );
    } catch {
      /* unavailable output */
    }
    const parsed = parseVideoReview(raw.content, analysis, input);
    const before = await fs
      .readFile(path.join(work, name.replace(".json", "-score.json")), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    rows.push({
      case: c.id,
      model: raw.requestedModel,
      input: name.includes("-native-") ? "native" : "sheets",
      responseReceived: Boolean(raw.content),
      httpStatus: raw.httpStatus,
      providerError: raw.errorCode ?? null,
      costUsd: raw.usage?.cost ?? null,
      latencyMs: raw.latencyMs,
      acceptedAtCallTime: before?.parsed ?? false,
      acceptedAfterFix: Boolean(parsed),
      visibleFeedbackPreserved: Boolean(
        parsed && (parsed.coaching.strength || parsed.coaching.moments.length),
      ),
      expectedLift: c.expectedLift,
      suggestedLift: evidence?.lift ?? null,
      unexpectedConfidentLabel: Boolean(
        evidence?.lift && evidence.lift !== c.expectedLift,
      ),
      requiredPhasesFound: c.requiredPhases.filter((p: string) =>
        evidence?.phases.some((v) => v.kind === p),
      ),
      requiredPhaseCount: c.requiredPhases.length,
      moments: parsed?.coaching.moments.length ?? 0,
      independentCoachScore: null,
    });
  }
}
const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length
    ? sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2
    : null;
};
const models = [...new Set(rows.map((r) => r.model))].map((model) => {
  const r = rows.filter(
    (r) => r.model === model && r.input === "sheets" && r.responseReceived,
  );
  return {
    model,
    completed: r.length,
    acceptedAfterFix: r.filter((v) => v.acceptedAfterFix).length,
    unexpectedConfidentLabels: r.filter((v) => v.unexpectedConfidentLabel)
      .length,
    medianLatencySeconds: median(r.map((v) => v.latencyMs / 1000)),
    meanCostUsd: r.length
      ? r.reduce((sum, v) => sum + (v.costUsd ?? 0), 0) / r.length
      : null,
  };
});
const ledger: Charge[] = JSON.parse(
  await fs.readFile(path.join(root, "cost-ledger.json"), "utf8"),
);
const report = {
  date: "2026-09-12",
  type: "diagnostic pilot; not a coaching accuracy estimate",
  sourceCount: manifest.sources.length,
  caseCount: manifest.cases.length,
  budgetUsd: 10,
  confirmedCostUsd: ledger.reduce((n, c) => n + (c.cost ?? 0), 0),
  conservativeCostWithUnsettledReservationsUsd: committed(ledger),
  unresolvedRequests: ledger
    .filter((c) => c.cost === undefined)
    .map((c) => ({ id: c.id, reservationUsd: c.reserved })),
  models,
  rows,
  tracking: JSON.parse(
    await fs.readFile(path.join(root, "tracking/summary.json"), "utf8"),
  ),
};
await fs.writeFile(
  path.join(root, "summary.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({ ...report, rows: undefined, tracking: undefined }, null, 2),
);
