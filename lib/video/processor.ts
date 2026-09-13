import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VideoAnalysis, VideoUpload } from "./types";
import { ApiError } from "../agent/http";
import { z } from "zod";
const exec = promisify(execFile);
const coordinate = z.number().finite().min(0).max(1);
const overlayRecoverySchema = z.object({
  pose: z.object({
    version: z.literal(2),
    status: z.enum(["partial", "unavailable"]),
    reason: z.string().max(240),
    frames: z
      .array(
        z.object({
          t: z.number().finite().min(0).max(120.2),
          points: z
            .array(
              z.object({
                id: z.number().int().min(0).max(32),
                x: coordinate,
                y: coordinate,
              }),
            )
            .max(16),
        }),
      )
      .max(900),
  }),
  tracking: z.object({
    status: z.enum(["partial", "unavailable"]),
    source: z.literal("automatic_plate"),
    reason: z.string().max(300),
    points: z
      .array(
        z.object({
          t: z.number().finite().min(0).max(120.2),
          x: coordinate,
          y: coordinate,
          score: coordinate,
        }),
      )
      .max(900),
    coverage: coordinate,
    horizontalRangeCm: z.null(),
    riseCm: z.null(),
    peakUpwardVelocity: z.null(),
    velocities: z.array(z.never()).max(0),
  }),
});

export async function recoverVideoOverlays(
  media: Buffer,
  analysis: VideoAnalysis,
  signal: AbortSignal,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "lift-video-overlays-"));
  try {
    await writeFile(path.join(dir, "media.mp4"), media, { mode: 0o600 });
    await writeFile(
      path.join(dir, "input.json"),
      JSON.stringify({
        sampleTimes: analysis.sampleTimes,
        pose: analysis.pose,
        segmentation: analysis.segmentation,
      }),
      { mode: 0o600 },
    );
    await exec(
      process.env.VIDEO_PYTHON_PATH ?? "python3",
      [path.join(process.cwd(), "scripts/video/overlay_recovery.py"), dir],
      {
        signal,
        timeout: 120000,
        maxBuffer: 65536,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          VIDEO_POSE_MODEL_PATH: process.env.VIDEO_POSE_MODEL_PATH,
          MPLCONFIGDIR: dir,
          PYTHONDONTWRITEBYTECODE: "1",
          OMP_NUM_THREADS: "2",
        },
      },
    );
    const file = path.join(dir, "result.json");
    if ((await stat(file)).size > 1500000)
      throw Error("Oversized overlay tracking");
    const result = overlayRecoverySchema.parse(
      JSON.parse(await readFile(file, "utf8")),
    );
    for (const frames of [result.pose.frames, result.tracking.points])
      if (
        frames.some(
          (f, i) =>
            f.t > analysis.duration + 0.002 ||
            (i > 0 && f.t <= frames[i - 1].t),
        )
      )
        throw Error("Invalid overlay timing");
    return result;
  } catch {
    signal.throwIfAborted();
    return {
      pose: analysis.pose,
      tracking: {
        ...analysis.tracking,
        ...(analysis.tracking.status === "not_requested"
          ? {
              status: "unavailable" as const,
              source: "automatic_plate" as const,
              reason:
                "Automatic tracking could not finish. Update this review to retry from your saved video.",
            }
          : {}),
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function refineVideo(
  media: Buffer,
  analysis: VideoAnalysis,
  attempt: import("./attempts").VideoAttempt,
  signal: AbortSignal,
): Promise<{ analysis: VideoAnalysis; frames: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "lift-video-evidence-"));
  try {
    await writeFile(path.join(dir, "media.mp4"), media, { mode: 0o600 });
    await writeFile(
      path.join(dir, "input.json"),
      JSON.stringify({
        start: attempt.start,
        end: attempt.end,
        phases: attempt.identification.phases.map((p) => p.time),
      }),
      { mode: 0o600 },
    );
    await exec(
      process.env.VIDEO_PYTHON_PATH ?? "python3",
      [path.join(process.cwd(), "scripts/video/refine.py"), dir],
      {
        signal,
        timeout: 90000,
        maxBuffer: 65536,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          FFPROBE_PATH: process.env.FFPROBE_PATH,
          VIDEO_POSE_MODEL_PATH: process.env.VIDEO_POSE_MODEL_PATH,
          MPLCONFIGDIR: dir,
          PYTHONDONTWRITEBYTECODE: "1",
          OMP_NUM_THREADS: "2",
        },
      },
    );
    const file = path.join(dir, "result.json");
    if ((await stat(file)).size > 18000000) throw Error("Oversized evidence");
    const result = JSON.parse(await readFile(file, "utf8")) as {
      sampleTimes: number[];
      frames: string[];
      pose: VideoAnalysis["pose"];
    };
    if (
      result.sampleTimes.length !== 48 ||
      result.frames.length !== 8 ||
      result.sampleTimes.some(
        (t, i) =>
          !Number.isFinite(t) ||
          t < attempt.start ||
          t > attempt.end + 0.05 ||
          (i > 0 && t < result.sampleTimes[i - 1]),
      )
    )
      throw Error("Invalid evidence");
    const current = {
      ...analysis,
      sampleTimes: result.sampleTimes,
      identification: attempt.identification,
      pose: result.pose,
      segmentation: undefined,
    };
    return {
      analysis: current,
      frames: result.frames,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function processVideo(
  source: Buffer,
  input: VideoUpload,
  signal: AbortSignal,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "lift-video-"));
  try {
    await writeFile(path.join(dir, "source"), source, { mode: 0o600 });
    await writeFile(path.join(dir, "input.json"), JSON.stringify(input), {
      mode: 0o600,
    });
    try {
      await exec(
        process.env.VIDEO_PYTHON_PATH ?? "python3",
        [path.join(process.cwd(), "scripts/video/analyse.py"), dir],
        {
          signal,
          timeout: 240000,
          maxBuffer: 65536,
          // Media decoders do not need database, auth or provider secrets.
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            FFMPEG_PATH: process.env.FFMPEG_PATH,
            FFPROBE_PATH: process.env.FFPROBE_PATH,
            VIDEO_POSE_MODEL_PATH: process.env.VIDEO_POSE_MODEL_PATH,
            MPLCONFIGDIR: dir,
            PYTHONDONTWRITEBYTECODE: "1",
            OMP_NUM_THREADS: "2",
          },
        },
      );
    } catch (error) {
      signal.throwIfAborted();
      let message = "The video could not be processed. Try a shorter MP4 clip.";
      try {
        const output = JSON.parse(
          (error as { stdout?: string }).stdout ?? "{}",
        );
        if (typeof output.error === "string")
          message = output.error.slice(0, 200);
      } catch {
        /* Decoder output is never exposed. */
      }
      throw new ApiError(message, 422);
    }
    const file = path.join(dir, "result.json");
    if ((await stat(file)).size > 18000000)
      throw new ApiError("The video analysis was too large.", 422);
    const result = JSON.parse(await readFile(file, "utf8")) as {
      analysis: VideoAnalysis;
      frames: string[];
    };
    const media = await readFile(path.join(dir, "media.mp4"));
    return { ...result, media };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
