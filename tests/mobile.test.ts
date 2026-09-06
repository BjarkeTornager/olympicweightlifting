import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { config } from "dotenv";
import { pkceChallenge, authorizeMobile, exchangeMobile } from "../lib/mobile";
config({ path: ".env.local", quiet: true });
test(
  "Native PKCE sign-in creates a separate revocable session, rejects replay/wrong proof and keeps account boundaries",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.OWNER_EMAIL = "";
    process.env.ALLOWED_EMAILS = "ios-a@example.test,ios-b@example.test";
    const { getPool } = await import("../lib/db"),
      { getAuth } = await import("../lib/auth");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      session = crypto.randomUUID(),
      raw = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic iOS','ios-a@example.test',true),($2,'Synthetic iOS','ios-b@example.test',true)",
      [a, b],
    );
    await pool.query(
      "INSERT INTO auth_sessions(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [session, raw, a],
    );
    const ctx = await getAuth().$context;
    const signed = `${raw}.${createHmac("sha256", ctx.secret).update(raw).digest("base64")}`;
    const headers = new Headers({
      cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`,
    });
    try {
      const verifier = randomBytes(48).toString("base64url"),
        challenge = pkceChallenge(verifier);
      await assert.rejects(authorizeMobile(new Headers(), challenge));
      const grant = await authorizeMobile(headers, challenge);
      await assert.rejects(
        exchangeMobile({
          code: grant.code,
          verifier: randomBytes(48).toString("base64url"),
        }),
      );
      const native = await exchangeMobile({ code: grant.code, verifier });
      assert.equal(native.user.id, a);
      assert.notEqual(native.token, signed);
      const authHeaders = new Headers({
        Authorization: `Bearer ${native.token}`,
        Origin: process.env.BETTER_AUTH_URL!,
        "X-Journal-Account": a,
      });
      assert.equal(
        (await getAuth().api.getSession({ headers: authHeaders }))?.user.id,
        a,
      );
      assert.equal(
        await getAuth().api.getSession({
          headers: new Headers({
            Authorization: `Bearer ${native.token.split(".")[0]}`,
          }),
        }),
        null,
        "unsigned bearer tokens are rejected",
      );
      await assert.rejects(exchangeMobile({ code: grant.code, verifier }));
      const { GET } = await import("../app/api/mobile/overview/route");
      const wrong = new Headers(authHeaders);
      wrong.set("X-Journal-Account", b);
      assert.equal(
        (
          await GET(
            new Request(
              "http://localhost/api/mobile/overview?date=2026-09-06",
              { headers: wrong },
            ),
          )
        ).status,
        401,
      );
      const own = await GET(
        new Request("http://localhost/api/mobile/overview?date=2026-09-06", {
          headers: authHeaders,
        }),
      );
      assert.equal(own.status, 200);
      assert.equal((await own.json()).state.sessions.length, 0);
      const { POST: prepare } = await import("../app/api/mobile/prepare/route");
      const { PUT: save } = await import("../app/api/journal/route");
      const post = (
        path: string,
        body: unknown,
        h = authHeaders,
        method = "POST",
      ) =>
        new Request(`http://localhost${path}`, {
          method,
          headers: new Headers([...h, ["Content-Type", "application/json"]]),
          body: JSON.stringify(body),
        });
      const input = {
        revision: 0,
        timezone: "Europe/Copenhagen",
        action: {
          kind: "record_cardio",
          cardio: {
            activity: "running",
            date: "2026-09-06",
            durationSeconds: 1700,
            distanceKm: 5.1234,
          },
        },
      };
      assert.equal(
        (await prepare(post("/api/mobile/prepare", input, wrong))).status,
        401,
      );
      const prepared = await prepare(post("/api/mobile/prepare", input));
      assert.equal(prepared.status, 200);
      const payload = {
        ...(await prepared.json()),
        mutationId: crypto.randomUUID(),
      };
      const { readJournal } = await import("../lib/server");
      assert.equal(
        (await readJournal(a)).state.cardio.sessions.length,
        0,
        "preparing never saves",
      );
      for (let retry = 0; retry < 2; retry++) {
        const saved = await save(
          post("/api/journal", payload, authHeaders, "PUT"),
        );
        assert.equal(saved.status, 200);
        assert.equal((await saved.json()).state.cardio.sessions.length, 1);
      }
      assert.equal(
        (await readJournal(a)).revision,
        1,
        "identical retry is acknowledged once",
      );
      assert.equal(
        (await readJournal(a)).state.cardio.sessions[0].distanceKm,
        5.1234,
      );
      assert.equal((await readJournal(b)).state.cardio.sessions.length, 0);
      assert.equal(
        (await prepare(post("/api/mobile/prepare", input))).status,
        409,
      );
      const expired = await authorizeMobile(headers, challenge);
      await pool.query(
        "UPDATE auth_verifications SET expires_at=now()-interval '1 second' WHERE id=$1",
        [`ios-grant:${pkceChallenge(expired.code)}`],
      );
      await assert.rejects(exchangeMobile({ code: expired.code, verifier }));
      const { POST: exchange } = await import("../app/api/mobile/token/route");
      assert.equal(
        (
          await exchange(
            post(
              "/api/mobile/token",
              {},
              new Headers({ Origin: "https://untrusted.example" }),
            ),
          )
        ).status,
        403,
      );
      await pool.query("DELETE FROM auth_sessions WHERE token=$1", [
        native.token.split(".")[0],
      ]);
      assert.equal(
        await getAuth().api.getSession({ headers: authHeaders }),
        null,
      );
      assert.ok(
        await getAuth().api.getSession({ headers }),
        "native sign-out does not revoke the browser session",
      );
      const revoked = await authorizeMobile(headers, challenge);
      await pool.query("DELETE FROM auth_sessions WHERE id=$1", [session]);
      await assert.rejects(exchangeMobile({ code: revoked.code, verifier }));
    } finally {
      await pool.query(
        "DELETE FROM auth_verifications WHERE identifier LIKE 'ios-grant:%' AND (value::jsonb->>'userId')=$1",
        [a],
      );
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
