import { ApiError, apiFailure, requireSignedIn } from "@/lib/agent/http";
import { googleMapsKey } from "@/lib/route-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // The client loads this while rendering a Coach route map and does not know
    // the journal account header; a session is all this endpoint needs.
    await requireSignedIn(request);
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
