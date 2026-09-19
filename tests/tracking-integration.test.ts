import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import webpush from "web-push";
config({ path: ".env.local", quiet: true });

test(
  "tracking connections: account isolation, scoped imports, retries, corrections, revocation and one reminder",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    Object.assign(process.env, {
      NODE_ENV: "test",
      OWNER_EMAIL: "",
      ALLOWED_EMAILS: "",
      LOCAL_PASSWORD_AUTH: "true",
      BETTER_AUTH_SECRET: "test-only-secret-".repeat(4),
      BETTER_AUTH_URL: "http://localhost:3000",
      DAILY_REMINDERS_WORKER: "1",
    });
    const keys = webpush.generateVAPIDKeys();
    process.env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
    process.env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
    process.env.WEB_PUSH_SUBJECT = "mailto:synthetic@example.test";
    const { getAuth } = await import("../lib/auth");
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { saveCheckin } = await import("../lib/health");
    const { localClock } = await import("../lib/reminders");
    const { offsetDate } = await import("../lib/health");
    const connection =
      await import("../app/api/integrations/apple-health/route");
    const sleep =
      await import("../app/api/integrations/apple-health/sleep/route");
    const reminders = await import("../app/api/reminders/route");
    const { deliverReminders } = await import("../lib/reminder-worker");
    const users: { id: string; cookie: string }[] = [];
    const req = (
      who: (typeof users)[number],
      method = "GET",
      body?: unknown,
      origin = "http://localhost:3000",
    ) =>
      new Request("http://localhost:3000/api/tracking", {
        method,
        headers: {
          Cookie: who.cookie,
          Origin: origin,
          "X-Journal-Account": who.id,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const importRequest = (token: string, body: unknown) =>
      new Request("http://localhost:3000/api/integrations/apple-health/sleep", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    try {
      for (let i = 0; i < 2; i++) {
        const response = await getAuth().handler(
          new Request("http://localhost:3000/api/auth/sign-up/email", {
            method: "POST",
            headers: {
              Origin: "http://localhost:3000",
              "Content-Type": "application/json",
              "X-Forwarded-For": `192.0.2.${100 + i}`,
            },
            body: JSON.stringify({
              email: `tracking-${crypto.randomUUID()}@example.test`,
              password: `test-only-${crypto.randomUUID()}`,
              name: "Synthetic tracking test",
            }),
          }),
        );
        assert.equal(response.status, 200);
        users.push({
          id: (await response.json()).user.id,
          cookie: response.headers
            .getSetCookie()
            .map((s) => s.split(";")[0])
            .join("; "),
        });
      }
      const [a, b] = users;
      assert.equal(
        (await connection.POST(req(a, "POST", {}, "https://evil.test"))).status,
        403,
      );
      assert.equal(
        (await connection.GET(req({ id: a.id, cookie: b.cookie }))).status,
        401,
      );
      assert.equal(
        (await reminders.GET(req({ id: a.id, cookie: "" }))).status,
        401,
      );
      const created = await connection.POST(req(a, "POST"));
      assert.match(created.headers.get("cache-control")!, /private, no-store/);
      const { token } = await created.json();
      const status = await (await connection.GET(req(a))).json();
      assert.equal(status.connected, true);
      assert.equal(status.token, undefined);
      assert.equal(status.tokenHash, undefined);
      const stored = await getPool().query(
        "SELECT token_hash FROM health_connections WHERE user_id=$1",
        [a.id],
      );
      assert.notEqual(stored.rows[0].token_hash, token);
      const date = offsetDate(localClock(new Date(), "UTC").date, -1);
      const previous = offsetDate(date, -1);
      const payload = {
        date,
        timezone: "UTC",
        samples: [
          {
            start: `${previous}T23:00:00Z`,
            end: `${date}T07:00:00Z`,
            value: "asleep",
          },
        ],
      };
      assert.equal(
        (await sleep.POST(importRequest("invalid", payload))).status,
        401,
      );
      const [first, retry] = await Promise.all([
        sleep.POST(importRequest(token, payload)),
        sleep.POST(importRequest(token, payload)),
      ]);
      assert.deepEqual(
        [(await first.json()).result, (await retry.json()).result].sort(),
        ["imported", "unchanged"],
      );
      let journal = await readJournal(a.id);
      assert.equal(journal.revision, 1);
      assert.equal(journal.state.health.checkins[0].sleepHours, 8);
      assert.equal((await readJournal(b.id)).state.health.checkins.length, 0);
      const changed = {
        ...payload,
        samples: [{ ...payload.samples[0], end: `${date}T08:00:00Z` }],
      };
      assert.equal(
        (await (await sleep.POST(importRequest(token, changed))).json()).result,
        "updated",
      );
      journal = await readJournal(a.id);
      saveCheckin(journal.state, { date, sleepHours: 7, energy: 4 }, date);
      await writeJournal(a.id, { ...journal, mutationId: crypto.randomUUID() });
      assert.equal(
        (await (await sleep.POST(importRequest(token, changed))).json()).result,
        "preserved",
      );
      journal = await readJournal(a.id);
      assert.equal(journal.state.health.checkins[0].sleepHours, 7);
      journal.state.health.checkins = [];
      await writeJournal(a.id, { ...journal, mutationId: crypto.randomUUID() });
      assert.equal(
        (await (await sleep.POST(importRequest(token, changed))).json()).result,
        "preserved",
      );
      assert.equal((await readJournal(a.id)).state.health.checkins.length, 0);
      assert.equal(
        (await sleep.POST(importRequest(token, { ...payload, workouts: [] })))
          .status,
        422,
      );
      assert.equal(
        (await (await connection.GET(req(a))).json()).lastResult,
        "failed",
      );
      const replacement = (await (await connection.POST(req(a, "POST"))).json())
        .token;
      assert.equal(
        (await sleep.POST(importRequest(token, payload))).status,
        401,
      );
      assert.equal((await connection.DELETE(req(a, "DELETE"))).status, 200);
      assert.equal(
        (await sleep.POST(importRequest(replacement, payload))).status,
        401,
      );

      const subscription = {
        endpoint: `https://web.push.apple.com/${crypto.randomUUID()}`,
        keys: { p256dh: keys.publicKey, auth: "a".repeat(22) },
      };
      const preferences = { time: "20:00", timezone: "UTC", topics: ["sleep"] };
      assert.equal(
        (
          await reminders.PUT(
            req(a, "PUT", {
              preferences,
              subscription: {
                ...subscription,
                endpoint: "https://localhost/private",
              },
            }),
          )
        ).status,
        400,
      );
      assert.equal(
        (await reminders.PUT(req(a, "PUT", { preferences, subscription })))
          .status,
        200,
      );
      assert.equal(
        (await reminders.PUT(req(b, "PUT", { preferences, subscription })))
          .status,
        409,
      );
      assert.equal((await (await reminders.GET(req(b))).json()).enabled, false);
      let sends = 0;
      const send: typeof webpush.sendNotification = async (
        _subscription,
        message,
      ) => {
        sends++;
        assert.ok(!String(message).includes(a.id));
        assert.ok(!String(message).includes("sleepHours"));
        return { statusCode: 201, body: "", headers: {} };
      };
      const clock = new Date(`${date}T20:00:00Z`);
      await Promise.all([
        deliverReminders(clock, send),
        deliverReminders(clock, send),
      ]);
      assert.equal(sends, 1);
      await deliverReminders(clock, send);
      assert.equal(sends, 1);
      await reminders.PUT(req(a, "PUT", { preferences, subscription }));
      await deliverReminders(clock, send);
      assert.equal(sends, 1, "Re-enabling must not send twice");
      journal = await readJournal(a.id);
      const nextDate = offsetDate(date, 1);
      saveCheckin(journal.state, { date: nextDate, sleepHours: 7 }, nextDate);
      await writeJournal(a.id, { ...journal, mutationId: crypto.randomUUID() });
      await deliverReminders(new Date(`${nextDate}T20:00:00Z`), send);
      assert.equal(sends, 1, "Recorded sleep suppresses the reminder");
      await reminders.DELETE(req(a, "DELETE"));
      await deliverReminders(
        new Date(`${offsetDate(date, 2)}T20:00:00Z`),
        send,
      );
      assert.equal(sends, 1, "Disabled reminder stays off");
      await reminders.PUT(req(a, "PUT", { preferences, subscription }));
      await deliverReminders(
        new Date(`${offsetDate(date, 2)}T20:00:00Z`),
        async () => {
          throw { statusCode: 410 };
        },
      );
      const expired = await (await reminders.GET(req(a))).json();
      assert.equal(expired.enabled, false);
      assert.equal(expired.lastStatus, "expired");
    } finally {
      for (const who of users)
        await getPool().query("DELETE FROM users WHERE id=$1", [who.id]);
      await getPool().end();
    }
  },
);
