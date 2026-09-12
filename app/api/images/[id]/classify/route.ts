import { z } from "zod";
import {
  requireAthlete,
  readJson,
  apiFailure,
  ApiError,
} from "@/lib/agent/http";
import { tagUserImage } from "@/lib/user-images";
import { allowRequest } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAthlete(request, true);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { version } = z
      .object({ version: z.number().int().min(0) })
      .strict()
      .parse(await readJson(request));
    if (!(await allowRequest(user.id, "image-classify", 6)))
      throw new ApiError(
        "Please wait a minute before tagging more images.",
        429,
      );
    return Response.json(await tagUserImage(user.id, id, version), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
