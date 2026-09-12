/** Isolated public-clip review comparison. No database imports or application writes.
 * Paid calls require --paid, --budget-usd=10 and OPENROUTER_API_KEY in the environment.
 * Media/results live outside the repository. References never enter model messages.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { reviewMessages, parseVideoReview } from "../../../lib/video/review";
import { modelRequest } from "../../../lib/agent/provider";
import type { VideoAnalysis, VideoUpload } from "../../../lib/video/types";
import { committed, reserve, settle, type Charge } from "./budget";

const args = process.argv.slice(2);
const option = (name: string) =>
  args
    .find((s) => s.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const root = path.resolve(
  option("root") ?? "/private/tmp/lift-youtube-benchmark",
);
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
if (root === repo || root.startsWith(repo + path.sep))
  throw Error("Keep media and raw outputs outside the repository");
const budget = Number(option("budget-usd") ?? "0");
if (
  !args.includes("--paid") ||
  !budget ||
  budget > 10 ||
  !process.env.OPENROUTER_API_KEY
)
  throw Error(
    "Paid evaluation needs explicit --paid --budget-usd=10 and OPENROUTER_API_KEY",
  );
const allModels = [
  "openai/gpt-5.6-luna",
  "google/gemini-3.8-flash",
  "qwen/qwen3.6-27b",
  "openai/gpt-6-astra",
];
const selectedModels = option("models")?.split(",") ?? allModels;
if (selectedModels.some((m) => !allModels.includes(m)))
  throw Error("Unreviewed model or pricing policy");
const inputMode = option("input") ?? "sheets";
if (!["sheets", "native"].includes(inputMode))
  throw Error("Unknown input mode");
if (
  inputMode === "native" &&
  selectedModels.some((m) => m.startsWith("openai/"))
)
  throw Error("Astra and Luna accept frames, not native video");
const manifestBytes = await fs.readFile(
  new URL("./cases.json", import.meta.url),
);
const manifest = JSON.parse(manifestBytes.toString()) as {
  cases: {
    id: string;
    expectedLift: string | null;
    requiredPhases: string[];
    expectedScope?: string;
  }[];
};
const selected = option("cases")?.split(",");
const cases = manifest.cases.filter(
  (c) => !selected || selected.includes(c.id),
);
if (!cases.length) throw Error("No benchmark cases selected");
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const lockPath = path.join(root, "evaluation.lock");
const lock = await fs.open(lockPath, "wx", 0o600);
const ledgerPath = path.join(root, "cost-ledger.json");
const ledger: Charge[] = await fs
  .readFile(ledgerPath, "utf8")
  .then(JSON.parse)
  .catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
const persistLedger = () =>
  fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
const catalog = (await fetch("https://openrouter.ai/api/v1/models", {
  signal: AbortSignal.timeout(20000),
}).then((r) => r.json())) as {
  data: {
    id: string;
    pricing: { prompt: string; completion: string };
    architecture: { input_modalities: string[] };
  }[];
};
await fs.writeFile(
  path.join(root, "model-catalog.json"),
  JSON.stringify(
    catalog.data.filter((m) => selectedModels.includes(m.id)),
    null,
    2,
  ),
);
try {
  for (const c of cases) {
    const work = path.join(root, c.id);
    const { analysis, frames } = JSON.parse(
      await fs.readFile(path.join(work, "result.json"), "utf8"),
    ) as { analysis: VideoAnalysis; frames: string[] };
    const input = JSON.parse(
      await fs.readFile(path.join(work, "input.json"), "utf8"),
    ) as VideoUpload;
    // These limits bound multimodal token exposure. Only the fixed production sheets are accepted.
    if (
      frames.length !== 8 ||
      analysis.sampleTimes.length !== 48 ||
      analysis.duration > 20
    )
      throw Error("Unexpected evidence shape");
    for (const frame of frames) {
      if (Buffer.byteLength(frame, "base64") > 1500000)
        throw Error("Oversized evidence image");
    }
    const messages = reviewMessages(input, analysis, frames);
    if (inputMode === "native") {
      messages[0].content +=
        "\nEVALUATION INPUT ADAPTATION: This request supplies a silent video instead of contact sheets. Inspect the visible sequence from that video. There are no printed frame labels: the provided sampledTimes array defines 48 numbered temporal anchors (1-based). In the unchanged JSON schema, choose frame numbers for the nearest anchor timestamps that actually support each observation. Do not infer content from the clip filename; no audio, transcript, lift label or reference answer is supplied. Missing views still require limited evidence.";
      messages[1].images = undefined;
    }
    if (messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0) > 30000)
      throw Error("Oversized prompt");
    for (const model of selectedModels) {
      const id = `${c.id}:${model}:${inputMode}-v2`;
      if (ledger.some((l) => l.id === id)) continue;
      const entry = catalog.data.find((m) => m.id === model);
      if (
        !entry ||
        !entry.architecture.input_modalities.includes(
          inputMode === "native" ? "video" : "image",
        )
      )
        throw Error("Model cannot accept this modality");
      // Qwen's cheapest endpoint does not advertise JSON mode. Allow its next
      // ZDR-capable endpoint within this explicit, still very small price cap.
      const promptPrice = Math.max(
          Number(entry.pricing.prompt),
          model.startsWith("qwen/") ? 0.0000005 : 0,
        ),
        completionPrice = Math.max(
          Number(entry.pricing.completion),
          model.startsWith("qwen/") ? 0.000004 : 0,
        );
      if (!(
        promptPrice > 0 &&
        promptPrice <= 0.00001 &&
        completionPrice > 0 &&
        completionPrice <= 0.00005
      ))
        throw Error("Model pricing exceeds approved bounds");
      const maxTokens = 8192;
      // 150k input tokens is deliberately conservative for 8 fixed 1280x1920 sheets and <=30KB text.
      // Provider price ceilings prevent routing to a more expensive endpoint; uncertain charges stop the run.
      const reservation =
        (150000 * promptPrice + maxTokens * completionPrice) * 1.1 + 0.02;
      reserve(ledger, id, reservation, budget);
      await persistLedger();
      console.log(
        JSON.stringify({
          event: "request",
          case: c.id,
          model,
          reservedUsd: reservation,
          committedUsd: committed(ledger),
        }),
      );
      const config = {
        kind: "openrouter" as const,
        base: "https://openrouter.ai/api/v1",
        model,
        key: process.env.OPENROUTER_API_KEY!,
        label: "OpenRouter",
      };
      const { body } = modelRequest(messages, [], config);
      if (inputMode === "native") {
        const media = await fs.readFile(path.join(work, "media.mp4"));
        if (media.length > 5 * 1024 * 1024)
          throw Error("Native evaluation clip exceeds size cap");
        // The endpoint's static sampling rate is not exposed here; measure the
        // result as this API configuration, not as guaranteed full-frame vision.
        (body.messages[1] as { content: unknown }).content = [
          { type: "text", text: messages[1].content },
          {
            type: "video_url",
            video_url: {
              url: `data:video/mp4;base64,${media.toString("base64")}`,
            },
            processing: "static",
          },
        ];
      }
      const request = {
        ...body,
        stream: false,
        tools: undefined,
        tool_choice: undefined,
        max_tokens: model.startsWith("openai/") ? undefined : maxTokens,
        max_completion_tokens: model.startsWith("openai/")
          ? maxTokens
          : undefined,
        reasoning: { effort: "low", exclude: true },
        response_format: { type: "json_object" },
        provider: {
          data_collection: "deny",
          zdr: true,
          sort: "price",
          require_parameters: true,
          max_price: {
            prompt: promptPrice * 1e6 * 1.1,
            completion: completionPrice * 1e6 * 1.1,
          },
        },
      };
      const started = performance.now();
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.key}`,
            "Content-Type": "application/json",
            "X-OpenRouter-Title": "Lift Journal public video evaluation",
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(180000),
        },
      );
      const raw = await response.json();
      const latencyMs = Math.round(performance.now() - started);
      const output = path.join(
        work,
        model.replaceAll("/", "--") + `-${inputMode}-v2.json`,
      );
      // Deliberately exclude request headers, credential, media and hidden reasoning from saved results.
      const content = raw.choices?.[0]?.message?.content ?? "";
      await fs.writeFile(
        output,
        JSON.stringify(
          {
            id: raw.id,
            requestedModel: model,
            returnedModel: raw.model,
            provider: raw.provider,
            httpStatus: response.status,
            finishReason: raw.choices?.[0]?.finish_reason,
            usage: raw.usage,
            latencyMs,
            content,
            errorCode: raw.error?.code,
            errorMessage: raw.error?.message?.slice(0, 300),
            manifestSha256: createHash("sha256")
              .update(manifestBytes)
              .digest("hex"),
            promptSha256: createHash("sha256")
              .update(JSON.stringify(request))
              .digest("hex"),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      try {
        settle(ledger, id, raw.usage?.cost);
      } finally {
        await persistLedger();
      }
      if (!response.ok)
        throw Error(
          `Provider returned HTTP ${response.status}; evaluation stopped`,
        );
      const parsed = parseVideoReview(content, analysis, input);
      const observed = parsed?.identification;
      const score = {
        case: c.id,
        model,
        inputMode,
        costUsd: raw.usage.cost,
        latencyMs,
        parsed: Boolean(parsed),
        expectedLift: c.expectedLift,
        observedLift: observed?.lift ?? null,
        labelCorrect: Boolean(parsed) && observed?.lift === c.expectedLift,
        unexpectedConfidentLabel: Boolean(
          observed?.lift && observed.lift !== c.expectedLift,
        ),
        requiredPhasesFound: c.requiredPhases.filter((p) =>
          observed?.phases.some((v) => v.kind === p),
        ),
        requiredPhases: c.requiredPhases.length,
        visibleScopePreserved: c.expectedScope
          ? observed?.reviewScope === c.expectedScope
          : null,
        moments: parsed?.coaching.moments.length ?? 0,
        // An automated parser pass is NOT a judgement that the advice is correct.
        coachingQuality: "requires independent human review",
      };
      await fs.writeFile(
        output.replace(".json", "-score.json"),
        JSON.stringify(score, null, 2),
      );
      console.log(
        JSON.stringify({
          event: "result",
          ...score,
          totalCommittedUsd: committed(ledger),
        }),
      );
    }
  }
} finally {
  await lock.close();
  await fs.rm(lockPath);
}
