import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
test(
  "PostgreSQL: authentication, ownership, retries, conflicts and atomic writes",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    Object.assign(process.env, { NODE_ENV: "test" });
    process.env.LOCAL_PASSWORD_AUTH = "true";
    const suffix = crypto.randomUUID();
    const emails = [
      `qa-a-${suffix}@example.test`,
      `qa-b-${suffix}@example.test`,
    ];
    process.env.ALLOWED_EMAILS = emails.join(",");
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const { getAuth } = await import("../lib/auth");
    const { getPool } = await import("../lib/db");
    const { GET, PUT } = await import("../app/api/journal/route");
    const { createWorkout, days } = await import("../lib/domain");
    const ids: string[] = [];
    const auth = getAuth();
    const accounts = new Map<string, string>();
    const signup = async (email: string) => {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            email,
            name: "Test athlete",
            password: "test-password-with-24-chars",
          }),
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      ids.push(body.user.id);
      const cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      accounts.set(cookie, body.user.id);
      return cookie;
    };
    const request = (cookie: string, body?: unknown) =>
      new Request("http://localhost:3000/api/journal", {
        method: body ? "PUT" : "GET",
        headers: {
          cookie,
          "X-Journal-Account": accounts.get(cookie) ?? "",
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      assert.equal((await GET(request(""))).status, 401);
      const a = await signup(emails[0]),
        b = await signup(emails[1]);
      const switchedGet = request(b);
      switchedGet.headers.set("X-Journal-Account", ids[0]);
      assert.equal(
        (await GET(switchedGet)).status,
        401,
        "a stale tab cannot read the new account",
      );
      const initial = await (await GET(request(a))).json();
      assert.equal(initial.revision, 0);
      assert.equal(initial.state.sessions.length, 0);
      initial.state.activeWorkout = createWorkout(
        initial.state,
        days.find((d) => d.id === "monday"),
        "2026-09-05",
      );
      const body = {
        state: initial.state,
        revision: 0,
        mutationId: crypto.randomUUID(),
      };
      const saved = await PUT(request(a, body));
      assert.equal(saved.status, 200, await saved.clone().text());
      assert.equal((await saved.json()).revision, 1);
      const switchedPut = request(b, body);
      switchedPut.headers.set("X-Journal-Account", ids[0]);
      assert.equal(
        (await PUT(switchedPut)).status,
        401,
        "a stale tab cannot upload to the new account",
      );
      assert.equal((await (await GET(request(b))).json()).revision, 0);
      assert.equal(
        (await (await PUT(request(a, body))).json()).revision,
        1,
        "retries must not increment twice",
      );
      const reused = await PUT(
        request(a, {
          ...body,
          state: { ...body.state, updatedAt: "different" },
        }),
      );
      assert.equal(reused.status, 422);
      const conflict = await PUT(
        request(a, { ...body, mutationId: crypto.randomUUID() }),
      );
      assert.equal(conflict.status, 409);
      const other = await (await GET(request(b))).json();
      assert.equal(
        other.state.activeWorkout,
        null,
        "other athlete cannot see this draft",
      );
      const forged = await PUT(request(b, { ...body, userId: ids[0] }));
      assert.equal(forged.status, 200);
      assert.equal(
        (await (await GET(request(a))).json()).revision,
        1,
        "body owner cannot change authenticated identity",
      );
      const bad = {
        ...body,
        revision: 1,
        mutationId: crypto.randomUUID(),
        state: { ...body.state, prs: { snatch: -5 } },
      };
      assert.equal((await PUT(request(a, bad))).status, 400);
      assert.equal((await (await GET(request(a))).json()).revision, 1);
      const origin = new Request("http://localhost:3000/api/journal", {
        method: "PUT",
        headers: {
          Cookie: a,
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      assert.equal((await PUT(origin)).status, 403);
      const { finishWorkout } = await import("../lib/domain");
      const current = await (await GET(request(a))).json();
      const set = current.state.activeWorkout.exercises[0].sets[0];
      set.weight = "47.5";
      set.logged = true;
      set.result = "success";
      const final = {
        state: finishWorkout(current.state),
        revision: current.revision,
        mutationId: crypto.randomUUID(),
      };
      assert.equal((await PUT(request(a, final))).status, 200);
      const projection = await getPool().query(
        "SELECT weight FROM workout_sets WHERE user_id=$1",
        [ids[0]],
      );
      assert.equal(projection.rowCount, 1);
      assert.equal(Number(projection.rows[0].weight), 47.5);
      const concurrent = await Promise.all([
        PUT(
          request(a, {
            ...final,
            revision: 2,
            mutationId: crypto.randomUUID(),
          }),
        ),
        PUT(
          request(a, {
            ...final,
            revision: 2,
            mutationId: crypto.randomUUID(),
          }),
        ),
      ]);
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
      process.env.ALLOWED_EMAILS = emails[1];
      assert.equal(
        (await GET(request(a))).status,
        401,
        "removing a pilot invitation revokes journal access",
      );
    } finally {
      for (const id of ids)
        await getPool().query("DELETE FROM users WHERE id=$1", [id]);
      await getPool().end();
    }
  },
);
