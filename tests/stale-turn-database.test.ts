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
