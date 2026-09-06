import {
  requireAthlete,
  readJson,
  apiFailure,
  ApiError,
} from "@/lib/agent/http";
import { listFoodPhotos, saveFoodPhoto } from "@/lib/food-photos";
import { allowRequest } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    return Response.json(
      { photos: await listFoodPhotos(user.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "food-photo", 12)))
      throw new ApiError(
        "Please wait a minute before uploading more photos.",
        429,
      );
    return Response.json(
      await saveFoodPhoto(user.id, await readJson(request, 2900000)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
