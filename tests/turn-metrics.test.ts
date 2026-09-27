import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { readModelStream } from "../lib/agent/model-stream";
import {
  parseModelResponse,
  type ModelMessage,
  type ModelResponse,
} from "../lib/agent/provider";
import { turnTotals } from "../lib/agent/turn-metrics";
config({ path: ".env.local", quiet: true });

function chunks(text: string, length = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += length)
          controller.enqueue(bytes.slice(i, i + length));
        controller.close();
      },
    }),
  );
}
const usage = {
  prompt_tokens: 33120,
  completion_tokens: 84,
  prompt_tokens_details: { cached_tokens: 32768, cache_write_tokens: 0 },
  cost: 0.00213,
};

test("the model and usage of a reply are read, streamed or not", async () => {
  const plain = parseModelResponse(
    {
      model: "openai/gpt-5.6-luna",
      usage,
      choices: [{ message: { role: "assistant", content: "Logged." } }],
    },
    "openrouter",
  );
  assert.equal(plain.content, "Logged.");
  assert.deepEqual(plain.served, {
    model: "openai/gpt-5.6-luna",
    inputTokens: 33120,
    cachedTokens: 32768,
    cacheWriteTokens: 0,
    outputTokens: 84,
    costUsd: 0.00213,
  });

  // OpenRouter sends usage in a last frame with no choices.
  const frames = [
    { model: "openai/gpt-5.6-luna", choices: [{ delta: { content: "Log" } }] },
    { choices: [{ delta: { content: "ged." }, finish_reason: "stop" }] },
    { model: "openai/gpt-5.6-luna", choices: [], usage },
  ];
  const stream = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  const streamed = parseModelResponse(
    await readModelStream(
      chunks(`${stream}data: [DONE]\n\n`),
      "openrouter",
      () => {},
      AbortSignal.timeout(1000),
    ),
    "openrouter",
  );
  assert.equal(streamed.content, "Logged.");
  assert.deepEqual(streamed.served, plain.served);
});

test("odd usage from the provider never fails a reply", () => {
  const reply = parseModelResponse(
    {
      model: 42,
      usage: { prompt_tokens: "lots" },
      choices: [{ message: { role: "assistant", content: "Still here." } }],
    },
    "openrouter",
  );
  assert.equal(reply.content, "Still here.");
  assert.equal(reply.served, undefined);
});

test("turn totals add up every round", () => {
  assert.deepEqual(
    turnTotals({
      rounds: [
        {
          ms: 3000,
          inputTokens: 33000,
          cachedTokens: 0,
          cacheWriteTokens: 33000,
          outputTokens: 40,
          costUsd: 0.01,
        },
        {
          ms: 2000,
          inputTokens: 34000,
          cachedTokens: 33000,
          outputTokens: 90,
          costUsd: 0.002,
        },
        { ms: 100 },
      ],
    }),
    {
      rounds: 3,
      inputTokens: 67000,
      cachedTokens: 33000,
      cacheWriteTokens: 33000,
      outputTokens: 130,
      costUsd: 0.012,
    },
  );
});

test(
  "a Coach turn saves its timings and usage, and none of the conversation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn } = await import("../lib/agent/engine");
    const pool = getPool(),
      user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','metrics-'||$1||'@example.test',true)",
      [user],
    );
    const served = (cached: number) => ({
      model: "openai/gpt-5.6-luna",
      inputTokens: 33000,
      cachedTokens: cached,
      cacheWriteTokens: 33000 - cached,
      outputTokens: 50,
      costUsd: 0.004,
    });
    const model = async (
      messages: ModelMessage[],
      _tools: unknown,
      _signal: AbortSignal,
      onText?: (delta: string) => void,
    ): Promise<ModelResponse> => {
      // Usage belongs to the metrics, never to the next request.
      assert.ok(messages.every((m) => !("served" in m)));
      if (!messages.some((m) => m.role === "tool"))
        return {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "current_workout", arguments: {} } },
          ],
          served: served(0),
        };
      onText?.("No workout in progress.");
      return {
        role: "assistant",
        content: "No workout in progress.",
        served: served(32768),
      };
    };
    try {
      const id = crypto.randomUUID();
      await runTurn(
        user,
        {
          id,
          message: "Secret question about my workout",
          revision: 0,
          timezone: "Europe/Copenhagen",
        },
        model,
        { emit: () => {} },
      );
      const { rows } = await pool.query(
        "SELECT metrics FROM agent_turns WHERE id=$1",
        [id],
      );
      const metrics = rows[0].metrics;
      assert.equal(metrics.rounds.length, 2);
      assert.equal(metrics.rounds[1].cachedTokens, 32768);
      assert.ok(metrics.rounds.every((r: { ms: number }) => r.ms >= 0));
      assert.ok(
        metrics.firstTextMs >= 0 && metrics.totalMs >= metrics.firstTextMs,
      );
      assert.equal(turnTotals(metrics).costUsd, 0.008);
      assert.doesNotMatch(
        JSON.stringify(metrics),
        /Secret|workout in progress/,
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
