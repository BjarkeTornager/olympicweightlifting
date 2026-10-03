import { z } from "zod";
import { apiFailure, readJson, requireAthlete } from "@/lib/agent/http";
import { cancelRun } from "@/lib/agent/stream";

export const dynamic = "force-dynamic";

// Stop for a Coach run: the iPhone app's, for a run that carries on in the
// background (see coachStream), and the website's, as well as closing the
// connection. Answers whether a run was cancelled here.
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await readJson(request, 1000));
    return Response.json({ cancelled: cancelRun(`${user.id}:${id}`) });
  } catch (error) {
    return apiFailure(error);
  }
}
