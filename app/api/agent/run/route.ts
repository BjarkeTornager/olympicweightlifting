import { after } from "next/server";
import { z } from "zod";
import {
  requireAthlete,
  requireCurrentCoach,
  readJson,
  apiFailure,
  ApiError,
  drawsRecipeCards,
} from "@/lib/agent/http";
import { providerConfig } from "@/lib/agent/provider";
import { allowRequest } from "@/lib/server";
import { parseCoachRun } from "@/lib/agent/input";
import {
  coachStream,
  resumeCoachStream,
  storedCoachStream,
} from "@/lib/agent/stream";
import { resumePoint, turnEventsEnabled } from "@/lib/agent/turn-events";
import { runTurn } from "@/lib/agent/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    requireCurrentCoach(request);
    const { threadId, input } = parseCoachRun(await readJson(request, 32000));
    if (!providerConfig())
      throw new ApiError(
        "Your coach is not connected yet. You can keep logging manually.",
        503,
      );
    if (!(await allowRequest(user.id, "agent", 10)))
      throw new ApiError(
        "Please wait a minute before sending another message.",
        429,
      );
    // The iPhone app keeps Coach working when the athlete switches app,
    // and reads the saved reply when it's back.
    const background = request.headers.get("x-coach-background") === "1";
    const hooks = {
      directLogging: request.headers.get("x-coach-logging-version") === "1",
      liftingBriefReview:
        request.headers.get("x-lifting-coach-version") === "1",
      recipeCards: drawsRecipeCards(request),
      // A picture still drawing when the reply ends keeps a release's
      // shutdown waiting for it.
      waitUntil: after,
      background,
    };
    // With COACH_TURN_EVENTS on, the reply streams from Postgres, so an app
    // whose connection drops can read on with GET below. Closing the
    // connection still stops a run that isn't a background one: that is the
    // website's Stop.
    if (turnEventsEnabled())
      return storedCoachStream(
        request,
        threadId,
        input.id,
        (emit, signal, onAttempt) =>
          runTurn(user.id, input, undefined, {
            ...hooks,
            emit,
            signal,
            onAttempt,
          }),
        { key: `${user.id}:${input.id}`, background, waitUntil: after },
      );
    return coachStream(
      request,
      threadId,
      input.id,
      (emit, signal) =>
        runTurn(user.id, input, undefined, { ...hooks, emit, signal }),
      background ? { background: { key: `${user.id}:${input.id}` } } : {},
    );
  } catch (error) {
    return apiFailure(error);
  }
}

const resumeQuery = z.object({
  turnId: z.string().uuid(),
  // The last SSE id the app read; none reads from the start of the reply.
  after: z.coerce.number().int().min(0).max(1000000).default(0),
});

// Reconnects to a Coach reply after a dropped connection, with
// COACH_TURN_EVENTS on: GET /api/agent/run?turnId=<id>&after=<last SSE id>
// (or the Last-Event-ID header) sends the turn's events after that one,
// then the rest until it ends. It never starts or retries a turn; POST does.
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    const url = new URL(request.url);
    const { turnId, after: seen } = resumeQuery.parse({
      turnId: url.searchParams.get("turnId"),
      after:
        url.searchParams.get("after") ??
        request.headers.get("last-event-id") ??
        undefined,
    });
    if (!turnEventsEnabled())
      throw new ApiError(
        "This reply can't be resumed. Reload Coach to see the saved reply.",
        404,
      );
    const from = await resumePoint(user.id, turnId, seen);
    if (!from) throw new ApiError("That message wasn't found.", 404);
    return resumeCoachStream("coach", turnId, { ...from, started: seen === 0 });
  } catch (error) {
    return apiFailure(error);
  }
}
