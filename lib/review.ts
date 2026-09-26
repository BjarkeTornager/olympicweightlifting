import { createHash, timingSafeEqual } from "node:crypto";
import { getPool } from "./db";

// Apple's Beta App Review cannot use an invite-only Google account, so one
// fixed account can sign in to the iPhone app with a passcode given to Apple
// in App Store Connect. The .invalid domain can never be a verified Google
// address, so the account is only reachable through the passcode. Unsetting
// APP_REVIEW_PASSCODE turns the sign-in off and refuses the account's
// existing sessions on their next request.
export const reviewEmail = "app-review@lift-journal.invalid";
const minimumLength = 20;

export const reviewEnabled = () =>
  (process.env.APP_REVIEW_PASSCODE ?? "").trim().length >= minimumLength;

export const isReviewEmail = (email: string) =>
  email.trim().toLowerCase() === reviewEmail;

const digest = (value: string) => createHash("sha256").update(value).digest();

export function reviewPasscodeMatches(input: string) {
  if (!reviewEnabled()) return false;
  const expected = (process.env.APP_REVIEW_PASSCODE ?? "").trim();
  return timingSafeEqual(digest(input.trim()), digest(expected));
}

// The account is created on first use and again after Apple tests account
// deletion. It starts with an empty journal like any new member.
export async function reviewUserId() {
  const pool = getPool();
  await pool.query(
    `INSERT INTO users(id,name,email,email_verified) VALUES($1,'App Review',$2,true)
     ON CONFLICT (email) DO NOTHING`,
    [crypto.randomUUID(), reviewEmail],
  );
  const result = await pool.query("SELECT id FROM users WHERE email=$1", [
    reviewEmail,
  ]);
  return result.rows[0].id as string;
}
