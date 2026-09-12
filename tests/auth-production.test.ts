import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

test(
  "Production refuses development passwords and readiness without Google OAuth",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const testUrl = process.env.TEST_DATABASE_URL!;
    assert.ok(
      new URL(testUrl).pathname.endsWith("_test"),
      "Use a disposable _test database",
    );
    process.env.DATABASE_URL = testUrl;
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.LOCAL_PASSWORD_AUTH = "true";
    process.env.OWNER_EMAIL = "production-test@example.test";
    process.env.ALLOWED_EMAILS = "production-test@example.test";
    process.env.BETTER_AUTH_SECRET = "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL = "https://lift.example.test";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const { getAuth, localPasswordEnabled } = await import("../lib/auth");
    const { getPool } = await import("../lib/db");
    const { GET: readiness } = await import("../app/api/ready/route");
    const auth = getAuth();
    try {
      assert.equal(localPasswordEnabled(), false);
      for (const [path, code] of [
        ["sign-in/email", "EMAIL_PASSWORD_DISABLED"],
        ["sign-up/email", "EMAIL_PASSWORD_SIGN_UP_DISABLED"],
      ]) {
        const response = await auth.handler(
          new Request(`https://lift.example.test/api/auth/${path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://lift.example.test",
            },
            body: JSON.stringify({
              email: "production-test@example.test",
              name: "Production test",
              password: "test-password-with-enough-characters",
            }),
          }),
        );
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, code);
        assert.equal(response.headers.get("set-cookie"), null);
      }
      assert.equal((await readiness()).status, 503);
    } finally {
      await getPool().end();
    }
  },
);
