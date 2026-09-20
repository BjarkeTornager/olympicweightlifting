import { ApiError, apiFailure, requireAthlete } from "@/lib/agent/http";
import { googleMapsKey } from "@/lib/route-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAthlete(request);
    const key = googleMapsKey();
    if (!key)
      throw new ApiError("Google Maps is not connected yet.", 503);
    return Response.json(
      { key },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
