import { z } from "zod";
import { applyProposal } from "@/lib/agent/engine";
import {
  apiFailure,
  ApiError,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "agent-action", 30)))
      throw new ApiError("Please wait before retrying.", 429);
    const input = z
      .object({ id: z.string().uuid(), undo: z.boolean().default(false) })
      .strict()
      .parse(await readJson(request));
    return Response.json(await applyProposal(user.id, input.id, input.undo), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiFailure(e);
  }
}
