import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type {
  ModelMessage,
  ModelResponse,
  ToolDefinition,
} from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "skills load from the message, from load_skills, or when their tool is called",
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
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','skills-'||$1||'@example.test',true)",
      [user],
    );
    type Round = {
      messages: ModelMessage[];
      tools: string[];
      fields: string[];
    };
    // Runs one turn with scripted tool calls; records what each round saw.
    const turn = async (
      message: string,
      calls: { name: string; arguments: Record<string, unknown> }[],
    ) => {
      const rounds: Round[] = [];
      await runTurn(
        user,
        {
          id: crypto.randomUUID(),
          message,
          revision: (await readJournal(user)).revision,
          timezone: "Europe/Copenhagen",
        },
        async (
          messages: ModelMessage[],
          tools: ToolDefinition[],
        ): Promise<ModelResponse> => {
          const prepare = tools.find(
            (t) => t.function.name === "prepare_change",
          );
          rounds.push({
            messages,
            tools: tools.map((t) => t.function.name),
            fields: Object.keys(
              (
                prepare?.function.parameters as {
                  properties?: Record<string, unknown>;
                }
              )?.properties ?? {},
            ),
          });
          const next = calls[rounds.length - 1];
          return next
            ? {
                role: "assistant",
                content: "",
                tool_calls: [{ function: next }],
              }
            : { role: "assistant", content: "Done." };
        },
        { directLogging: true },
      );
      return rounds;
    };
    try {
      // A clear signal loads the skill before the first model call.
      const [route] = await turn("Plan a 5 km run route near me.", []);
      assert.ok(route.tools.includes("plan_route"));
      assert.ok(
        route.messages.some(
          (m) =>
            m.role === "system" &&
            m.content.startsWith("Skills loaded for this message: routes"),
        ),
      );

      // Without a signal the model loads it, and gets it from the next step.
      const goals = await turn("What should I eat this week?", [
        { name: "load_skills", arguments: { skills: ["goals"] } },
      ]);
      assert.ok(!goals[0].fields.includes("bodyGoals"));
      assert.ok(goals[1].fields.includes("bodyGoals"));
      const loaded = goals[1].messages.findLast((m) => m.role === "tool");
      assert.match(loaded!.content, /When the athlete wants to set goals/);

      // Calling a skill's tool directly loads its skill for the next step.
      const direct = await turn("How is my training going lately?", [
        { name: "weekly_review", arguments: { endDate: "2026-09-20" } },
      ]);
      assert.ok(!direct[0].tools.includes("weekly_review"));
      assert.ok(direct[1].tools.includes("weekly_review"));
      const { rows } = await pool.query(
        "SELECT metrics FROM agent_turns WHERE user_id=$1 ORDER BY created_at",
        [user],
      );
      assert.deepEqual(rows.at(-1).metrics.skills, ["review"]);
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
