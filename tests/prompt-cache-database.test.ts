import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelMessage, ModelResponse } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "every Coach turn starts with the same instructions, then its own date and time",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn } = await import("../lib/agent/engine"),
      { readJournal } = await import("../lib/server");
    const pool = getPool(),
      user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','cache-'||$1||'@example.test',true)",
      [user],
    );
    const sent: ModelMessage[][] = [];
    const model = async (messages: ModelMessage[]): Promise<ModelResponse> => {
      sent.push(messages);
      return { role: "assistant", content: "Noted." };
    };
    const turn = async (submittedAt: string) =>
      runTurn(
        user,
        {
          id: crypto.randomUUID(),
          message: "How is my day going?",
          revision: (await readJournal(user)).revision,
          timezone: "Europe/Copenhagen",
          submittedAt,
        },
        model,
      );
    try {
      const now = Date.now();
      await turn(new Date(now - 3 * 3600000).toISOString());
      await turn(new Date(now).toISOString());
      const [first, second] = sent;
      // The long fixed prefix is identical, so the provider can reuse it.
      assert.equal(first[0].role, "system");
      assert.equal(first[0].content, second[0].content);
      assert.equal(first[0].cacheBreakpoint, true);
      assert.equal(first[1].cacheBreakpoint, undefined);
      assert.ok(!first[0].content.includes(first[1].content));
      // The date and time follow it, and differ between the turns.
      assert.equal(first[1].role, "system");
      assert.match(first[1].content, /^Today in the athlete's timezone/);
      assert.notEqual(first[1].content, second[1].content);
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
