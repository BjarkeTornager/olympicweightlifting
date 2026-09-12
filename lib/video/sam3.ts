import { createHash } from "node:crypto";
import { segmentationSchema, type VideoSegmentation } from "./segmentation";
import type { VideoAnalysis } from "./types";

const MAX_RESPONSE = 2_000_000;
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
  try {
    signal.throwIfAborted();
    if (!config.endpoint || !config.token || config.token.length < 32)
      throw Error("Configuration");
    const url = new URL(config.endpoint);
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
    const response = await request(url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
      headers: {
        "Content-Type": "video/mp4",
        Authorization: `Bearer ${config.token}`,
        "X-SAM3-Manifest": JSON.stringify(manifest),
      },
      body: new Uint8Array(media),
    });
    if (!response.ok || !response.body) throw Error("Unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE) throw Error("Oversize");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const result = segmentationSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
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
    return result;
  } catch {
    // Account deletion/cancellation must abort the job; an optional GPU outage
    // must not discard the usable video or misrepresent SAM as having run.
    signal.throwIfAborted();
    console.warn(JSON.stringify({ event: "video_segmentation_unavailable" }));
    return unavailable();
  }
}
