import { z } from "zod";
import { apiFailure, requireAthlete } from "@/lib/agent/http";
import { importedCardioIds } from "@/lib/health-sync";
import { buildJournal } from "@/lib/native-api";
import { requireNative } from "@/lib/native-actions";
import { foodDate } from "@/lib/nutrition";
import { offsetDate } from "@/lib/health";
import { readJournal } from "@/lib/server";
import { routeNotesFor } from "@/lib/workout-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    const params = new URL(request.url).searchParams;
    const before = foodDate.parse(params.get("before"));
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(62)
      .parse(params.get("days") ?? 14);
    const [snapshot, fromAppleHealth] = await Promise.all([
      readJournal(user.id),
      importedCardioIds(user.id),
    ]);
    const routes = await routeNotesFor(
      user.id,
      snapshot.state,
      offsetDate(before, -days),
      offsetDate(before, -1),
    );
    return Response.json(
      buildJournal(
        snapshot.state,
        snapshot.revision,
        before,
        days,
        fromAppleHealth,
        routes,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
