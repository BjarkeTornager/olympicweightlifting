import { after } from "next/server";
import { apiFailure, requireAthlete } from "@/lib/agent/http";
import { listVoiceCalls, tidyVoiceCall } from "@/lib/conversation-memory";
import { voiceCallsResponse } from "@/lib/native-api";
import { requireNative } from "@/lib/native-actions";

export const dynamic = "force-dynamic";

// Voice calls from the last 30 days for the Coach thread, newest last. A
// call an app didn't mark as ended is tidied a few minutes after its last
// save, so the next load shows the tidy transcript.
export async function GET(request: Request) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    const calls = await listVoiceCalls(user.id, {
      since: new Date(Date.now() - 30 * 86400000),
    });
    const settled = Date.now() - 3 * 60000;
    const untidy = calls
      .filter((c) => !c.tidied && Date.parse(c.endedAt) < settled)
      .slice(-3);
    if (untidy.length)
      after(async () => {
        for (const c of untidy)
          await tidyVoiceCall(user.id, c.id).catch(() => {});
      });
    return Response.json(
      voiceCallsResponse.parse({
        calls: calls.map((c) => ({
          id: c.id,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          lines: c.lines,
        })),
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
