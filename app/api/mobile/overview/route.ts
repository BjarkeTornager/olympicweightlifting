import { requireAthlete, apiFailure } from "@/lib/agent/http";
import { readJournal } from "@/lib/server";
import { dailyHealth } from "@/lib/health";
import { foodDate } from "@/lib/nutrition";
import { days, EXERCISES } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    const date = foodDate.parse(new URL(request.url).searchParams.get("date"));
    const snapshot = await readJournal(user.id);
    return Response.json({
      ...snapshot,
      overview: dailyHealth(snapshot.state, date),
      programmes: days,
      exercises: EXERCISES,
    });
  } catch (e) {
    return apiFailure(e);
  }
}
