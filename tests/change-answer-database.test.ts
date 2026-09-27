import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type {
  ModelMessage,
  ModelResponse,
  ToolDefinition,
} from "../lib/agent/provider";
import { localClock } from "../lib/agent/time-context";
config({ path: ".env.local", quiet: true });

test(
  "a question left unanswered by a save gets one more round without tools; a plain save doesn't",
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
      user = crypto.randomUUID(),
      timezone = "Europe/Copenhagen",
      today = localClock(new Date(), timezone).date;
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','answer-'||$1||'@example.test',true)",
      [user],
    );
    const turn = async (message: string, sleepHours: number) => {
      const offered: number[] = [];
      const response = await runTurn(
        user,
        {
          id: crypto.randomUUID(),
          message,
          revision: (await readJournal(user)).revision,
          timezone,
        },
        async (
          _messages: ModelMessage[],
          tools: ToolDefinition[],
        ): Promise<ModelResponse> => {
          offered.push(tools.length);
          return offered.length === 1
            ? {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "log_entry",
                      arguments: {
                        kind: "record_checkin",
                        checkin: { date: today, sleepHours },
                      },
                    },
                  },
                ],
              }
            : { role: "assistant", content: "That's 1 hour more than usual." };
        },
        { directLogging: true },
      );
      return { reply: response.reply, offered };
    };
    try {
      const asked = await turn("I slept 8 hours. Is that more than usual?", 8);
      assert.equal(asked.offered.length, 2);
      assert.ok(asked.offered[0] > 0);
      assert.equal(asked.offered[1], 0, "the answer round offers no tools");
      assert.match(asked.reply, /^Saved to your journal/);
      assert.match(asked.reply, /1 hour more than usual/);

      const plain = await turn("I slept 7 hours.", 7);
      assert.equal(plain.offered.length, 1);
      assert.doesNotMatch(plain.reply, /more than usual/);
      assert.equal(
        (await readJournal(user)).state.health.checkins[0].sleepHours,
        7,
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
