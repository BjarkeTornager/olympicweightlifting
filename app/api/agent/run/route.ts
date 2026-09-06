import {
  requireAthlete,
  readJson,
  apiFailure,
  ApiError,
} from "@/lib/agent/http";
import { providerConfig } from "@/lib/agent/provider";
import { allowRequest } from "@/lib/server";
import { parseCoachRun } from "@/lib/agent/input";
import { coachStream } from "@/lib/agent/stream";
import { runTurn } from "@/lib/agent/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
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
    return coachStream(request, threadId, input.id, (emit, signal) =>
      runTurn(user.id, input, undefined, { emit, signal }),
    );
  } catch (error) {
    return apiFailure(error);
  }
}
