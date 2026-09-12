import { z } from "zod";
import { requireAthlete, apiFailure } from "@/lib/agent/http";
import { videoMedia, mediaRange } from "@/lib/video/store";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAthlete(request),
      id = z
        .string()
        .uuid()
        .parse((await context.params).id);
    const data = await videoMedia(user.id, id),
      range = mediaRange(request.headers.get("range"), data.length);
    return new Response(
      new Uint8Array(data.subarray(range.start, range.end + 1)),
      {
        status: range.partial ? 206 : 200,
        headers: {
          "Content-Type": "video/mp4",
          "Cache-Control": "private, no-store",
          "Accept-Ranges": "bytes",
          "Content-Length": String(range.end - range.start + 1),
          "Content-Disposition": `inline; filename="lifting-review-${id}.mp4"`,
          "X-Content-Type-Options": "nosniff",
          ...(range.partial
            ? {
                "Content-Range": `bytes ${range.start}-${range.end}/${data.length}`,
              }
            : {}),
        },
      },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
