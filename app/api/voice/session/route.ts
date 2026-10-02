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
import { isCreditError, VOICE_CREDIT_MESSAGE } from "@/lib/voice-live";
import { nativeClient } from "@/lib/native-client";
import { allowRequest, readJournal } from "@/lib/server";
import { recentConversations } from "@/lib/conversation-memory";
import { routeNotesFor } from "@/lib/workout-routes";
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
import {
  ELEVENLABS_CALL_MINUTES,
  ELEVENLABS_CREDIT_MESSAGE,
  ELEVENLABS_TTS_MODEL,
  ElevenLabsError,
  elevenLabsSignedUrl,
  elevenLabsStart,
  voiceProviders,
} from "@/lib/voice-elevenlabs";
import { voiceFor } from "@/lib/voice-options";
import { coachLanguageSchema } from "@/lib/coach-language";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAthlete(request);
    return Response.json(
      {
        enabled: voiceConfigured(),
        model: VOICE_MODEL,
        providers: voiceProviders(),
      },
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
    const raw = await readJson(request, 4000);
    // An older app would start a call with outdated tools and time limits.
    // A call already in progress may still reconnect, so a release never
    // cuts off a conversation.
    // Installed iPhone builds are gated by build number in requireCurrentCoach.
    if (
      !nativeClient(request) &&
      Number(request.headers.get("x-voice-client") ?? 0) < 3 &&
      !(raw && typeof raw === "object" && "resumeHandle" in raw)
    )
      throw new ApiError(
        "Tap Reload update, or close and reopen the app, to use the latest voice coach.",
        426,
      );
    const { timezone, purpose, resumeHandle, provider, language, voice } = z
      .object({
        purpose: z.enum(["checkin", "goals"]).default("checkin"),
        // Chosen in the iPhone app's Profile; the website uses Google.
        provider: z.enum(["google", "elevenlabs"]).default("google"),
        // Chosen in Profile; a voice that isn't on the list gets the default.
        language: coachLanguageSchema.optional(),
        voice: z.string().max(64).optional(),
        // Continues an interrupted call; Google validates the handle.
        resumeHandle: z.string().min(1).max(2000).optional(),
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
      .parse(raw);
    if (!voiceProviders().includes(provider))
      throw new ApiError(
        provider === "elevenlabs"
          ? "ElevenLabs voice is not set up. Switch to Google in Profile."
          : "Voice check-in is not set up yet. You can keep logging with Coach.",
        503,
      );
    if (!(await allowRequest(user.id, "voice", 6)))
      throw new ApiError(
        "Please wait a minute before starting another call.",
        429,
      );
    const clock = localClock(new Date(), timezone);
    const { state } = await readJournal(user.id);
    const instruction = voiceInstruction(
      voiceContext(
        state,
        clock.date,
        await routeNotesFor(user.id, state, clock.date, clock.date),
      ),
      clock,
      state.profile.name || user.name?.split(" ")[0],
      purpose,
      await recentConversations(user.id, { limit: 10 }),
      { savedPhotos: provider === "google", language },
    );
    if (provider === "elevenlabs") {
      let url: string;
      try {
        url = await elevenLabsSignedUrl();
      } catch (error) {
        logFailure("voice_elevenlabs_failed", error);
        throw new ApiError(
          error instanceof ElevenLabsError && error.credit
            ? ELEVENLABS_CREDIT_MESSAGE
            : "ElevenLabs voice is unavailable right now. Switch to Google in Profile, or keep logging with Coach.",
          503,
        );
      }
      return Response.json(
        {
          provider,
          url,
          start: elevenLabsStart(instruction, {
            voice: voiceFor(provider, voice),
            language,
          }),
          model: ELEVENLABS_TTS_MODEL,
          maxMinutes: ELEVENLABS_CALL_MINUTES,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const setup = voiceSetup(instruction, resumeHandle, {
      voice: voiceFor(provider, voice),
      language,
    });
    let token: string;
    try {
      token = await mintVoiceToken(setup);
    } catch (error) {
      logFailure("voice_token_failed", error);
      throw new ApiError(
        error instanceof Error && isCreditError(error.message)
          ? VOICE_CREDIT_MESSAGE
          : "Voice check-in is unavailable right now. You can keep logging with Coach.",
        503,
      );
    }
    return Response.json(
      {
        provider,
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
