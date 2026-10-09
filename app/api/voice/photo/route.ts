import sharp from "sharp";
import { z } from "zod";
import {
  ApiError,
  apiFailure,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { logFailure } from "@/lib/error-log";
import { allowRequest } from "@/lib/server";
import { readUserImage } from "@/lib/user-images";
import { elevenLabsConfigured, elevenLabsPhoto } from "@/lib/voice-elevenlabs";
import { countUse } from "@/lib/feature-use";
import {
  claimVoiceConversation,
  conversationIdPattern,
} from "@/lib/voice-conversations";

export const dynamic = "force-dynamic";

// A photo the athlete just took in an ElevenLabs call, handed to that
// conversation so the coach sees it (Gemini Live gets it straight from the
// phone). Only the athlete's own photos, and only to their own
// conversation; the API key stays here.
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!elevenLabsConfigured())
      throw new ApiError("ElevenLabs voice is not set up.", 503);
    if (!(await allowRequest(user.id, "voice-photo", 20)))
      throw new ApiError("Too many photos in a minute.", 429);
    const { conversationId, photoId } = z
      .object({
        conversationId: z.string().regex(conversationIdPattern),
        photoId: z.string().uuid(),
      })
      .strict()
      .parse(await readJson(request, 2000));
    if (!(await claimVoiceConversation(user.id, conversationId)))
      throw new ApiError("This call belongs to another account.", 403);
    const photo = await readUserImage(user.id, photoId);
    // The size the coach needs, like the photo Gemini gets from the phone:
    // a full camera photo is several MB and slows the upload.
    const small = await sharp(photo.data)
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    try {
      const fileId = await elevenLabsPhoto(conversationId, small);
      void countUse(user.id, "voice.photo.elevenlabs");
      return Response.json(
        { fileId },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      logFailure("voice_photo_failed", error);
      throw new ApiError("The photo couldn't be shown to the coach.", 502);
    }
  } catch (error) {
    return apiFailure(error);
  }
}
