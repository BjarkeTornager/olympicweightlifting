import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { getPool } from "./db";
import { getAuth } from "./auth";
import { userAllowed } from "./access";
import { ApiError } from "./agent/http";

export const mobileChallenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const mobileState = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const tokenInput = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  })
  .strict();
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
const grantKey = (code: string) => `ios-grant:${pkceChallenge(code)}`;

// The browser grants only a short-lived, PKCE-bound code. Session credentials
// never travel through the callback URL, browser storage or the image catalog.
export async function authorizeMobile(headers: Headers, challenge: string) {
  mobileChallenge.parse(challenge);
  const auth = await getAuth().api.getSession({ headers });
  if (!auth || !(await userAllowed(auth.user)))
    throw new ApiError("Sign in with an invited Google account.", 401);
  const code = randomBytes(32).toString("base64url");
  const pool = getPool();
  await pool.query(
    "DELETE FROM auth_verifications WHERE identifier LIKE 'ios-grant:%' AND expires_at < now()",
  );
  await pool.query(
    "INSERT INTO auth_verifications(id,identifier,value,expires_at) VALUES($1,$1,$2,now()+interval '2 minutes')",
    [
      grantKey(code),
      JSON.stringify({
        challenge,
        sessionId: auth.session.id,
        userId: auth.user.id,
      }),
    ],
  );
  return { code };
}

export async function exchangeMobile(raw: unknown) {
  const { code, verifier } = tokenInput.parse(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT value FROM auth_verifications WHERE id=$1 AND expires_at>now() FOR UPDATE",
      [grantKey(code)],
    );
    if (!result.rows[0])
      throw new ApiError("Sign-in expired. Start again in the app.", 401);
    const grant = JSON.parse(result.rows[0].value);
    const actual = pkceChallenge(verifier);
    if (
      actual.length !== grant.challenge.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(grant.challenge))
    )
      throw new ApiError(
        "Sign-in could not be verified. Start again in the app.",
        401,
      );
    const active = await client.query(
      `SELECT s.expires_at, u.id, u.email, u.name, u.email_verified AS "emailVerified"
       FROM auth_sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>now() FOR UPDATE OF s`,
      [grant.sessionId, grant.userId],
    );
    const user = active.rows[0];
    if (!user || !(await userAllowed(user)))
      throw new ApiError("Sign in with an invited Google account.", 401);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Math.min(new Date(user.expires_at).getTime(), Date.now() + 30 * 86400000),
    );
    await client.query(
      "INSERT INTO auth_sessions(id,token,user_id,expires_at,user_agent) VALUES($1,$2,$3,$4,'Lift Journal iOS')",
      [crypto.randomUUID(), token, user.id, expiresAt],
    );
    await client.query("DELETE FROM auth_verifications WHERE id=$1", [
      grantKey(code),
    ]);
    const secret = (await getAuth().$context).secret;
    const signed = `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;
    await client.query("COMMIT");
    return {
      token: signed,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, name: user.name, email: user.email },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
