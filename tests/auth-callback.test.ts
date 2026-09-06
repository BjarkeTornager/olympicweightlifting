import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

test(
  "Google callbacks redirect rejected identities to the landing page and preserve successful sign-in",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    const origin = "https://callback.example.test";
    const ownerEmail = `callback-owner-${crypto.randomUUID()}@example.test`;
    const strangerEmail = `callback-stranger-${crypto.randomUUID()}@example.test`;
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    Object.assign(process.env, {
      NODE_ENV: "production",
      OWNER_EMAIL: ownerEmail,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "callback-test-only-secret-".repeat(4),
      GOOGLE_CLIENT_ID: "synthetic-google-client",
      GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    });
    const { getAuth } = await import("../lib/auth");
    const { getPool } = await import("../lib/db");
    const { GET, POST } = await import("../app/api/auth/[...all]/route");
    const { GET: session } = await import("../app/api/session/route");
    const auth = getAuth();
    const context = await auth.$context;
    const google = context.socialProviders.find(
      (provider) => provider.id === "google",
    )!;
    assert.ok(google);
    // Replace only the external token exchange in this disposable test process.
    // Real state cookies, profile mapping, invitation checks and DB hooks run.
    let email = strangerEmail;
    let verified = true;
    const originalExchange = google.validateAuthorizationCode;
    google.validateAuthorizationCode = async () => ({
      accessToken: "synthetic-access-token",
      idToken: [
        { alg: "RS256", typ: "JWT" },
        {
          sub: email,
          email,
          email_verified: verified,
          name: "Synthetic callback test",
          iss: "https://accounts.google.com",
          aud: "synthetic-google-client",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      ]
        .map((value) =>
          Buffer.from(JSON.stringify(value)).toString("base64url"),
        )
        .concat("synthetic-signature")
        .join("."),
    });
    const cookie = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    const states: string[] = [];
    let ip = 0;
    const start = async (callbackURL = `${origin}/#food`) => {
      const response = await POST(
        new Request(`${origin}/api/auth/sign-in/social`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            "X-Forwarded-For": `192.0.2.${++ip}`,
          },
          body: JSON.stringify({
            provider: "google",
            callbackURL,
            errorCallbackURL: `${origin}/?signin=failed`,
          }),
        }),
      );
      assert.equal(response.status, 200);
      const destination = new URL((await response.json()).url);
      assert.equal(destination.origin, "https://accounts.google.com");
      const state = destination.searchParams.get("state")!;
      assert.ok(state);
      states.push(state);
      return new Request(
        `${origin}/api/auth/callback/google?code=synthetic&state=${state}`,
        {
          headers: { Cookie: cookie(response), Accept: "text/html" },
        },
      );
    };
    const rejected = async (response: Response) => {
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/?signin=failed");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("content-disposition"), null);
      assert.equal(await response.text(), "");
      assert.ok(!cookie(response).includes("session_token="));
    };
    try {
      // Reproduce the library's bare JSON response that appears as google.json
      // in some iPhone browsers, then verify our route handles it as navigation.
      const bare = await auth.handler(await start());
      assert.equal(bare.status, 403);
      assert.match(bare.headers.get("content-type")!, /application\/json/);
      await rejected(await GET(await start()));
      email = ownerEmail;
      verified = false;
      await rejected(await GET(await start()));
      assert.equal(
        (
          await getPool().query(
            "SELECT id FROM users WHERE email=ANY($1::text[])",
            [[ownerEmail, strangerEmail]],
          )
        ).rowCount,
        0,
      );

      // Valid Google identities need not have a Gmail address. Keep the normal
      // success redirect and session cookie, including deep-link destinations.
      verified = true;
      for (const callbackURL of [
        `${origin}/#food`,
        `${origin}/mobile?challenge=${"a".repeat(43)}&state=${"b".repeat(32)}`,
      ]) {
        const response = await GET(await start(callbackURL));
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("location"), callbackURL);
        assert.ok(cookie(response).includes("session_token="));
        const current = await session(
          new Request(`${origin}/api/session`, {
            headers: { Cookie: cookie(response) },
          }),
        );
        assert.equal((await current.json()).user.email, ownerEmail);
      }

      // Invalid state must still take the library's safe failure redirect.
      const invalid = await GET(
        new Request(
          `${origin}/api/auth/callback/google?code=synthetic&state=invalid`,
        ),
      );
      assert.equal(invalid.status, 302);
      const destination = new URL(invalid.headers.get("location")!, origin);
      assert.equal(destination.origin, origin);
      assert.equal(destination.searchParams.get("signin"), "failed");

      // Unexpected exceptions also return a page on a browser callback; API
      // callers must retain JSON errors rather than receiving an HTML redirect.
      const broken = t.mock.method(auth, "handler", async () => {
        throw Error("synthetic provider failure");
      });
      await rejected(
        await GET(new Request(`${origin}/api/auth/callback/google`)),
      );
      const apiFailure = await POST(
        new Request(`${origin}/api/auth/sign-in/social`, { method: "POST" }),
      );
      assert.equal(apiFailure.status, 503);
      assert.equal(apiFailure.headers.get("location"), null);
      assert.deepEqual(await apiFailure.json(), {
        error: "Sign-in is temporarily unavailable.",
      });
      broken.mock.restore();
    } finally {
      t.mock.restoreAll();
      google.validateAuthorizationCode = originalExchange;
      await getPool().query("DELETE FROM users WHERE email=ANY($1::text[])", [
        [ownerEmail, strangerEmail],
      ]);
      await getPool().query(
        "DELETE FROM auth_verifications WHERE identifier=ANY($1::text[])",
        [states],
      );
      await getPool().end();
    }
  },
);
