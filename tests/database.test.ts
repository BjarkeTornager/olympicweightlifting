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
    delete process.env.OWNER_EMAIL;
    process.env.ALLOWED_EMAILS = emails.join(",");
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const { getAuth } = await import("../lib/auth");
    const { getPool } = await import("../lib/db");
    const { GET, PUT, PATCH } = await import("../app/api/journal/route");
    const { applyJournalPatch, diffJournal } =
      await import("../lib/journal-patch");
    const { jsonEqual } = await import("../lib/json");
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
      // A check from a copy at the current version is answered unchanged,
      // without the journal; any other version gets the whole journal.
      const latest = await (await GET(request(a))).json();
      assert.match(latest.version, /^2\.\d+$/);
      const check = (version: string) => {
        const r = request(a);
        r.headers.set("X-Journal-Version", version);
        return GET(r).then((response) => response.json());
      };
      assert.deepEqual(await check(latest.version), {
        accountId: ids[0],
        unchanged: true,
        version: latest.version,
      });
      assert.equal((await check("1.1")).revision, 2);
      // A change made outside the app, even at the same revision, is a new
      // version: neither the check nor a cached copy hides it.
      await getPool().query(
        "UPDATE journals SET state=jsonb_set(state, '{profile,bodyweight}', '83') WHERE user_id=$1",
        [ids[0]],
      );
      const edited = await check(latest.version);
      assert.equal(edited.unchanged, undefined);
      assert.equal(edited.state.profile.bodyweight, 83);
      assert.notEqual(edited.version, latest.version);
      // A save recorded with the digest used before October 2026 is still
      // recognised when it is retried.
      const { journalSchema } = await import("../lib/model");
      const { canonicalJson } = await import("../lib/json");
      const { createHash } = await import("node:crypto");
      const earlier = {
        state: edited.state,
        revision: 2,
        mutationId: crypto.randomUUID(),
      };
      const before = journalSchema.parse(earlier.state);
      await getPool().query(
        "INSERT INTO sync_mutations (user_id, id, hash, revision) VALUES ($1,$2,$3,2)",
        [
          ids[0],
          earlier.mutationId,
          createHash("sha256")
            .update(canonicalJson({ state: before, revision: 2 }))
            .digest("hex"),
        ],
      );
      const retried = await PUT(request(a, earlier));
      assert.equal(retried.status, 200, await retried.clone().text());
      assert.equal((await retried.json()).revision, 2);
      // The website sends only its changes; the server's own adjustments
      // come back to apply, so both copies stay the same.
      const changes = (body: unknown) => {
        const r = request(a, body);
        return PATCH(new Request(r, { method: "PATCH" }));
      };
      const next = structuredClone(edited.state);
      next.profile.bodyweight = 84;
      next.activeWorkout = createWorkout(
        next,
        days.find((d) => d.id === "monday"),
        "2026-09-06",
      );
      const patchBody = {
        patch: diffJournal(edited.state, next),
        revision: 2,
        mutationId: crypto.randomUUID(),
      };
      assert.deepEqual(
        patchBody.patch.map((p) => p.path.join(".")),
        ["profile.bodyweight", "activeWorkout"],
      );
      const patched = await changes(patchBody);
      assert.equal(patched.status, 200, await patched.clone().text());
      const reply = await patched.json();
      assert.equal(reply.revision, 3);
      assert.equal(reply.state, undefined);
      assert.ok(Array.isArray(reply.fix));
      const stored = await (await GET(request(a))).json();
      assert.equal(stored.version, reply.version);
      assert.ok(jsonEqual(applyJournalPatch(next, reply.fix), stored.state));
      // A retry is the same save: the whole journal at that revision.
      const again = await (await changes(patchBody)).json();
      assert.equal(again.revision, 3);
      assert.equal(again.state.profile.bodyweight, 84);
      // The same id with other changes is refused.
      assert.equal((await changes({ ...patchBody, patch: [] })).status, 422);
      // An older revision is a conflict, as for whole saves.
      assert.equal(
        (await changes({ ...patchBody, mutationId: crypto.randomUUID() }))
          .status,
        409,
      );
      // Changes made to another copy are refused, asking for the whole
      // journal, and nothing is saved.
      const mismatch = await changes({
        patch: [{ op: "items", path: ["sessions"], order: ["not-a-session"] }],
        revision: 3,
        mutationId: crypto.randomUUID(),
      });
      assert.equal(mismatch.status, 422);
      assert.equal((await mismatch.json()).resend, true);
      assert.equal((await (await GET(request(a))).json()).revision, 3);
      const concurrent = await Promise.all([
        PUT(
          request(a, {
            ...final,
            state: stored.state,
            revision: 3,
            mutationId: crypto.randomUUID(),
          }),
        ),
        PUT(
          request(a, {
            ...final,
            state: stored.state,
            revision: 3,
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
