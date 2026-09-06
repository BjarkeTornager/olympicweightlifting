import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

test(
  "Invitations: owner-only management, verified Google access, isolation and immediate revocation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    Object.assign(process.env, { NODE_ENV: "test" });
    process.env.LOCAL_PASSWORD_AUTH = "true";
    const ownerEmail = `owner-${crypto.randomUUID()}@example.test`;
    const invitedEmail = `invited-${crypto.randomUUID()}@example.test`;
    const strangerEmail = `stranger-${crypto.randomUUID()}@example.test`;
    process.env.OWNER_EMAIL = ownerEmail;
    process.env.ALLOWED_EMAILS = strangerEmail;
    process.env.BETTER_AUTH_SECRET = "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.GOOGLE_CLIENT_ID = "synthetic-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "synthetic-google-secret";
    const { getPool } = await import("../lib/db");
    const { getAuth } = await import("../lib/auth");
    const { emailAllowed, userAllowed, assertAccessConfigured } =
      await import("../lib/access");
    const invites = await import("../app/api/invitations/route");
    const { GET: session } = await import("../app/api/session/route");
    const { GET: journal } = await import("../app/api/journal/route");
    const { GET: rawAuth } = await import("../app/api/auth/[...all]/route");
    const auth = getAuth();
    const password = `test-only-${crypto.randomUUID()}`;
    let signupIp = 0;
    const signup = (email: string) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            "X-Forwarded-For": `192.0.2.${++signupIp}`,
          },
          body: JSON.stringify({
            email,
            name: "Synthetic invitation test",
            password,
          }),
        }),
      );
    const cookie = (r: Response) =>
      r.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; ");
    let ownerId = "",
      invitedId = "";
    const req = (
      cookie: string,
      account: string,
      method = "GET",
      body?: unknown,
      origin = "http://localhost:3000",
      path = "/api/invitations",
    ) =>
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: {
          cookie,
          "X-Journal-Account": account,
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      assert.equal(
        await emailAllowed(strangerEmail),
        false,
        "Legacy allowlist must not bypass explicit ownership",
      );
      assert.equal((await signup(strangerEmail)).status, 403);
      const ownerSignup = await signup(ownerEmail);
      assert.equal(ownerSignup.status, 200);
      const ownerCookie = cookie(ownerSignup);
      const owner = (await ownerSignup.json()).user;
      ownerId = owner.id;
      assert.equal(
        (await (await session(req(ownerCookie, ownerId))).json()).canInvite,
        true,
      );
      assert.equal((await invites.GET(req("", ownerId))).status, 401);
      assert.equal(
        (
          await invites.POST(
            req(
              ownerCookie,
              ownerId,
              "POST",
              { email: invitedEmail },
              "https://foreign.example",
            ),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await invites.POST(
            req(ownerCookie, "forged-account", "POST", { email: invitedEmail }),
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await invites.POST(
            req(ownerCookie, ownerId, "POST", { email: ownerEmail }),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await invites.POST(
            req(ownerCookie, ownerId, "POST", { email: "not-an-email" }),
          )
        ).status,
        400,
      );
      assert.equal((await signup(invitedEmail)).status, 403);
      const created = await invites.POST(
        req(ownerCookie, ownerId, "POST", {
          email: ` ${invitedEmail.toUpperCase()} `,
        }),
      );
      assert.equal(created.status, 200);
      const invitationId = (await created.json()).id;
      const duplicate = await invites.POST(
        req(ownerCookie, ownerId, "POST", { email: invitedEmail }),
      );
      assert.equal(
        (await duplicate.json()).id,
        invitationId,
        "Normalized email invitations are idempotent",
      );
      const inviteSignup = await signup(invitedEmail);
      assert.equal(inviteSignup.status, 200);
      const invitedCookie = cookie(inviteSignup);
      const invited = (await inviteSignup.json()).user;
      invitedId = invited.id;
      assert.equal(
        (await (await session(req(invitedCookie, invitedId))).json()).canInvite,
        false,
      );
      for (const method of ["GET", "POST", "DELETE"] as const)
        assert.equal(
          (
            await invites[method](
              req(
                invitedCookie,
                invitedId,
                method,
                method === "GET"
                  ? undefined
                  : { email: strangerEmail, id: invitationId },
              ),
            )
          ).status,
          403,
        );
      assert.equal(
        (await journal(req(invitedCookie, ownerId))).status,
        401,
        "Invitees cannot use the owner's account header",
      );
      assert.equal((await journal(req(invitedCookie, invitedId))).status, 200);
      const listing = await invites.GET(req(ownerCookie, ownerId));
      assert.equal(listing.headers.get("cache-control"), "no-store");
      assert.ok(
        (await listing.json()).invitations.some(
          (i: { email: string }) => i.email === invitedEmail,
        ),
      );

      // The production access predicate and Better Auth creation hooks require
      // verified Google identities. No external Google identities are impersonated.
      Object.assign(process.env, { NODE_ENV: "production" });
      assert.equal(await emailAllowed(strangerEmail), false);
      assert.equal(
        await userAllowed(owner),
        false,
        "A password account is insufficient in production",
      );
      const google = auth.options.socialProviders?.google;
      assert.ok(
        google && typeof google === "object" && "mapProfileToUser" in google,
      );
      if (
        google &&
        typeof google === "object" &&
        "mapProfileToUser" in google &&
        google.mapProfileToUser
      ) {
        const profile = {
          sub: "synthetic",
          aud: "synthetic-google-client",
          azp: "synthetic-google-client",
          iss: "https://accounts.google.com",
          exp: 2000000000,
          iat: 1900000000,
          email: invitedEmail,
          email_verified: true,
          name: "Synthetic",
          given_name: "Synthetic",
          family_name: "Test",
          picture: "",
          locale: "en",
        };
        await google.mapProfileToUser(profile);
        await assert.rejects(async () =>
          google.mapProfileToUser!({ ...profile, email_verified: false }),
        );
        await assert.rejects(async () =>
          google.mapProfileToUser!({ ...profile, email: strangerEmail }),
        );
      }
      const userHook = auth.options.databaseHooks!.user!.create!.before!;
      await assert.rejects(() =>
        userHook({ ...owner, emailVerified: false }, null),
      );
      await assert.rejects(() =>
        userHook({ ...owner, email: strangerEmail, emailVerified: true }, null),
      );
      await userHook({ ...owner, emailVerified: true }, null);
      for (const u of [owner, invited]) {
        await getPool().query(
          "UPDATE users SET email_verified=true WHERE id=$1",
          [u.id],
        );
        await getPool().query(
          "INSERT INTO auth_accounts (id,user_id,account_id,provider_id,issuer) VALUES ($1,$2,$3,'google','https://accounts.google.com')",
          [crypto.randomUUID(), u.id, crypto.randomUUID()],
        );
      }
      assert.equal(
        await userAllowed({ ...invited, emailVerified: true }),
        true,
      );
      assert.equal(
        await userAllowed({ ...invited, emailVerified: false }),
        false,
      );
      assert.equal((await journal(req(invitedCookie, invitedId))).status, 200);
      const staleSession = (
        await getPool().query(
          "SELECT * FROM auth_sessions WHERE user_id=$1 LIMIT 1",
          [invitedId],
        )
      ).rows[0];
      const revoked = await invites.DELETE(
        req(ownerCookie, ownerId, "DELETE", { id: invitationId }),
      );
      assert.equal(revoked.status, 200);
      assert.equal(await emailAllowed(invitedEmail), false);
      assert.equal(
        (
          await getPool().query(
            "SELECT id FROM auth_sessions WHERE user_id=$1",
            [invitedId],
          )
        ).rowCount,
        0,
      );
      assert.equal((await journal(req(invitedCookie, invitedId))).status, 401);
      assert.equal(
        (await (await session(req(invitedCookie, invitedId))).json()).user,
        null,
      );
      assert.equal(
        (
          await getPool().query(
            "SELECT user_id FROM journals WHERE user_id=$1",
            [invitedId],
          )
        ).rowCount,
        1,
        "Revocation retains the private journal",
      );
      const hookSession = {
        id: crypto.randomUUID(),
        token: crypto.randomUUID(),
        userId: invitedId,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await assert.rejects(() =>
        auth.options.databaseHooks!.session!.create!.before!(hookSession, null),
      );
      // A stale row surviving a concurrent revocation is still denied by the raw
      // auth endpoint as well as journal APIs, independently of cookie deletion.
      await getPool().query(
        "INSERT INTO auth_sessions (id, token, user_id, expires_at) VALUES ($1,$2,$3,$4)",
        [
          staleSession.id,
          staleSession.token,
          invitedId,
          staleSession.expires_at,
        ],
      );
      assert.equal(
        await userAllowed({ ...invited, emailVerified: true }),
        false,
      );
      assert.equal(
        await (
          await rawAuth(
            req(
              invitedCookie,
              invitedId,
              "GET",
              undefined,
              undefined,
              "/api/auth/get-session",
            ),
          )
        ).json(),
        null,
      );
      assert.equal(
        (
          await rawAuth(
            req(
              invitedCookie,
              invitedId,
              "GET",
              undefined,
              undefined,
              "/api/auth/list-sessions",
            ),
          )
        ).status,
        401,
      );
      assert.equal((await journal(req(invitedCookie, invitedId))).status, 401);
      assert.equal(
        (
          await invites.POST(
            req(ownerCookie, ownerId, "POST", { email: invitedEmail }),
          )
        ).status,
        200,
      );
      assert.equal(await emailAllowed(invitedEmail), true);
      await auth.options.databaseHooks!.session!.create!.before!(
        hookSession,
        null,
      );
      delete process.env.OWNER_EMAIL;
      assert.throws(assertAccessConfigured, /OWNER_EMAIL/);
    } finally {
      await getPool().query("DELETE FROM users WHERE id=ANY($1::text[])", [
        [ownerId, invitedId].filter(Boolean),
      ]);
      await getPool().query(
        "DELETE FROM request_limits WHERE key=ANY($1::text[])",
        [[`invitations:${ownerId}`]],
      );
      await getPool().end();
    }
  },
);
