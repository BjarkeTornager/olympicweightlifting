import { z } from "zod";
import { requireAthlete, apiFailure, ApiError } from "@/lib/agent/http";
import { retryVideo } from "@/lib/video/store";
import { allowRequest } from "@/lib/server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "video-retry", 3)))
      throw new ApiError("Please wait before retrying again.", 429);
    return Response.json(
      await retryVideo(
        user.id,
        z
          .string()
          .uuid()
          .parse((await context.params).id),
      ),
    );
  } catch (error) {
    return apiFailure(error);
  }
}
