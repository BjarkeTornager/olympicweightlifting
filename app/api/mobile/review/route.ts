import { z } from "zod";
import {
  authorizeReview,
  mobileChallenge,
  mobileState,
  pkceChallenge,
} from "@/lib/mobile";
import { reviewEnabled } from "@/lib/review";
import { readJson, apiFailure, ApiError } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
export const dynamic = "force-dynamic";
// The passcode sign-in for Apple's Beta App Review. It returns the same
// PKCE-bound callback as a Google sign-in on the /mobile page.
export async function POST(request: Request) {
  try {
    if (!reviewEnabled()) throw new ApiError("Not found.", 404);
    const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    if (request.headers.get("origin") !== origin)
      throw new ApiError("Untrusted request origin.", 403);
    const bucket = pkceChallenge(
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown",
    );
    if (!(await allowRequest(bucket, "ios-review", 5)))
      throw new ApiError("Please wait before trying again.", 429);
    const input = z
      .object({
        passcode: z.string().min(1).max(200),
        challenge: mobileChallenge,
        state: mobileState,
      })
      .strict()
      .parse(await readJson(request, 2000));
    const { code } = await authorizeReview(input.passcode, input.challenge);
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
