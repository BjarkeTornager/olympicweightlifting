import { requireAthlete, apiFailure, ApiError } from "@/lib/agent/http";
import { listVideos, saveVideo } from "@/lib/video/store";
import { MAX_VIDEO_BYTES, videoUploadSchema } from "@/lib/video/types";
import { allowRequest } from "@/lib/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    return Response.json({ videos: await listVideos(user.id) }, { headers });
  } catch (error) {
    return apiFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "video-upload", 6)))
      throw new ApiError(
        "Please wait a minute before uploading another video.",
        429,
      );
    if (process.env.VIDEO_ANALYSIS_WORKER !== "1")
      throw new ApiError(
        "Video processing is not enabled on this server yet. Use the on-device frame review below.",
        503,
      );
    // Metadata lives in a small header; the video is a bounded binary stream.
    const raw = request.headers.get("x-video-metadata") ?? "";
    if (raw.length > 6000)
      throw new ApiError("Video details are too long.", 413);
    let metadata;
    try {
      metadata = videoUploadSchema.parse(JSON.parse(decodeURIComponent(raw)));
    } catch {
      throw new ApiError(
        "Check the lift, clip interval and optional calibration.",
      );
    }
    if (Number(request.headers.get("content-length")) > MAX_VIDEO_BYTES)
      throw new ApiError("Choose a video under 50 MB.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError("Choose a video first.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_VIDEO_BYTES)
          throw new ApiError("Choose a video under 50 MB.", 413);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    return Response.json(
      await saveVideo(user.id, metadata, Buffer.concat(chunks)),
      { status: 202, headers },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
