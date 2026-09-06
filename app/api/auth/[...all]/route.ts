import { getAuth } from "@/lib/auth";
import { userAllowed } from "@/lib/access";
export const dynamic = "force-dynamic";
function failedSignIn(response?: Response) {
  // The Google callback is a browser navigation. A bare JSON error can appear
  // as a google.json download on iPhone instead of a usable sign-in screen.
  const headers = new Headers({
    Location: "/?signin=failed",
    "Cache-Control": "no-store",
  });
  // Retain expired OAuth-state cookies so a failed flow is cleared normally.
  for (const cookie of response?.headers.getSetCookie() ?? [])
    headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
async function handle(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
  const googleCallback = path === "callback/google";
  try {
    // Also protect the authentication library's own account/session endpoints.
    // Sign-out stays available so a revoked browser can clear its cookie.
    if (!["sign-in/social", "callback/google", "sign-out"].includes(path)) {
      const session = await getAuth().api.getSession({
        headers: request.headers,
      });
      if (session && !(await userAllowed(session.user)))
        return Response.json(
          path === "get-session" ? null : { error: "Sign in again." },
          {
            status: path === "get-session" ? 200 : 401,
            headers: { "Cache-Control": "no-store" },
          },
        );
    }
    const response = await getAuth().handler(request);
    return googleCallback && response.status >= 400
      ? failedSignIn(response)
      : response;
  } catch {
    if (googleCallback) return failedSignIn();
    return Response.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export { handle as GET, handle as POST };
