import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 90;

function secret() {
  return process.env.BETTER_AUTH_SECRET ?? "";
}

// The session token for this exact sign-in, read from the Set-Cookie header
// Better Auth put on its own callback response. Nothing is shared between
// requests, so a concurrent sign-in can never receive someone else's session.
export function sessionTokenFromResponse(response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq < 1 || !pair.slice(0, eq).trim().endsWith("better-auth.session_token"))
      continue;
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return;
    }
    // Signed cookies are "<token>.<signature>"; tokens contain no dots.
    const token = value.split(".")[0];
    return token && token.length >= 16 ? token : undefined;
  }
}

export function appendAuthTicket(destination: string, ticket: string) {
  const url = new URL(destination);
  url.searchParams.set("auth", ticket);
  return url.href;
}

export function issueAuthTicket(sessionToken: string) {
  const payload = Buffer.from(
    JSON.stringify({
      t: sessionToken,
      exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function redeemAuthTicket(ticket: string) {
  const [payload, sig] = ticket.split(".");
  if (!payload || !sig || !secret()) return;
  const expected = createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      t?: unknown;
      exp?: unknown;
    };
    if (
      typeof data.t !== "string" ||
      data.t.length < 16 ||
      typeof data.exp !== "number" ||
      data.exp < Math.floor(Date.now() / 1000)
    )
      return;
    return data.t;
  } catch {
    return;
  }
}
