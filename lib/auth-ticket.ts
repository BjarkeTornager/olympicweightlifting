import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 90;

function secret() {
  return process.env.BETTER_AUTH_SECRET ?? "";
}

function secureCookies() {
  const base = process.env.BETTER_AUTH_URL ?? "";
  return (
    process.env.NODE_ENV === "production" || base.startsWith("https://")
  );
}

export function sessionCookieName() {
  return `${secureCookies() ? "__Secure-" : ""}better-auth.session_token`;
}

export function sessionTokenFromSetCookie(cookies: string[]) {
  for (const cookie of cookies) {
    const pair = cookie.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    if (
      name === "better-auth.session_token" ||
      name === "__Secure-better-auth.session_token"
    )
      return pair.slice(eq + 1);
  }
}

export function sessionCookieHeader(token: string) {
  const parts = [
    `${sessionCookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];
  if (secureCookies()) parts.push("Secure");
  return parts.join("; ");
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
