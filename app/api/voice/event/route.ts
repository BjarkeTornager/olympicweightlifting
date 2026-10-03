import { z } from "zod";
import { apiFailure, readJson, requireAthlete } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
import { startTrace } from "@/lib/tracing/spans";
import { callSession } from "@/lib/tracing/ids";

export const dynamic = "force-dynamic";

// Voice connection problems reported by the phone, logged so a dropped call
// can be diagnosed. Codes and short reasons only; never conversation content.
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "voice-event", 30)))
      return Response.json({ logged: false });
    const event = z
      .object({
        event: z.enum([
          "socket_closed",
          "go_away",
          "reconnected",
          "reconnect_failed",
        ]),
        code: z.number().int().optional(),
        reason: z.string().max(200).optional(),
        attempts: z.number().int().min(0).max(20).optional(),
        resumed: z.number().int().min(0).max(1).optional(),
        // The call it happened in, the transcript's id. Groups the call's
        // diagnostic traces; apps that don't send it are still logged.
        callId: z.string().uuid().optional(),
      })
      .strict()
      .parse(await readJson(request, 1000));
    const { callId, ...report } = event;
    console.warn(
      JSON.stringify({
        ...report,
        event: `voice_${event.event}`,
        account: user.id.slice(0, 8),
      }),
    );
    // The same report as a voice_socket trace with the call's others
    // (lib/tracing): the codes and counts, never the reason's text.
    const trace = await startTrace(
      "voice_socket",
      { userId: user.id, session: () => callSession(user.id, callId) },
      {
        "lift.socket_event": event.event,
        "lift.close_code": event.code,
        "lift.reconnect_attempts": event.attempts,
        "lift.resumed":
          event.resumed === undefined ? undefined : event.resumed === 1,
      },
    );
    trace.end();
    await trace.settle();
    return Response.json({ logged: true });
  } catch (e) {
    return apiFailure(e);
  }
}
