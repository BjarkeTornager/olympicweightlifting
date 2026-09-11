import { z } from "zod";
import { requireAthlete, apiFailure, ApiError } from "@/lib/agent/http";
import { reanalyseVideo } from "@/lib/video/store";
import { allowRequest } from "@/lib/server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAthlete(request, true);
    if (process.env.VIDEO_ANALYSIS_WORKER !== "1")
      throw new ApiError(
        "Video processing is unavailable. Try again shortly.",
        503,
      );
    if (!(await allowRequest(user.id, "video-retry", 3)))
      throw new ApiError("Please wait before requesting another review.", 429);
    // No arbitrary notes, URLs or media in a correction; only a bounded enum.
    const raw = request.headers.get("X-Video-Lift");
    if (!raw || raw.length > 80) throw new ApiError("Choose a lift type.", 400);
    return Response.json(
      await reanalyseVideo(
        user.id,
        z
          .string()
          .uuid()
          .parse((await context.params).id),
        { lift: raw },
      ),
    );
  } catch (error) {
    return apiFailure(error);
  }
}
