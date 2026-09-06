import { getAuth } from "@/lib/auth";
import { userAllowed } from "@/lib/access";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
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
    return await getAuth().handler(request);
  } catch {
    return Response.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export { handle as GET, handle as POST };
