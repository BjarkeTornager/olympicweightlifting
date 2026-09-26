import { z } from "zod";
import { apiFailure, readJson, requireAthlete } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";

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
      })
      .strict()
      .parse(await readJson(request, 1000));
    console.warn(
      JSON.stringify({
        ...event,
        event: `voice_${event.event}`,
        account: user.id.slice(0, 8),
      }),
    );
    return Response.json({ logged: true });
  } catch (e) {
    return apiFailure(e);
  }
}
