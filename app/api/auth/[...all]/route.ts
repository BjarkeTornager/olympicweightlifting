import { getAuth } from "@/lib/auth";
import { userAllowed } from "@/lib/access";
import {
  issueAuthTicket,
  redeemAuthTicket,
  sessionCookieHeader,
  sessionTokenFromSetCookie,
} from "@/lib/auth-ticket";
export const dynamic = "force-dynamic";

function appOrigin() {
  return new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
    .origin;
}

function sameOriginDestination(location: string | null) {
  const origin = appOrigin();
  if (!location) return `${origin}/`;
  if (
    location.startsWith("/") &&
    !location.startsWith("//") &&
    !location.includes("\\")
  )
    return `${origin}${location}`;
  try {
    const url = new URL(location);
    if (
      url.origin !== origin ||
      (url.protocol !== "https:" && url.protocol !== "http:")
    )
      return `${origin}/`;
    if (url.username || url.password) return `${origin}/`;
    return url.href;
  } catch {
    return `${origin}/`;
  }
}

function htmlEscape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
}

function copyCookies(from: Response | undefined, to: Headers) {
  for (const cookie of from?.headers.getSetCookie() ?? [])
    to.append("Set-Cookie", cookie);
}

function failedSignIn(response?: Response) {
  // The Google callback is a browser navigation. A bare JSON error can appear
  // as a google.json download on iPhone instead of a usable sign-in screen.
  const headers = new Headers({
    Location: "/?signin=failed",
    "Cache-Control": "no-store",
  });
  copyCookies(response, headers);
  return new Response(null, { status: 303, headers });
}

function finishGoogleNavigation(response: Response) {
  // Cookies on the Google→callback hop are dropped as a bounce. Set the
  // session cookie from this first-party page with fetch, then continue.
  const destination = sameOriginDestination(response.headers.get("Location"));
  const token = sessionTokenFromSetCookie(response.headers.getSetCookie());
  const ticket = token ? issueAuthTicket(token) : "";
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  copyCookies(response, headers);
  const html = `<!doctype html><meta charset="utf-8"><title>Signing in</title><p>Signing in…</p><p><a href="${htmlEscape(destination)}">Continue</a></p><script>
(async () => {
  const ticket = ${JSON.stringify(ticket).replace(/</g, "\\u003c")};
  const next = ${JSON.stringify(destination).replace(/</g, "\\u003c")};
  try {
    if (ticket) await fetch("/api/auth/complete", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) });
  } catch (e) {}
  location.replace(next);
})();
</script>`;
  return new Response(html, { status: 200, headers });
}

async function completeGoogleSession(request: Request) {
  const origin = appOrigin();
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin)
    return Response.json({ error: "Sign-in is unavailable." }, { status: 403 });
  let ticket = "";
  try {
    const body = (await request.json()) as { ticket?: unknown };
    ticket = typeof body.ticket === "string" ? body.ticket : "";
  } catch {
    ticket = "";
  }
  const token = redeemAuthTicket(ticket);
  if (!token)
    return Response.json({ error: "Sign-in expired. Try Google again." }, {
      status: 401,
    });
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": sessionCookieHeader(token),
        "Cache-Control": "private, no-store",
      },
    },
  );
}

async function handle(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
  if (path === "complete") {
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    return completeGoogleSession(request);
  }
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
    if (!googleCallback) return response;
    if (response.status >= 400) return failedSignIn(response);
    if (response.status >= 300) return finishGoogleNavigation(response);
    return response;
  } catch {
    if (googleCallback) return failedSignIn();
    return Response.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export { handle as GET, handle as POST };
