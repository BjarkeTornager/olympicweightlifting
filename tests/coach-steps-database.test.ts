import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelOptions, ModelResponse } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "while Coach writes a tool call, its step already shows, and every step ends with its round",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    delete process.env.OWNER_EMAIL;
    const { getPool } = await import("../lib/db");
    const { runTurn } = await import("../lib/agent/engine");
    const { readJournal } = await import("../lib/server");
    const pool = getPool();
    const user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Steps test',$1||'@example.test',true)",
      [user],
    );
    try {
      const events: { type: string; stepName?: string }[] = [];
      let round = 0;
      const model = async (
        _messages: unknown,
        _tools: unknown,
        _signal: AbortSignal,
        _onText?: (delta: string) => void,
        options?: ModelOptions,
      ): Promise<ModelResponse> => {
        if (round++ === 0) {
          // As the stream reader reports them: a read, and the same read
          // again in the same round.
          options?.onTool?.("find_sessions");
          options?.onTool?.("find_sessions");
          return {
            role: "assistant",
            content: "",
            tool_calls: [
              { function: { name: "find_sessions", arguments: {} } },
            ],
          };
        }
        return { role: "assistant", content: "You haven't trained yet." };
      };
      await runTurn(
        user,
        {
          id: crypto.randomUUID(),
          message: "When did I last train?",
          revision: (await readJournal(user)).revision,
          timezone: "Europe/Copenhagen",
          photoIds: [],
        },
        model as never,
        { emit: (event) => events.push(event as { type: string }) },
      );
      const steps = events
        .filter((e) => e.type === "STEP_STARTED" || e.type === "STEP_FINISHED")
        .map((e) => `${e.type === "STEP_STARTED" ? "+" : "-"}${e.stepName}`);
      assert.deepEqual(steps, [
        "+Preparing your response",
        // Shown while the call is written, then while it runs.
        "+Finding your sessions",
        "-Finding your sessions",
        "-Preparing your response",
        "+Finding your sessions",
        "-Finding your sessions",
        "+Preparing your response",
        "-Preparing your response",
      ]);
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
      await pool.end();
    }
  },
);
