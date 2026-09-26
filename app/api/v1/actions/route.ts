import {
  apiFailure,
  ApiError,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { actionResult } from "@/lib/native-api";
import { applyNativeAction, requireNative } from "@/lib/native-actions";
import { allowRequest } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "native-action", 120)))
      throw new ApiError("Please wait a moment before saving again.", 429);
    return Response.json(
      actionResult.parse(
        await applyNativeAction(user.id, await readJson(request, 32000)),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
