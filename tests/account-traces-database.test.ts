import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// Deleting an account deletes its diagnostic traces in MLflow once the
// reply is sent, with capture on or off. MLflow is mocked at fetch; the
// route runs in a request scope, as in Next.js, so its after() work runs.

// Next.js's own request scope, reduced to what after() needs: the work runs
// once the response is returned, and this waits for it.
async function inRequest(handler: () => Promise<Response>) {
  const { workAsyncStorage } =
    await import("next/dist/server/app-render/work-async-storage.external.js");
  const { workUnitAsyncStorage } =
    await import("next/dist/server/app-render/work-unit-async-storage.external.js");
  const { AfterContext } =
    await import("next/dist/server/after/after-context.js");
  const closing: (() => void)[] = [];
  const pending: Promise<unknown>[] = [];
  const afterContext = new AfterContext({
    waitUntil: (work: Promise<unknown>) => void pending.push(work),
    onClose: (close: () => void) => void closing.push(close),
    onTaskError: undefined,
  });
  const response = await workAsyncStorage.run({ afterContext } as never, () =>
    workUnitAsyncStorage.run(
      { type: "request", phase: "action" } as never,
      handler,
    ),
  );
  for (const close of closing) close();
  await Promise.all(pending);
  return response;
}

test(
  "deleting an account deletes its traces after the reply, and an MLflow failure never fails the deletion",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    // Capture is off: deletion needs only MLflow and the secret.
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      MLFLOW_TRACKING_URI: "http://127.0.0.1:5999",
      MLFLOW_EXPERIMENT_ID: "7",
      TRACE_USER_SECRET: "test-only-secret",
    });
    delete process.env.TRACING;
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
    // As the Next.js server does first (node-environment-baseline), so its
    // request storage is real.
    const { AsyncLocalStorage } = await import("node:async_hooks");
    (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
      AsyncLocalStorage;
    const { createHmac, randomBytes } = await import("node:crypto");
    const { getPool } = await import("../lib/db");
    const { getAuth } = await import("../lib/auth");
    const { userCode } = await import("../lib/tracing/ids");
    const { DELETE: deleteAccount } = await import("../app/api/account/route");
    const pool = getPool(),
      origin = new URL(process.env.BETTER_AUTH_URL).origin,
      accounts: string[] = [];
    const secret = (await getAuth().$context).secret;
    const member = async () => {
      const id = crypto.randomUUID(),
        email = `traces-${id}@example.test`;
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic member',$2,true)",
        [id, email],
      );
      // With an owner configured (as in CI) only invited emails sign in.
      await pool.query(
        "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
        [crypto.randomUUID(), email, id],
      );
      const raw = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO auth_sessions(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [crypto.randomUUID(), raw, id],
      );
      const token = `${raw}.${createHmac("sha256", secret).update(raw).digest("base64")}`;
      return { id, token };
    };
    const remove = (account: { id: string; token: string }) =>
      inRequest(() =>
        deleteAccount(
          new Request(`${origin}/api/account`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${account.token}`,
              Origin: origin,
              "X-Journal-Account": account.id,
            },
          }),
        ),
      );
    const exists = async (id: string) =>
      (await pool.query("SELECT 1 FROM users WHERE id=$1", [id])).rowCount;

    let mlflow: "up" | "down" | "forbidden" = "up";
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = mock.method(
      globalThis,
      "fetch",
      async (url: string, init: RequestInit) => {
        if (mlflow === "down") throw new TypeError("fetch failed");
        // The app's MLflow user without MANAGE on the experiment.
        if (mlflow === "forbidden")
          return new Response("Permission denied", { status: 403 });
        const body = JSON.parse(String(init.body));
        requests.push({ url, body });
        if (url.endsWith("/api/3.0/mlflow/traces/search"))
          return Response.json({
            traces: [{ trace_id: "tr-1" }, { trace_id: "tr-2" }],
          });
        assert.equal(
          url,
          "http://127.0.0.1:5999/api/2.0/mlflow/traces/delete-traces",
        );
        return Response.json({ traces_deleted: body.request_ids.length });
      },
    );
    const info = mock.method(console, "info", () => {});
    const warn = mock.method(console, "warn", () => {});
    // The second pass, 15 minutes later, is held here and run by hand.
    const realTimeout = globalThis.setTimeout;
    const held: (() => void)[] = [];
    const timeout = mock.method(globalThis, "setTimeout", ((
      run: () => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms !== 15 * 60000) return realTimeout(run, ms, ...args);
      held.push(run);
      return { unref: () => {} };
    }) as typeof setTimeout);
    t.after(async () => {
      timeout.mock.restore();
      fetch.mock.restore();
      info.mock.restore();
      warn.mock.restore();
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [accounts]);
      await pool.query(
        "DELETE FROM journal_invitations WHERE email LIKE 'traces-%@example.test' AND created_by = ANY($1)",
        [accounts],
      );
      await pool.end();
    });
    const lines = (spy: typeof info) =>
      spy.mock.calls
        .map((c) => String(c.arguments[0]))
        .filter((line) => line.includes("account_traces"))
        .map((line) => JSON.parse(line));

    // The account's traces are found by its code and deleted.
    const first = await member();
    const response = await remove(first);
    assert.equal(response.status, 200);
    assert.equal(await exists(first.id), 0);
    assert.deepEqual(
      requests.map((r) => r.url),
      [
        "http://127.0.0.1:5999/api/3.0/mlflow/traces/search",
        "http://127.0.0.1:5999/api/2.0/mlflow/traces/delete-traces",
      ],
    );
    assert.equal(
      requests[0].body.filter,
      `metadata.\`mlflow.trace.user\` = '${userCode("test-only-secret", first.id)}'`,
    );
    assert.deepEqual(requests[1].body, {
      experiment_id: "7",
      request_ids: ["tr-1", "tr-2"],
    });
    assert.deepEqual(lines(info), [
      { event: "account_traces_deleted", deleted: 2 },
    ]);
    // Then again later, for work that was still running.
    assert.equal(held.length, 1);
    held[0]();
    for (let i = 0; i < 50 && lines(info).length < 2; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      requests
        .slice(2)
        .map((r) => [r.url, r.body.filter ?? r.body.request_ids]),
      [
        [requests[0].url, requests[0].body.filter],
        [requests[1].url, ["tr-1", "tr-2"]],
      ],
    );
    assert.deepEqual(lines(info)[1], {
      event: "account_traces_deleted",
      deleted: 2,
      later: true,
    });
    assert.ok(
      !JSON.stringify(requests).includes(first.id),
      "MLflow never sees the account id",
    );

    // MLflow unreachable: the account is still deleted and the reply says
    // so; the failure is logged by category for the expiry to clean up.
    // A refusal is logged with MLflow's status.
    for (const state of ["down", "forbidden"] as const) {
      mlflow = state;
      const account = await member();
      assert.equal((await remove(account)).status, 200);
      assert.equal(await exists(account.id), 0);
    }
    assert.deepEqual(lines(warn), [
      { event: "account_traces_delete_failed", category: "network" },
      {
        event: "account_traces_delete_failed",
        category: "Error",
        status: 403,
      },
    ]);

    // Without MLflow configured nothing is sent or scheduled.
    mlflow = "up";
    requests.length = 0;
    delete process.env.MLFLOW_TRACKING_URI;
    const third = await member();
    assert.equal((await remove(third)).status, 200);
    assert.equal(await exists(third.id), 0);
    assert.equal(requests.length, 0);
    assert.equal(held.length, 3, "one second pass per account with MLflow");
  },
);
