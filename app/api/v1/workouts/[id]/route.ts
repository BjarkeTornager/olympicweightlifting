import { z } from "zod";
import { apiFailure, ApiError, requireAthlete } from "@/lib/agent/http";
import { requireNative } from "@/lib/native-actions";
import { findSession } from "@/lib/native-training";
import { readJournal } from "@/lib/server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

// One session with every exercise and set, as logged.
export async function GET(request: Request, context: Context) {
  try {
    requireNative(request);
    const user = await requireAthlete(request);
    const id = z
      .string()
      .min(1)
      .max(160)
      .parse((await context.params).id);
    const session = findSession((await readJournal(user.id)).state, id);
    if (!session)
      throw new ApiError("That session is not in your journal.", 404);
    return Response.json(session, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return apiFailure(e);
  }
}
