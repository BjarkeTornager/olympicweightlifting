import { z } from "zod";
import { requireAthlete, apiFailure } from "@/lib/agent/http";
import { readFoodPhoto, deleteFoodPhoto } from "@/lib/food-photos";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const photo = await readFoodPhoto(user.id, id);
    return new Response(new Uint8Array(photo.data), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="meal-${photo.date}-${photo.id}.jpg"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request, true);
    await deleteFoodPhoto(
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
