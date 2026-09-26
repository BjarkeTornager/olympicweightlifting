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
    if (!voiceConfigured())
      throw new ApiError(
        "Voice check-in is not set up yet. You can keep logging with Coach.",
        503,
      );
    if (!(await allowRequest(user.id, "voice", 6)))
      throw new ApiError(
        "Please wait a minute before starting another call.",
        429,
      );
    const { timezone, purpose, resumeHandle } = z
      .object({
        purpose: z.enum(["checkin", "goals"]).default("checkin"),
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
    const clock = localClock(new Date(), timezone);
    const { state } = await readJournal(user.id);
    const setup = voiceSetup(
      voiceInstruction(
        voiceContext(
          state,
          clock.date,
          await routeNotesFor(user.id, state, clock.date, clock.date),
        ),
        clock,
        state.profile.name || user.name?.split(" ")[0],
        purpose,
        await recentConversations(user.id, { limit: 10 }),
      ),
      resumeHandle,
    );
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
