import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelResponse } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "a Coach turn cut off mid-run can be retried once it is stale, and only then",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn, STALE_TURN_MS } = await import("../lib/agent/engine");
    const pool = getPool(),
      user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','stale-'||$1||'@example.test',true)",
      [user],
    );
    const message = "How did I sleep?";
    const input = (id: string) => ({
      id,
      message,
      revision: 0,
      timezone: "Europe/Copenhagen",
    });
    let calls = 0;
    const model = async (): Promise<ModelResponse> => {
      calls++;
      return { role: "assistant", content: "No sleep logged yet." };
    };
    // A turn the server was stopped in the middle of: still "running".
    const cutOff = async (startedMsAgo: number | null) => {
      const id = crypto.randomUUID();
      await pool.query(
        "INSERT INTO agent_turns(id,user_id,question,status,created_at,started_at) VALUES ($1,$2,$3,'running',now(),$4)",
        [
          id,
          user,
          message,
          startedMsAgo === null ? null : new Date(Date.now() - startedMsAgo),
        ],
      );
      return id;
    };
    try {
      const recent = await cutOff(30000);
      await assert.rejects(
        () => runTurn(user, input(recent), model),
        /still running/,
      );
      assert.equal(calls, 0, "a turn that may still be running is not rerun");

      const stale = await cutOff(STALE_TURN_MS + 60000);
      const [first, second] = await Promise.allSettled([
        runTurn(user, input(stale), model),
        runTurn(user, input(stale), model),
      ]);
      // Two retries at once: exactly one takes the turn over.
      assert.equal(
        [first, second].filter((r) => r.status === "fulfilled").length,
        1,
      );
      assert.equal(calls, 1);
      const { rows } = await pool.query(
        "SELECT status, started_at FROM agent_turns WHERE id=$1",
        [stale],
      );
      assert.equal(rows[0].status, "done");
      assert.ok(Date.now() - rows[0].started_at.getTime() < 60000);
      // The finished turn now answers from its saved reply.
      assert.equal(
        (await runTurn(user, input(stale), model)).reply,
        "No sleep logged yet.",
      );
      assert.equal(calls, 1);
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);

test(
  "the sweeper fails cut-off turns, and a cut-off attempt that wakes up can't save over the retry",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn, findTurn, failStaleTurns, STALE_TURN_MS } =
        await import("../lib/agent/engine");
    const pool = getPool(),
      user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','sweep-'||$1||'@example.test',true)",
      [user],
    );
    const message = "How did I sleep?";
    const turn = async (
      status: string,
      startedMsAgo: number | null,
      createdMsAgo = 0,
    ) => {
      const id = crypto.randomUUID();
      await pool.query(
        "INSERT INTO agent_turns(id,user_id,question,status,created_at,started_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          id,
          user,
          message,
          status,
          new Date(Date.now() - createdMsAgo),
          startedMsAgo === null ? null : new Date(Date.now() - startedMsAgo),
        ],
      );
      return id;
    };
    const status = async (id: string) =>
      (await pool.query("SELECT status FROM agent_turns WHERE id=$1", [id]))
        .rows[0].status;
    try {
      const recent = await turn("running", 30000),
        stale = await turn("running", STALE_TURN_MS + 60000),
        // From before started_at was kept: its creation time counts.
        legacy = await turn("running", null, STALE_TURN_MS + 60000),
        answered = await turn("done", STALE_TURN_MS + 60000);
      assert.equal(await failStaleTurns({ userId: user }), 2);
      assert.equal(await status(recent), "running");
      assert.equal(await status(stale), "failed");
      assert.equal(await status(legacy), "failed");
      assert.equal(await status(answered), "done");
      // What the apps read: a failed turn they offer to ask again.
      assert.equal((await findTurn(user, stale))?.status, "failed");
      assert.equal(await failStaleTurns({ userId: user }), 0);

      // A turn whose server stalls past the limit: swept, then retried.
      const id = crypto.randomUUID();
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let started!: () => void;
      const running = new Promise<void>((resolve) => (started = resolve));
      const stalled = runTurn(
        user,
        { id, message, revision: 0, timezone: "Europe/Copenhagen" },
        async (): Promise<ModelResponse> => {
          started();
          await released;
          return { role: "assistant", content: "From the stalled attempt." };
        },
      );
      await running;
      // This one and, by then, the 30-second-old one above.
      assert.equal(
        await failStaleTurns({
          userId: user,
          now: new Date(Date.now() + STALE_TURN_MS + 1000),
        }),
        2,
      );
      const retried = await runTurn(
        user,
        { id, message, revision: 0, timezone: "Europe/Copenhagen" },
        async (): Promise<ModelResponse> => ({
          role: "assistant",
          content: "From the retry.",
        }),
      );
      assert.equal(retried.reply, "From the retry.");
      release();
      await assert.rejects(stalled, /took too long/);
      const saved = await findTurn(user, id);
      assert.equal(saved?.status, "done");
      assert.equal(saved?.reply, "From the retry.");
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
