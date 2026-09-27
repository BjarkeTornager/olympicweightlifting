import { apiFailure, requireAthlete } from "@/lib/agent/http";
import { requireNative } from "@/lib/native-actions";
import { buildTraining } from "@/lib/native-training";
import { foodDate } from "@/lib/nutrition";
import { readJournal } from "@/lib/server";

export const dynamic = "force-dynamic";

// Train in the app: programmes, the ongoing workout and recent sessions.
export async function GET(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    const date = foodDate.parse(new URL(request.url).searchParams.get("date"));
    const snapshot = await readJournal(user.id);
    return Response.json(
      buildTraining(snapshot.state, snapshot.revision, date),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
