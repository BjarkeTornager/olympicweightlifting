import { z } from "zod";
import { requireAthlete, apiFailure } from "@/lib/agent/http";
import { getVideo, deleteVideo } from "@/lib/video/store";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request);
    return Response.json(
      await getVideo(
        user.id,
        z
          .string()
          .uuid()
          .parse((await context.params).id),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request, true);
    await deleteVideo(
      user.id,
      z
        .string()
        .uuid()
        .parse((await context.params).id),
    );
    return Response.json({ deleted: true });
  } catch (error) {
    return apiFailure(error);
  }
}
