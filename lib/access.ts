import { getPool } from "./db";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const ownerEmail = () => normalizeEmail(process.env.OWNER_EMAIL ?? "");
export const isOwnerEmail = (email: string) =>
  Boolean(ownerEmail()) && normalizeEmail(email) === ownerEmail();

export function assertAccessConfigured() {
  if (
    process.env.NODE_ENV === "production" &&
    !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(ownerEmail())
  )
    throw Error("Set OWNER_EMAIL for the private journal");
}

// ALLOWED_EMAILS is only a development fixture. Production has one configured
// owner and explicit database invitations; no empty-list/public-signup fallback.
export async function emailAllowed(email: string) {
  assertAccessConfigured();
  const normalized = normalizeEmail(email);
  if (isOwnerEmail(normalized)) return true;
  if (process.env.NODE_ENV !== "production" && !ownerEmail()) {
    const allowed = (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean);
    if (!allowed.length || allowed.includes(normalized)) return true;
  }
  const result = await getPool().query(
    "SELECT 1 FROM journal_invitations WHERE email=$1 AND revoked_at IS NULL",
    [normalized],
  );
  return Boolean(result.rowCount);
}

export async function userAllowed(user: {
  id: string;
  email: string;
  emailVerified: boolean;
}) {
  if (!(await emailAllowed(user.email))) return false;
  if (process.env.NODE_ENV !== "production") return true;
  if (!user.emailVerified) return false;
  const result = await getPool().query(
    `SELECT 1 FROM auth_accounts WHERE user_id=$1 AND provider_id='google'
     AND issuer IN ('https://accounts.google.com', 'accounts.google.com') LIMIT 1`,
    [user.id],
  );
  return Boolean(result.rowCount);
}
