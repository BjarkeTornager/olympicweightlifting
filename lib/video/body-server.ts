import { createHash } from "node:crypto";
import { bodySchema, type VideoBody } from "./body";
import {
  queuedGpuTask,
  type GpuConfiguration,
  type GpuBudget,
  type GpuResume,
} from "./gpu-job";
import { segmentationAt } from "./segmentation";
import type { VideoAnalysis } from "./types";
import { movementTargets } from "./motion-plan";
export function bodyConfigurationForAccount(
  account: { email: string; emailVerified: boolean },
  env: Record<string, string | undefined> = process.env,
): GpuConfiguration {
  const pilot = (env.VIDEO_SAM3_PILOT_EMAIL ?? "").trim().toLowerCase();
  if (
    !pilot ||
    !account.emailVerified ||
    account.email.trim().toLowerCase() !== pilot
  )
    return {};
  return { endpoint: env.VIDEO_BODY_URL, token: env.VIDEO_SAM3_TOKEN };
}
export async function reconstructBody(
  media: Buffer,
  analysis: VideoAnalysis,
  signal: AbortSignal,
  config: GpuConfiguration = {},
  request: typeof fetch = fetch,
  budget: GpuBudget = { remainingMs: 90_000 },
  resume?: GpuResume,
): Promise<VideoBody | undefined> {
  if (!config.endpoint && !config.token) return undefined;
  const hash = createHash("sha256").update(media).digest("hex");
  const unavailable = (reason: string): VideoBody => ({
    version: 1,
    model: "sam-3d-body",
    revision: "11aaa346c7204874a1cbafe3d39a979080b2c55a",
    sourceSha256: hash,
    width: analysis.width,
    height: analysis.height,
    status: "unavailable",
    reason,
    frames: [],
    motion: {
      version: 1,
      status: "unavailable",
      reason:
        "The suggested movement could not be reconstructed. Your coaching and original video are available.",
      clips: [],
    },
  });
  if (analysis.segmentation?.sourceSha256 !== hash)
    return unavailable(
      "A matching lifter outline is needed to reconstruct the body.",
    );
  const frames = [...new Set(analysis.sampleTimes)].map((t) => {
    const objects = segmentationAt(analysis.segmentation, t),
      people = objects.filter((o) => o.kind === "person");
    return {
      t,
      person: people.length === 1 ? people[0].polygon : null,
      plates: objects.filter((o) => o.kind === "plate").map((o) => o.polygon),
    };
  });
  if (!frames.some((f) => f.person))
    return unavailable(
      "The lifter could not be selected clearly enough for body reconstruction.",
    );
  const corrections = movementTargets(analysis);
  const manifest = {
    version: 1,
    sha256: hash,
    motionVersion: 1,
    width: analysis.width,
    height: analysis.height,
    duration: analysis.duration,
    frames,
    ...(corrections.length ? { corrections } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(manifest));
  if (frames.length > 48 || encoded.length > 200_000)
    return unavailable("This body review has too many evidence frames.");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(encoded.length);
  return queuedGpuTask({
    media: Buffer.concat([length, encoded, media]),
    manifest,
    signal,
    config,
    request,
    budget,
    resume,
    contentType: "application/octet-stream",
    maxResponse: 24_000_000,
    unavailable: (failure) => ({
      ...unavailable(
        "The 3D body overlay could not finish. Your video and coaching are still available.",
      ),
      failure,
    }),
    parse: (raw) => {
      const result = bodySchema.parse(raw);
      if (
        result.sourceSha256 !== hash ||
        result.width !== analysis.width ||
        result.height !== analysis.height ||
        result.frames.length !== frames.length ||
        result.frames.some(
          (f, i) =>
            Math.abs(f.t - frames[i].t) > 0.00001 ||
            (f.image && !frames[i].person),
        )
      )
        throw Error("Mismatched body evidence");
      if (result.motion) {
        if (result.motion.clips.length !== corrections.length)
          throw Error("Mismatched correction count");
        for (const [i, clip] of result.motion.clips.entries()) {
          const target = corrections[i];
          if (
            clip.id !== target.id ||
            clip.start !== target.referenceTime ||
            clip.end !== target.focusTime ||
            clip.frames.some(
              (f, j) =>
                f.t < clip.start - 0.002 ||
                f.t > clip.end + 0.002 ||
                (j > 0 && f.t <= clip.frames[j - 1].t),
            )
          )
            throw Error("Mismatched correction evidence");
        }
      }
      for (const f of [
        ...result.frames,
        ...(result.motion?.clips.flatMap((c) => c.frames) ?? []),
      ])
        if (f.image) {
          const png = Buffer.from(f.image.slice(22), "base64");
          if (png.length < 33 || png.subarray(12, 16).toString() !== "IHDR")
            throw Error("Invalid body image");
          const w = png.readUInt32BE(16),
            h = png.readUInt32BE(20);
          if (
            !w ||
            !h ||
            w > 640 ||
            h > 640 ||
            Math.abs(w / h - analysis.width / analysis.height) > 0.01
          )
            throw Error("Mismatched body projection");
        }
      return result;
    },
  });
}
