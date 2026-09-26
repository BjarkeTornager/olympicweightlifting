import { z } from "zod";
import { apiFailure, ApiError, requireAthlete } from "@/lib/agent/http";
import { flattenVisual } from "@/lib/native-api";
import { requireNative } from "@/lib/native-actions";
import { recordedRouteVisual } from "@/lib/route-summary";
import { readJournal } from "@/lib/server";
import { recordedRoute } from "@/lib/workout-routes";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// The GPS route Apple Health recorded for one activity, drawn by the app the
// same way as a route in Coach.
export async function GET(request: Request, { params }: Context) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const { state } = await readJournal(user.id);
    const entry = state.cardio.sessions.find((s) => s.id === id);
    const route = entry && (await recordedRoute(user.id, state, id));
    if (!entry || !route)
      throw new ApiError("No route was recorded for this activity.", 404);
    return Response.json(
      flattenVisual({ id, content: recordedRouteVisual(entry, route) }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
