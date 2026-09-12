import { z } from "zod";
import {
  requireAthlete,
  readJson,
  apiFailure,
  ApiError,
} from "@/lib/agent/http";
import { readJournal, allowRequest } from "@/lib/server";
import { actionSchema, prepareAction } from "@/lib/agent/actions";
import { athleteDate } from "@/lib/agent/engine";
export const dynamic = "force-dynamic";
// Native forms use the same domain rules as Coach. Preparing never writes;
// the app submits the resulting snapshot through the existing journal PUT.
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "ios-prepare", 60)))
      throw new ApiError("Please wait before trying again.", 429);
    const input = z
      .object({
        action: actionSchema,
        revision: z.number().int().min(0),
        timezone: z.string().max(100),
      })
      .strict()
      .parse(await readJson(request, 100000));
    const snapshot = await readJournal(user.id);
    if (snapshot.revision !== input.revision)
      throw new ApiError(
        "Your journal changed on another device. Refresh before saving; your form is kept.",
        409,
      );
    const prepared = prepareAction(
      snapshot.state,
      input.action,
      athleteDate(input.timezone),
    );
    return Response.json({
      state: prepared.state,
      revision: snapshot.revision,
    });
  } catch (e) {
    return apiFailure(e);
  }
}
