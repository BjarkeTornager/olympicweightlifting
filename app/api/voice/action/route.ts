import { z } from "zod";
import {
  ApiError,
  apiFailure,
  readJson,
  requireAthlete,
  requireCurrentCoach,
} from "@/lib/agent/http";
import { localClock } from "@/lib/agent/time-context";
import { logFailure } from "@/lib/error-log";
import { allowRequest } from "@/lib/server";
import {
  runVoiceTool,
  voiceFailure,
  voiceToolArgs,
  type VoiceToolName,
} from "@/lib/voice-actions";

export const dynamic = "force-dynamic";

const timezone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });

// One save requested by the voice coach. A refused save is an ordinary answer
// the coach reads back to the athlete, so it returns 200 with the reason.
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    requireCurrentCoach(request);
    if (!(await allowRequest(user.id, "voice-action", 30)))
      throw new ApiError("Please wait a moment before saving again.", 429);
    const input = z
      .object({
        id: z.string().uuid(),
        name: z.enum(
          Object.keys(voiceToolArgs) as [VoiceToolName, ...VoiceToolName[]],
        ),
        args: z.record(z.string(), z.unknown()),
        timezone,
        seenPhotoIds: z.array(z.string().uuid()).max(40).default([]),
      })
      .strict()
      .parse(await readJson(request, 32000));
    const today = localClock(new Date(), input.timezone).date;
    try {
      return Response.json(await runVoiceTool(user.id, { ...input, today }), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (!(error instanceof Error) || error instanceof ApiError) throw error;
      if (!(error instanceof z.ZodError) && error.constructor !== Error)
        logFailure("voice_action_failed", error);
      return Response.json(
        { ok: false, error: voiceFailure(error) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (e) {
    return apiFailure(e);
  }
}
