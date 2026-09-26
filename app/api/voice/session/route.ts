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
import { allowRequest, readJournal } from "@/lib/server";
import {
  mintVoiceToken,
  VOICE_MODEL,
  VOICE_SESSION_MINUTES,
  VOICE_SOCKET_URL,
  voiceConfigured,
  voiceContext,
  voiceInstruction,
  voiceSetup,
} from "@/lib/voice-checkin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAthlete(request);
    return Response.json(
      { enabled: voiceConfigured(), model: VOICE_MODEL },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    requireCurrentCoach(request);
    if (!voiceConfigured())
      throw new ApiError(
        "Voice check-in is not set up yet. You can keep logging with Coach.",
        503,
      );
    if (!(await allowRequest(user.id, "voice", 3)))
      throw new ApiError(
        "Please wait a minute before starting another call.",
        429,
      );
    const { timezone, purpose } = z
      .object({
        purpose: z.enum(["checkin", "goals"]).default("checkin"),
        timezone: z
          .string()
          .max(100)
          .refine((v) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }),
      })
      .strict()
      .parse(await readJson(request, 1000));
    const clock = localClock(new Date(), timezone);
    const { state } = await readJournal(user.id);
    const setup = voiceSetup(
      voiceInstruction(
        voiceContext(state, clock.date),
        clock,
        state.profile.name || user.name?.split(" ")[0],
        purpose,
      ),
    );
    let token: string;
    try {
      token = await mintVoiceToken(setup);
    } catch (error) {
      logFailure("voice_token_failed", error);
      throw new ApiError(
        "Voice check-in is unavailable right now. You can keep logging with Coach.",
        503,
      );
    }
    return Response.json(
      {
        url: `${VOICE_SOCKET_URL}?access_token=${encodeURIComponent(token)}`,
        setup,
        maxMinutes: VOICE_SESSION_MINUTES,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
