import { z } from "zod";
import {
  ApiError,
  apiFailure,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { saveVoiceTranscript } from "@/lib/conversation-memory";
import { allowRequest } from "@/lib/server";

export const dynamic = "force-dynamic";

// Keeps a voice call's transcript so Coach can recall it later. The phone
// sends the whole transcript so far; each save replaces the previous one.
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "voice-transcript", 30)))
      throw new ApiError("Please wait a moment.", 429);
    const call = z
      .object({
        id: z.string().uuid(),
        purpose: z.enum(["checkin", "goals"]),
        entries: z
          .array(
            z
              .object({
                role: z.enum(["you", "coach"]),
                text: z.string().max(4000),
              })
              .strict(),
          )
          .min(1)
          .max(400),
      })
      .strict()
      .parse(await readJson(request, 400000));
    await saveVoiceTranscript(user.id, call);
    return Response.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
