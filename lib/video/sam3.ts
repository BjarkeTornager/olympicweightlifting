import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../json";
import { segmentationSchema, type VideoSegmentation } from "./segmentation";
import type { VideoAnalysis } from "./types";

const MAX_RESPONSE = 2_000_000;
export type SegmentationBudget = { remainingMs: number; deadlineMs?: number };
export type Sam3Configuration = { endpoint?: string; token?: string };
const queuedJobSchema = z
  .object({
    requestId: z.string().uuid(),
    receipt: z.string().min(1).max(2048),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().finite(),
  })
  .strict();
// Private worker checkpoint only. Never include this receipt in video DTOs or logs.
export type Sam3Job = z.infer<typeof queuedJobSchema>;
export class SegmentationPending extends Error {
  constructor() {
    super("Object tracking is still processing");
  }
}
export type Sam3Resume = {
  job?: Sam3Job;
  saveJob: (job: Sam3Job) => Promise<void>;
};

// Called only with the account read from the fenced video job, never upload
// fields. An empty pilot setting disables dispatch even when secrets exist.
export function sam3ConfigurationForAccount(
  account: { email: string; emailVerified: boolean },
  env: Record<string, string | undefined> = process.env,
): Sam3Configuration {
  const pilot = (env.VIDEO_SAM3_PILOT_EMAIL ?? "").trim().toLowerCase();
  if (
    !pilot ||
    !account.emailVerified ||
    account.email.trim().toLowerCase() !== pilot
  )
    return {};
  return { endpoint: env.VIDEO_SAM3_URL, token: env.VIDEO_SAM3_TOKEN };
}
export async function segmentVideo(
  media: Buffer,
  analysis: VideoAnalysis,
  signal: AbortSignal,
  config: Sam3Configuration = {},
  request: typeof fetch = fetch,
  budget: SegmentationBudget = { remainingMs: 300_000 },
  resume?: Sam3Resume,
): Promise<VideoSegmentation | undefined> {
  if (!config.endpoint && !config.token) return undefined;
  let failure: NonNullable<VideoSegmentation["failure"]> =
    "service_unavailable";
  const unavailable = (): VideoSegmentation => ({
    version: 1,
    model: "sam3.1",
    revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
    sourceSha256: createHash("sha256").update(media).digest("hex"),
    status: "unavailable",
    reason:
      "Object outlines could not be prepared. Your video and Coach feedback are still available.",
    width: analysis.width,
    height: analysis.height,
    frames: [],
    failure,
  });
  const started = Date.now();
  let receipt: string | undefined;
  let url: URL | undefined;
  let completed = false;
  let preserved = false;
  let savedJob: Sam3Job | undefined;
  let windowSignal: AbortSignal | undefined;
  let requestId: string = randomUUID();
  try {
    signal.throwIfAborted();
    const allowance = Math.floor(
      Math.min(
        300_000,
        budget.remainingMs,
        budget.deadlineMs === undefined
          ? Infinity
          : budget.deadlineMs - Date.now(),
      ),
    );
    if (allowance < 1_000) {
      if (resume) throw new SegmentationPending();
      failure = "deadline";
      return unavailable();
    }
    if (!config.endpoint || !config.token || config.token.length < 32)
      throw Error("Configuration");
    url = new URL(config.endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error("Configuration");
    const samples = [...new Set(analysis.sampleTimes)];
    const manifest = {
      version: 1,
      sha256: createHash("sha256").update(media).digest("hex"),
      width: analysis.width,
      height: analysis.height,
      duration: analysis.duration,
      sampleTimes: samples,
      // Only motion landmarks, without account IDs, journal, audio or load.
      anchors: samples.map((t) => {
        const frame = analysis.pose?.frames.find(
          (f) => Math.abs(f.t - t) < 0.012,
        );
        return {
          t,
          points:
            frame?.points.filter((p) => [11, 12, 23, 24].includes(p.id)) ?? [],
        };
      }),
    };
    const binding = createHash("sha256")
      .update(canonicalJson({ endpoint: url.href, manifest }))
      .digest("hex");
    if (resume?.job) {
      const restored = queuedJobSchema.parse(resume.job);
      if (
        restored.binding !== binding ||
        restored.expiresAt > Date.now() + 900_000
      )
        throw Error("Invalid saved job");
      savedJob = restored;
      requestId = restored.requestId;
      receipt = restored.receipt;
      if (restored.expiresAt <= Date.now()) {
        failure = "deadline";
        throw Error("Expired job");
      }
    }
    windowSignal = AbortSignal.timeout(allowance);
    const waitSignal = AbortSignal.any([signal, windowSignal]);
    const headers = {
      Authorization: `Bearer ${config.token}`,
      "X-SAM3-Request": requestId,
    };
    const send = (method: string, extra: RequestInit = {}) =>
      request(url!, {
        ...extra,
        method,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([
          waitSignal,
          AbortSignal.timeout(method === "POST" ? 60_000 : 30_000),
        ]),
        headers: {
          ...headers,
          ...(receipt ? { "X-SAM3-Job": receipt } : {}),
          ...extra.headers,
        },
      });
    // Submit once. Only reads are retried: never duplicate GPU work after an
    // ambiguous upload failure. Receipts stay on this account-fenced worker.
    const lifetime = resume ? 900_000 : allowance;
    const submittedAt = Date.now();
    let response = receipt
      ? new Response(null, { status: 202 })
      : await send("POST", {
          headers: {
            "Content-Type": "video/mp4",
            "X-SAM3-Manifest": JSON.stringify(manifest),
            "X-SAM3-Budget-Ms": String(lifetime),
          },
          body: new Uint8Array(media),
        });
    if (response.status === 202 && !receipt) {
      const queued = (await readJson(response, 4096)) as {
        job?: unknown;
        sourceSha256?: unknown;
      };
      if (
        typeof queued.job !== "string" ||
        queued.job.length > 2048 ||
        queued.sourceSha256 !== manifest.sha256
      )
        throw Error("Invalid job receipt");
      receipt = queued.job;
      if (resume) {
        const job = {
          requestId,
          receipt,
          binding,
          expiresAt: submittedAt + lifetime,
        };
        // Do not continue if the account fence/checkpoint write fails.
        await resume.saveJob(job);
        savedJob = job;
      }
    }
    if (response.status === 202) {
      let failures = 0;
      let immediate = Boolean(resume?.job);
      while (true) {
        waitSignal.throwIfAborted();
        if (!immediate) await pause(2_000, waitSignal);
        immediate = false;
        try {
          response = await send("GET");
          if (response.status >= 500) {
            await response.body?.cancel();
            throw Error("Temporary outage");
          }
          failures = 0;
        } catch (error) {
          waitSignal.throwIfAborted();
          if (++failures >= 3) throw error;
          continue;
        }
        if (response.status !== 202) break;
        await response.body?.cancel();
      }
    }
    if (!response.ok) {
      if (response.status === 410) failure = "deadline";
      await response.body?.cancel();
      throw Error("Unavailable");
    }
    failure = "invalid_response";
    const result = segmentationSchema.parse(
      await readJson(response, MAX_RESPONSE),
    );
    if (
      result.sourceSha256 !== manifest.sha256 ||
      result.width !== analysis.width ||
      result.height !== analysis.height ||
      result.frames.some(
        (f, i) =>
          f.t > analysis.duration + 0.05 ||
          (i > 0 && f.t <= result.frames[i - 1].t) ||
          new Set(f.objects.map((o) => o.id)).size !== f.objects.length,
      )
    )
      throw Error("Mismatched evidence");
    waitSignal.throwIfAborted();
    completed = true;
    return result;
  } catch (error) {
    // Account deletion/cancellation must abort the job; an optional GPU outage
    // must not discard the usable video or misrepresent SAM as having run.
    signal.throwIfAborted();
    if (
      error instanceof SegmentationPending ||
      (resume &&
        savedJob &&
        windowSignal?.aborted &&
        savedJob.expiresAt > Date.now())
    ) {
      preserved = true;
      throw new SegmentationPending();
    }
    if (windowSignal?.aborted) failure = "deadline";
    console.warn(
      JSON.stringify({
        event: "video_segmentation_unavailable",
        reason: failure,
      }),
    );
    return unavailable();
  } finally {
    budget.remainingMs = Math.max(
      0,
      budget.remainingMs - (Date.now() - started),
    );
    if (receipt && !completed && !preserved && url && config.token) {
      // Use a separate bounded signal: the account/job signal may be cancelled.
      await request(url, {
        method: "DELETE",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
        headers: {
          Authorization: `Bearer ${config.token}`,
          "X-SAM3-Request": requestId,
          "X-SAM3-Job": receipt,
        },
      })
        .then((r) => r.body?.cancel())
        .catch(() => undefined);
    }
  }
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body) throw Error("Missing response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("Oversize");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
