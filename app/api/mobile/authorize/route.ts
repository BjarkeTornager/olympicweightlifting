import { z } from "zod";
import { authorizeMobile, mobileChallenge, mobileState } from "@/lib/mobile";
import {
  requireAthlete,
  readJson,
  apiFailure,
  ApiError,
} from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "ios-authorize", 10)))
      throw new ApiError("Please wait before trying again.", 429);
    const input = z
      .object({ challenge: mobileChallenge, state: mobileState })
      .strict()
      .parse(await readJson(request, 2000));
    const { code } = await authorizeMobile(request.headers, input.challenge);
    return Response.json(
      {
        callback: `liftjournal://auth?${new URLSearchParams({ code, state: input.state })}`,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
