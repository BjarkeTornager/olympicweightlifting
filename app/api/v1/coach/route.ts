import { apiFailure, requireAthlete } from "@/lib/agent/http";
import { history } from "@/lib/agent/engine";
import { buildCoach } from "@/lib/native-api";
import { requireNative } from "@/lib/native-actions";

export const dynamic = "force-dynamic";

// The last 40 Coach turns as the app shows them: question, reply and the
// saves each turn made, with their current state.
export async function GET(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    return Response.json(buildCoach(await history(user.id)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return apiFailure(e);
  }
}
