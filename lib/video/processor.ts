import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VideoAnalysis, VideoUpload } from "./types";
import { ApiError } from "../agent/http";
const exec = promisify(execFile);
export async function refineVideo(
  media: Buffer,
  analysis: VideoAnalysis,
  attempt: import("./attempts").VideoAttempt,
  signal: AbortSignal,
) {
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
    return {
      analysis: {
        ...analysis,
        sampleTimes: result.sampleTimes,
        identification: attempt.identification,
      },
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
    return { ...result, media: await readFile(path.join(dir, "media.mp4")) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
