import { apiFailure, requireAthlete } from "@/lib/agent/http";
import { importedCardioIds } from "@/lib/health-sync";
import { buildToday } from "@/lib/native-api";
import { requireNative } from "@/lib/native-actions";
import { foodDate } from "@/lib/nutrition";
import { readJournal } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    const date = foodDate.parse(new URL(request.url).searchParams.get("date"));
    const [snapshot, fromAppleHealth] = await Promise.all([
      readJournal(user.id),
      importedCardioIds(user.id),
    ]);
    return Response.json(
      buildToday(snapshot.state, snapshot.revision, date, fromAppleHealth),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
