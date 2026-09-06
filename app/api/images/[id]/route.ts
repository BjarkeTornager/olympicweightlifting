import { z } from "zod";
import { requireAthlete, readJson, apiFailure } from "@/lib/agent/http";
import {
  readUserImage,
  imageMetadata,
  patchUserImage,
  deleteUserImage,
} from "@/lib/user-images";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    if (new URL(request.url).searchParams.get("metadata") === "1")
      return Response.json(await imageMetadata(user.id, id), { headers });
    const photo = await readUserImage(user.id, id);
    return new Response(new Uint8Array(photo.data), {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Content-Disposition": `inline; filename="image-${photo.date}-${photo.id}.jpg"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request, true);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    return Response.json(
      await patchUserImage(user.id, id, await readJson(request)),
      { headers },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireAthlete(request, true);
    await deleteUserImage(
      user.id,
      z
        .string()
        .uuid()
        .parse((await context.params).id),
    );
    return Response.json({ deleted: true }, { headers });
  } catch (error) {
    return apiFailure(error);
  }
}
