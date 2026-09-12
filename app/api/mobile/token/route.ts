import { exchangeMobile, pkceChallenge } from "@/lib/mobile";
import { readJson, apiFailure, ApiError } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    if (request.headers.get("origin") !== origin)
      throw new ApiError("Untrusted request origin.", 403);
    const bucket = pkceChallenge(
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown",
    );
    if (!(await allowRequest(bucket, "ios-token", 30)))
      throw new ApiError("Please wait before trying again.", 429);
    return Response.json(await exchangeMobile(await readJson(request, 2000)), {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return apiFailure(e);
  }
}
