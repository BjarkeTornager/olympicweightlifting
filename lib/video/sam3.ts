import { createHash, randomUUID } from "node:crypto";
import { segmentationSchema, type VideoSegmentation } from "./segmentation";
import type { VideoAnalysis } from "./types";

const MAX_RESPONSE = 2_000_000;
export type SegmentationBudget = { remainingMs: number; deadlineMs?: number };
type Configuration = { endpoint?: string; token?: string };
export async function segmentVideo(
  media: Buffer,
  analysis: VideoAnalysis,
  signal: AbortSignal,
  config: Configuration = {
    endpoint: process.env.VIDEO_SAM3_URL,
    token: process.env.VIDEO_SAM3_TOKEN,
  },
  request: typeof fetch = fetch,
  budget: SegmentationBudget = { remainingMs: 300_000 },
): Promise<VideoSegmentation | undefined> {
  if (!config.endpoint && !config.token) return undefined;
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
  });
  const started = Date.now();
  let receipt: string | undefined;
  let url: URL | undefined;
  let completed = false;
  const requestId = randomUUID();
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
    if (allowance < 1_000) return unavailable();
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
    const waitSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(allowance),
    ]);
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
    let response = await send("POST", {
      headers: {
        "Content-Type": "video/mp4",
        "X-SAM3-Manifest": JSON.stringify(manifest),
        "X-SAM3-Budget-Ms": String(allowance),
      },
      body: new Uint8Array(media),
    });
    if (response.status === 202) {
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
      let failures = 0;
      while (true) {
        waitSignal.throwIfAborted();
        await pause(2_000, waitSignal);
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
      await response.body?.cancel();
      throw Error("Unavailable");
    }
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
  } catch {
    // Account deletion/cancellation must abort the job; an optional GPU outage
    // must not discard the usable video or misrepresent SAM as having run.
    signal.throwIfAborted();
    console.warn(JSON.stringify({ event: "video_segmentation_unavailable" }));
    return unavailable();
  } finally {
    budget.remainingMs = Math.max(
      0,
      budget.remainingMs - (Date.now() - started),
    );
    if (receipt && !completed && url && config.token) {
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
