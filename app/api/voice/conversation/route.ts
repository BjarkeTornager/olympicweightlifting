import { z } from "zod";
import {
  ApiError,
  apiFailure,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
import {
  claimVoiceConversation,
  conversationIdPattern,
} from "@/lib/voice-conversations";

export const dynamic = "force-dynamic";

// The phone registers its ElevenLabs conversation as the call starts, so
// nothing from another account can be handed to it (/api/voice/photo).
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "voice-conversation", 20)))
      throw new ApiError("Too many calls in a minute.", 429);
    const { conversationId, callId } = z
      .object({
        conversationId: z.string().regex(conversationIdPattern),
        callId: z.string().uuid().optional(),
      })
      .strict()
      .parse(await readJson(request, 1000));
    if (!(await claimVoiceConversation(user.id, conversationId, callId)))
      throw new ApiError("This call belongs to another account.", 403);
    return Response.json(
      { registered: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
