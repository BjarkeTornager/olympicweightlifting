import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

test(
  "App Review passcode sign-in reaches only its own account, and members can delete their account",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const run = crypto.randomUUID(),
      ownerEmail = `owner-${run}@example.test`,
      memberEmail = `member-${run}@example.test`;
    process.env.OWNER_EMAIL = ownerEmail;
    delete process.env.APP_REVIEW_PASSCODE;
    const { getPool } = await import("../lib/db"),
      { getAuth } = await import("../lib/auth"),
      { pkceChallenge, authorizeReview, exchangeMobile } =
        await import("../lib/mobile"),
      { reviewEmail } = await import("../lib/review"),
      { readJournal } = await import("../lib/server"),
      { POST: reviewSignIn } = await import("../app/api/mobile/review/route"),
      { DELETE: deleteAccount } = await import("../app/api/account/route"),
      { GET: overview } = await import("../app/api/mobile/overview/route");
    const pool = getPool(),
      origin = new URL(process.env.BETTER_AUTH_URL!).origin,
      secret = (await getAuth().$context).secret,
      owner = crypto.randomUUID(),
      member = crypto.randomUUID();
    const signIn = (body: unknown, from = origin) =>
      reviewSignIn(
        new Request(`${origin}/api/mobile/review`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: from,
            // A fresh address per attempt keeps the rate limit out of the way.
            "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 250)}`,
          },
          body: JSON.stringify(body),
        }),
      );
    const bearer = (token: string, account: string, from = origin) =>
      new Headers({
        Authorization: `Bearer ${token}`,
        Origin: from,
        "X-Journal-Account": account,
      });
    const today = (headers: Headers) =>
      overview(
        new Request(`${origin}/api/mobile/overview?date=2026-09-26`, {
          headers,
        }),
      ).then((r) => r.status);
    const remove = (headers: Headers) =>
      deleteAccount(
        new Request(`${origin}/api/account`, { method: "DELETE", headers }),
      );
    const sessionFor = async (userId: string) => {
      const raw = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO auth_sessions(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [crypto.randomUUID(), raw, userId],
      );
      return `${raw}.${createHmac("sha256", secret).update(raw).digest("base64")}`;
    };
    const reviewer = async (passcode: string) => {
      const verifier = randomBytes(48).toString("base64url"),
        state = randomBytes(32).toString("base64url");
      const response = await signIn({
        passcode,
        challenge: pkceChallenge(verifier),
        state,
      });
      assert.equal(response.status, 200);
      const callback = new URL((await response.json()).callback);
      assert.equal(callback.protocol, "liftjournal:");
      assert.equal(callback.searchParams.get("state"), state);
      return exchangeMobile({
        code: callback.searchParams.get("code"),
        verifier,
      });
    };
    try {
      const challenge = pkceChallenge(randomBytes(48).toString("base64url")),
        state = randomBytes(32).toString("base64url");
      assert.equal(
        (await signIn({ passcode: "anything", challenge, state })).status,
        404,
        "the review sign-in is off without a configured passcode",
      );
      await assert.rejects(authorizeReview("anything", challenge));

      const passcode = `review-${randomBytes(18).toString("base64url")}`;
      process.env.APP_REVIEW_PASSCODE = "too-short";
      assert.equal(
        (await signIn({ passcode: "too-short", challenge, state })).status,
        404,
        "a guessable passcode does not enable it",
      );
      process.env.APP_REVIEW_PASSCODE = passcode;
      assert.equal(
        (await signIn({ passcode: `${passcode}x`, challenge, state })).status,
        401,
      );
      assert.equal(
        (await signIn({ passcode, challenge, state }, "https://evil.test"))
          .status,
        403,
      );

      const native = await reviewer(passcode);
      assert.equal(native.user.email, reviewEmail);
      const headers = bearer(native.token, native.user.id);
      assert.equal(await today(headers), 200);
      delete process.env.APP_REVIEW_PASSCODE;
      assert.equal(
        await today(headers),
        401,
        "removing the passcode ends existing review sessions",
      );
      process.env.APP_REVIEW_PASSCODE = passcode;
      assert.equal(await today(headers), 200);

      // Apple may test account deletion; the next sign-in starts afresh.
      assert.equal(
        (
          await remove(
            bearer(native.token, native.user.id, "https://evil.test"),
          )
        ).status,
        403,
      );
      assert.equal((await remove(headers)).status, 200);
      assert.equal(await today(headers), 401);
      assert.equal(
        (await pool.query("SELECT 1 FROM users WHERE id=$1", [native.user.id]))
          .rowCount,
        0,
      );
      const again = await reviewer(passcode);
      assert.notEqual(again.user.id, native.user.id);

      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic owner',$2,true),($3,'Synthetic member',$4,true)",
        [owner, ownerEmail, member, memberEmail],
      );
      await pool.query(
        "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
        [crypto.randomUUID(), memberEmail, owner],
      );
      await readJournal(member);
      const memberToken = await sessionFor(member),
        ownerToken = await sessionFor(owner);
      assert.equal(await today(bearer(memberToken, member)), 200);
      assert.equal(
        (await remove(bearer(memberToken, owner))).status,
        401,
        "the account header must match the session",
      );
      const refused = await remove(bearer(ownerToken, owner));
      assert.equal(refused.status, 409, "the owner holds every invitation");
      assert.equal((await remove(bearer(memberToken, member))).status, 200);
      for (const [table, column] of [
        ["users", "id"],
        ["journals", "user_id"],
        ["auth_sessions", "user_id"],
      ])
        assert.equal(
          (
            await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [
              member,
            ])
          ).rowCount,
          0,
          `${table} is cleared`,
        );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM journal_invitations WHERE email=$1", [
            memberEmail,
          ])
        ).rowCount,
        0,
        "coming back needs a new invitation",
      );
      assert.equal(await today(bearer(ownerToken, owner)), 200);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1) OR email=$2", [
        [owner, member],
        reviewEmail,
      ]);
      delete process.env.APP_REVIEW_PASSCODE;
      await pool.end();
    }
  },
);
