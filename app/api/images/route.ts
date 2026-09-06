import {
  requireAthlete,
  readJson,
  apiFailure,
  ApiError,
} from "@/lib/agent/http";
import { listUserImages, saveUserImage } from "@/lib/user-images";
import { imageCategorySchema } from "@/lib/images";
import { allowRequest } from "@/lib/server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    const raw = new URL(request.url).searchParams.get("category");
    const category = raw ? imageCategorySchema.parse(raw) : undefined;
    return Response.json(
      { images: await listUserImages(user.id, category) },
      { headers },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "image-upload", 12)))
      throw new ApiError(
        "Please wait a minute before uploading more images.",
        429,
      );
    return Response.json(
      await saveUserImage(user.id, await readJson(request, 2900000)),
      { headers },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
