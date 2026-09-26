import {
  apiFailure,
  ApiError,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { syncHealth } from "@/lib/health-sync";
import { healthSyncResult } from "@/lib/native-api";
import { requireNative } from "@/lib/native-actions";
import { allowRequest } from "@/lib/server";

export const dynamic = "force-dynamic";

// Sleep, daily heart-rate summaries and workouts read from Apple Health by
// the iPhone app, in one batch. Repeated batches are harmless.
export async function POST(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "health-sync", 30)))
      throw new ApiError("Please wait a minute before syncing again.", 429);
    const result = await syncHealth(user.id, await readJson(request, 1500000));
    return Response.json(
      healthSyncResult.parse({
        ...result,
        sleep: result.sleep.map(({ hours, error, ...s }) => ({
          ...s,
          ...(hours != null ? { hours } : {}),
          ...(error ? { error } : {}),
        })),
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
