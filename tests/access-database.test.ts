import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
config({ path: ".env.local", quiet: true });

test(
  "authenticated HTTP routes isolate journals, profiles, images, chat, proposals and sessions between two real accounts",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: "test",
      LOCAL_PASSWORD_AUTH: "true",
      BETTER_AUTH_URL: "http://localhost:3000",
      AGENT_PROVIDER: "",
    });
    delete process.env.OLLAMA_BASE_URL;
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    const emails = [0, 1].map(
      () => `access-${crypto.randomUUID()}@example.test`,
    );
    delete process.env.OWNER_EMAIL;
    process.env.ALLOWED_EMAILS = emails.join(",");
    const { getAuth } = await import("../lib/auth");
    const { getDb, getPool } = await import("../lib/db");
    const { agentTurns, agentProposals } = await import("../lib/db/schema");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { saveUserImage, patchUserImage, readUserImage } =
      await import("../lib/user-images");
    const { GET: journalGet, PUT: journalPut } =
      await import("../app/api/journal/route");
    const { GET: sessionGet } = await import("../app/api/session/route");
    const { GET: chatGet, DELETE: chatDelete } =
      await import("../app/api/agent/route");
    const { POST: action } = await import("../app/api/agent/action/route");
    const { POST: chatRun } = await import("../app/api/agent/run/route");
    const { GET: imageList } = await import("../app/api/images/route");
    const {
      GET: imageGet,
      PATCH: imagePatch,
      DELETE: imageDelete,
    } = await import("../app/api/images/[id]/route");
    const { POST: imageTag } =
      await import("../app/api/images/[id]/classify/route");
    const { GET: legacyImageGet } =
      await import("../app/api/food/photos/[id]/route");
    const auth = getAuth(),
      users: { id: string; cookie: string }[] = [];
    const request = (
      index: number,
      path: string,
      method = "GET",
      body?: unknown,
      account?: string,
      origin = "http://localhost:3000",
    ) =>
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: {
          cookie: users[index]?.cookie ?? "",
          "X-Journal-Account": account ?? users[index]?.id ?? "",
          origin,
          "Content-Type": "application/json",
        },
        ...(body == null ? {} : { body: JSON.stringify(body) }),
      });
    try {
      for (const email of emails) {
        const response = await auth.handler(
          request(-1, "/api/auth/sign-up/email", "POST", {
            email,
            name: "Synthetic access account",
            password: `test-only-${crypto.randomUUID()}`,
          }),
        );
        assert.equal(response.status, 200);
        users.push({
          id: (await response.json()).user.id,
          cookie: response.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; "),
        });
      }
      for (const [index, user] of users.entries()) {
        const snapshot = await readJournal(user.id);
        snapshot.state.profile.bodyweight = 71 + index;
        snapshot.state.health.checkins = [
          {
            date: "2026-09-06",
            updatedAt: new Date().toISOString(),
            sleepHours: 7 + index,
            waterMl: null,
            bodyweight: null,
            energy: null,
            soreness: null,
            notes: `PRIVATE-${index}-CHECKIN`,
          },
        ];
        await writeJournal(user.id, {
          ...snapshot,
          mutationId: crypto.randomUUID(),
        });
        await getDb()
          .insert(agentTurns)
          .values({
            id: crypto.randomUUID(),
            userId: user.id,
            question: `PRIVATE-${index}-CHAT`,
            status: "done",
            response: { reply: "Synthetic private response", proposals: [] },
          });
      }
      const pixels = await sharp({
        create: { width: 32, height: 32, channels: 3, background: "#347f62" },
      })
        .jpeg()
        .toBuffer();
      const photo = await saveUserImage(users[0].id, {
        id: crypto.randomUUID(),
        date: "2026-09-06",
        label: "PRIVATE-0-IMAGE",
        image: pixels.toString("base64"),
        autoTag: false,
      });
      await patchUserImage(users[0].id, photo.id, {
        category: "food",
        version: 0,
        tags: ["private"],
      });
      const imageContext = { params: Promise.resolve({ id: photo.id }) };
      const snapshot = await readJournal(users[0].id),
        proposalId = crypto.randomUUID(),
        turnId = crypto.randomUUID();
      await getDb()
        .insert(agentTurns)
        .values({
          id: turnId,
          userId: users[0].id,
          question: "PRIVATE-0-PROPOSAL",
          status: "done",
          response: {
            reply: "PRIVATE-0-STREAM-RESPONSE",
            proposals: [],
            visuals: [
              {
                id: crypto.randomUUID(),
                content: {
                  kind: "table",
                  title: "PRIVATE-0-VISUAL",
                  columns: ["Day", "Value"],
                  rows: [["Today", "Synthetic"]],
                },
              },
            ],
          },
        });
      const runBody = {
        threadId: users[1].id, // thread IDs cannot select another athlete
        runId: turnId,
        state: {},
        context: [],
        tools: [],
        messages: [{ id: turnId, role: "user", content: "PRIVATE-0-PROPOSAL" }],
        forwardedProps: {
          revision: snapshot.revision,
          timezone: "Europe/Copenhagen",
          photoIds: [],
        },
      };
      Object.assign(process.env, {
        AGENT_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "test-not-a-real-key",
        AGENT_MODEL: "test-no-provider-call",
      });
      try {
        const stream = await chatRun(
          request(0, "/api/agent/run", "POST", runBody),
        );
        assert.equal(stream.status, 200);
        assert.match(stream.headers.get("content-type")!, /text\/event-stream/);
        assert.match(stream.headers.get("cache-control")!, /private, no-store/);
        const events = await stream.text();
        assert.match(events, /RUN_FINISHED/);
        assert.match(events, /PRIVATE-0-VISUAL/);
        const other = await chatRun(
          request(1, "/api/agent/run", "POST", runBody),
        );
        const otherEvents = await other.text();
        assert.match(otherEvents, /RUN_ERROR/);
        assert.doesNotMatch(
          otherEvents,
          /PRIVATE-0-STREAM-RESPONSE|PRIVATE-0-VISUAL/,
        );
        assert.equal(
          (
            await chatRun(
              request(0, "/api/agent/run", "POST", runBody, users[1].id),
            )
          ).status,
          401,
        );
      } finally {
        process.env.AGENT_PROVIDER = "";
      }
      await getDb()
        .insert(agentProposals)
        .values({
          id: proposalId,
          userId: users[0].id,
          turnId,
          revision: snapshot.revision,
          before: snapshot.state,
          after: snapshot.state,
          undoId: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
          preview: {
            id: proposalId,
            title: "Private review",
            detail: "Synthetic",
            workout: null,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });

      for (const index of [0, 1]) {
        const ownJournal = await (
          await journalGet(
            request(index, `/api/journal?userId=${users[1 - index].id}`),
          )
        ).json();
        assert.equal(ownJournal.accountId, users[index].id);
        assert.match(
          JSON.stringify(ownJournal),
          new RegExp(`PRIVATE-${index}-CHECKIN`),
        );
        assert.doesNotMatch(
          JSON.stringify(ownJournal),
          new RegExp(`PRIVATE-${1 - index}`),
        );
        const ownSession = await (
          await sessionGet(request(index, "/api/session"))
        ).json();
        assert.equal(ownSession.user.id, users[index].id);
        assert.ok(Date.parse(ownSession.expiresAt) > Date.now());
        const chat = await (await chatGet(request(index, "/api/agent"))).json();
        assert.match(JSON.stringify(chat), new RegExp(`PRIVATE-${index}-CHAT`));
        assert.doesNotMatch(
          JSON.stringify(chat),
          new RegExp(`PRIVATE-${1 - index}`),
        );
        const sessions = await (
          await auth.handler(request(index, "/api/auth/list-sessions"))
        ).json();
        assert.ok(Array.isArray(sessions) && sessions.length > 0);
        for (const session of sessions)
          assert.equal(session.userId, users[index].id);
        for (const forged of ["", users[1 - index].id]) {
          assert.equal(
            (
              await journalGet(
                request(index, "/api/journal", "GET", undefined, forged),
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await journalPut(
                request(
                  index,
                  "/api/journal",
                  "PUT",
                  { ...snapshot, mutationId: crypto.randomUUID() },
                  forged,
                ),
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await chatGet(
                request(index, "/api/agent", "GET", undefined, forged),
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await imageList(
                request(index, "/api/images", "GET", undefined, forged),
              )
            ).status,
            401,
          );
        }
      }
      assert.equal(
        (await imageGet(request(0, `/api/images/${photo.id}`), imageContext))
          .status,
        200,
      );
      assert.equal(
        (
          await legacyImageGet(
            request(0, `/api/food/photos/${photo.id}`),
            imageContext,
          )
        ).status,
        200,
      );
      assert.deepEqual(
        (await (await imageList(request(1, "/api/images"))).json()).images,
        [],
      );
      for (const path of [
        `/api/images/${photo.id}`,
        `/api/images/${photo.id}?metadata=1`,
      ])
        assert.equal(
          (await imageGet(request(1, path), imageContext)).status,
          404,
        );
      assert.equal(
        (
          await legacyImageGet(
            request(1, `/api/food/photos/${photo.id}`),
            imageContext,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await imagePatch(
            request(1, `/api/images/${photo.id}`, "PATCH", {
              category: "sleep",
              tags: [],
              version: 1,
            }),
            imageContext,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await imageTag(
            request(1, `/api/images/${photo.id}/classify`, "POST", {
              version: 1,
            }),
            imageContext,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await imageDelete(
            request(1, `/api/images/${photo.id}`, "DELETE"),
            imageContext,
          )
        ).status,
        404,
      );
      for (const undo of [false, true])
        assert.equal(
          (
            await action(
              request(1, "/api/agent/action", "POST", { id: proposalId, undo }),
            )
          ).status,
          410,
        );
      assert.equal(
        (await chatDelete(request(1, "/api/agent", "DELETE"))).status,
        200,
      );
      assert.match(
        JSON.stringify(await (await chatGet(request(0, "/api/agent"))).json()),
        /PRIVATE-0-CHAT/,
      );
      assert.equal(
        (await readUserImage(users[0].id, photo.id)).label,
        "PRIVATE-0-IMAGE",
      );
      assert.deepEqual(await readJournal(users[0].id), snapshot);
      for (const [handler, path, method] of [
        [journalPut, "/api/journal", "PUT"],
        [chatDelete, "/api/agent", "DELETE"],
        [action, "/api/agent/action", "POST"],
        [chatRun, "/api/agent/run", "POST"],
      ] as const) {
        assert.equal(
          (
            await handler(
              request(
                0,
                path,
                method,
                {},
                undefined,
                "https://untrusted.example",
              ),
            )
          ).status,
          403,
        );
        assert.equal(
          (await handler(request(-1, path, method, {}))).status,
          401,
        );
      }
    } finally {
      await getPool().query("DELETE FROM users WHERE email = ANY($1::text[])", [
        emails,
      ]);
      await getPool().end();
    }
  },
);
