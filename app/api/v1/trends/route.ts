import { z } from "zod";
import { apiFailure, requireAthlete } from "@/lib/agent/http";
import { buildTrends } from "@/lib/native-api";
import { requireNative } from "@/lib/native-actions";
import { foodDate } from "@/lib/nutrition";
import { readJournal } from "@/lib/server";

export const dynamic = "force-dynamic";

// Per-day sleep, heart rate, movement, water, food and training for the
// app's charts, ending on `date`.
export async function GET(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    const params = new URL(request.url).searchParams;
    const date = foodDate.parse(params.get("date"));
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(62)
      .parse(params.get("days") ?? 14);
    const { state } = await readJournal(user.id);
    return Response.json(buildTrends(state, date, days), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return apiFailure(e);
  }
}
