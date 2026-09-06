import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

test(
  "PostgreSQL: invited sign-in, password checks, session expiry and sign-out",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const testUrl = process.env.TEST_DATABASE_URL!;
    assert.ok(
      new URL(testUrl).pathname.endsWith("_test"),
      "Use a disposable _test database",
    );
    process.env.DATABASE_URL = testUrl;
    Object.assign(process.env, { NODE_ENV: "test" });
    process.env.LOCAL_PASSWORD_AUTH = "true";
    const email = `auth-${crypto.randomUUID()}@example.test`;
    const uninvited = `uninvited-${crypto.randomUUID()}@example.test`;
    process.env.ALLOWED_EMAILS = email;
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL = "http://localhost:3000";

    const { getAuth } = await import("../lib/auth");
    const { getPool } = await import("../lib/db");
    const { GET: getSession } = await import("../app/api/session/route");
    const { GET: getJournal } = await import("../app/api/journal/route");
    const { GET: getAgent, DELETE: clearAgent } =
      await import("../app/api/agent/route");
    const { POST: agentAction } = await import("../app/api/agent/action/route");
    const { POST: revokeDevices } =
      await import("../app/api/devices/revoke/route");
    const auth = getAuth();
    const password = `test-only-${crypto.randomUUID()}`;
    const post = (path: string, body: unknown, cookie = "") =>
      auth.handler(
        new Request(`http://localhost:3000/api/auth/${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            cookie,
          },
          body: JSON.stringify(body),
        }),
      );
    const cookieFrom = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    const request = (cookie: string) =>
      new Request("http://localhost:3000/api/session", { headers: { cookie } });

    try {
      const rejected = await post("sign-up/email", {
        email: uninvited,
        name: "Uninvited athlete",
        password,
      });
      assert.equal(rejected.status, 403);
      assert.equal(
        (
          await getPool().query("SELECT id FROM users WHERE email=$1", [
            uninvited,
          ])
        ).rowCount,
        0,
      );

      const signup = await post("sign-up/email", {
        email,
        name: "Auth test athlete",
        password,
      });
      assert.equal(signup.status, 200);
      const userId = (await signup.json()).user.id;
      const createdCookie = cookieFrom(signup);
      assert.match(signup.headers.get("set-cookie")!, /HttpOnly/i);
      assert.match(signup.headers.get("set-cookie")!, /SameSite=Lax/i);
      const stored = await getPool().query(
        "SELECT password FROM auth_accounts WHERE user_id=$1 AND provider_id='credential'",
        [userId],
      );
      assert.equal(stored.rowCount, 1);
      assert.ok(
        stored.rows[0].password && stored.rows[0].password !== password,
        "Passwords must be hashed",
      );

      const wrong = await post("sign-in/email", {
        email,
        password: "wrong-password-with-enough-characters",
      });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.headers.get("set-cookie"), null);

      const login = await post("sign-in/email", { email, password });
      assert.equal(login.status, 200);
      const loginCookie = cookieFrom(login);
      assert.notEqual(
        loginCookie,
        createdCookie,
        "A new sign-in creates a separate session",
      );
      const visibleSession = await (
        await getSession(request(loginCookie))
      ).json();
      assert.deepEqual(visibleSession.user, {
        id: userId,
        name: "Auth test athlete",
        email,
      });
      assert.equal((await getJournal(request(loginCookie))).status, 200);
      assert.equal(
        (await getJournal(request(`${loginCookie}tampered`))).status,
        401,
      );

      const privateRequest = (
        method: string,
        account = userId,
        origin = "http://localhost:3000",
        cookie = loginCookie,
      ) =>
        new Request("http://localhost:3000/api/agent", {
          method,
          headers: {
            cookie,
            origin,
            "X-Journal-Account": account,
            "Content-Type": "application/json",
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        });
      assert.equal(
        (await getAgent(privateRequest("GET", userId, undefined, ""))).status,
        401,
      );
      for (const account of ["", "another-account"]) {
        assert.equal(
          (await getAgent(privateRequest("GET", account))).status,
          401,
        );
        assert.equal(
          (await clearAgent(privateRequest("DELETE", account))).status,
          401,
        );
        assert.equal(
          (await agentAction(privateRequest("POST", account))).status,
          401,
        );
        assert.equal(
          (await revokeDevices(privateRequest("POST", account))).status,
          401,
        );
      }
      for (const handler of [clearAgent, agentAction, revokeDevices])
        assert.equal(
          (
            await handler(
              privateRequest("POST", userId, "https://untrusted.example"),
            )
          ).status,
          403,
        );
      const ownChat = await getAgent(privateRequest("GET"));
      assert.equal(ownChat.status, 200);
      assert.equal(ownChat.headers.get("cache-control"), "no-store");
      assert.deepEqual((await ownChat.json()).turns, []);
      assert.equal((await clearAgent(privateRequest("DELETE"))).status, 200);

      const thirdLogin = await post("sign-in/email", { email, password });
      const thirdCookie = cookieFrom(thirdLogin);
      assert.equal(
        (
          await revokeDevices(
            privateRequest("POST", userId, undefined, createdCookie),
          )
        ).status,
        200,
      );
      assert.equal(
        (await getJournal(request(thirdCookie))).status,
        401,
        "Other device sessions are revoked",
      );
      assert.equal((await getJournal(request(loginCookie))).status, 401);
      assert.equal(
        (await getJournal(request(createdCookie))).status,
        200,
        "The current device stays signed in",
      );

      const logout = await post("sign-out", {}, loginCookie);
      assert.equal(logout.status, 200);
      assert.equal(
        (await getJournal(request(loginCookie))).status,
        401,
        "Signed-out cookies cannot be replayed",
      );
      assert.equal(
        (await (await getSession(request(loginCookie))).json()).user,
        null,
      );
      assert.equal(
        (await getJournal(request(createdCookie))).status,
        200,
        "Other device sessions remain valid",
      );

      await getPool().query(
        "UPDATE auth_sessions SET expires_at = now() - interval '1 minute' WHERE user_id=$1",
        [userId],
      );
      assert.equal(
        (await getJournal(request(createdCookie))).status,
        401,
        "Expired sessions cannot read the journal",
      );
      assert.equal(
        (await (await getSession(request(createdCookie))).json()).user,
        null,
      );
    } finally {
      await getPool().query("DELETE FROM users WHERE email = ANY($1::text[])", [
        [email, uninvited],
      ]);
      await getPool().end();
    }
  },
);
