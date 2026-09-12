import { createHash } from "node:crypto";
import { segmentationSchema, type VideoSegmentation } from "./segmentation";
import type { VideoAnalysis } from "./types";
import {
  queuedGpuTask,
  type GpuConfiguration,
  type GpuBudget,
  type GpuResume,
} from "./gpu-job";
export { GpuTaskPending as SegmentationPending } from "./gpu-job";
export type { GpuJob as Sam3Job } from "./gpu-job";
export type SegmentationBudget = GpuBudget;
export type Sam3Configuration = GpuConfiguration;
export type Sam3Resume = GpuResume;
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
  const samples = [...new Set(analysis.sampleTimes)];
  const manifest = {
    version: 1,
    sha256: createHash("sha256").update(media).digest("hex"),
    width: analysis.width,
    height: analysis.height,
    duration: analysis.duration,
    sampleTimes: samples,
    anchors: samples.map((t) => ({
      t,
      points:
        analysis.pose?.frames
          .find((f) => Math.abs(f.t - t) < 0.012)
          ?.points.filter((p) => [11, 12, 23, 24].includes(p.id)) ?? [],
    })),
  };
  return queuedGpuTask({
    media,
    manifest,
    signal,
    config,
    request,
    budget,
    resume,
    contentType: "video/mp4",
    maxResponse: 2_000_000,
    unavailable: (failure) => ({
      version: 1,
      model: "sam3.1",
      revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
      sourceSha256: manifest.sha256,
      status: "unavailable",
      reason:
        "Object outlines could not be prepared. Your video and Coach feedback are still available.",
      width: analysis.width,
      height: analysis.height,
      frames: [],
      failure,
    }),
    parse: (raw) => {
      const result = segmentationSchema.parse(raw);
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
      return result;
    },
  });
}
