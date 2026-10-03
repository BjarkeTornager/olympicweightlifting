import { z } from "zod";
import { apiFailure, requireAthlete } from "@/lib/agent/http";
import { readPicture } from "@/lib/coach-pictures";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };

// A picture Coach drew for a recipe card. The apps ask again every second or
// two while it is drawn (202); one that failed, was cut off, was deleted or
// isn't this athlete's is gone (404).
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request);
    const { data: id } = z
      .string()
      .uuid()
      .safeParse((await context.params).id);
    const picture = id ? await readPicture(user.id, id) : null;
    if (!picture)
      return Response.json(
        { status: "unavailable", error: "Picture unavailable." },
        { status: 404, headers },
      );
    if (picture.status === "drawing")
      return Response.json(
        { status: "drawing" },
        { status: 202, headers: { ...headers, "Retry-After": "2" } },
      );
    return new Response(new Uint8Array(picture.data), {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Content-Disposition": `inline; filename="coach-picture-${id}.jpg"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
