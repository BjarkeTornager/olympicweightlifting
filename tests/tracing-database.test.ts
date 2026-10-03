import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
config({ path: ".env.local", quiet: true });

// A whole Coach turn with tracing on: the model and Jev are mocked at
// fetch, spans are read back from an in-memory exporter. A canary in the
// message, a photo's label, the tool arguments, a made-up tool name and the
// replies must appear nowhere in the trace.
const CANARY = "CANARY-7f3a";

test(
  "a traced Coach turn holds its steps, models, tools and usage, and none of the conversation",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      TRACING: "metadata",
      MLFLOW_TRACKING_URI: "http://127.0.0.1:5999",
      MLFLOW_EXPERIMENT_ID: "7",
      TRACE_USER_SECRET: "test-only-secret",
      AGENT_PROVIDER: "openrouter",
      AGENT_MODEL: "openai/gpt-5.6-luna",
      OPENROUTER_API_KEY: "test-key",
      AGENT_ROUTING: "jev",
      TYPESAFE_API_KEY: "test-typesafe",
    });
    delete process.env.TRACE_CONTENT;
    delete process.env.TRACE_SAMPLE_RATE;
    const { getPool } = await import("../lib/db");
    const { runTurn, athleteDate } = await import("../lib/agent/engine");
    const { saveUserImage } = await import("../lib/user-images");
    const { memoryExporterForTests } = await import("../lib/tracing/provider");
    const { attributes } = await import("../lib/tracing/attributes");
    const { userCode } = await import("../lib/tracing/ids");
    const { FILTER_FALLBACK_MODEL } = await import("../lib/agent/provider");
    const memory = await memoryExporterForTests();
    const pool = getPool(),
      user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Trace test','tracing-'||$1||'@example.test',true)",
      [user],
    );
    const usage = (prompt: number, cost: number) => ({
      prompt_tokens: prompt,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: prompt },
      cost,
    });
    const requests: string[] = [];
    const fetch = mock.method(
      globalThis,
      "fetch",
      async (url: string, init: RequestInit) => {
        requests.push(url);
        const body = JSON.parse(String(init.body));
        if (url === "https://api.typesafe.ai/v1/systemone")
          return Response.json({
            model: "jev-1.13.0",
            answers: {
              work_kind: {
                type: "choice",
                choice: "log",
                confidence: 0.96,
                probabilities: { log: 0.94, explain: 0.06 },
              },
              difficulty: {
                type: "score",
                score: 0.1,
                confidence: 0.94,
                probabilities: { "0": 0.92, "1": 0.06, "2": 0.02 },
              },
              mutation_stakes: { type: "noul", noul: 0.03 },
            },
            usage: { input_tokens: 812, output_tokens: 9 },
          });
        assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
        const answered = body.messages.some(
          (m: { role: string }) => m.role === "tool",
        );
        // The first call is blocked by the content filter, its retry calls
        // a real tool and a made-up one, and the next round replies.
        const message = answered
          ? { role: "assistant", content: `You ate well. ${CANARY}` }
          : body.model !== FILTER_FALLBACK_MODEL
            ? { role: "assistant", content: `Sorry. ${CANARY}` }
            : {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "exercises",
                      arguments: JSON.stringify({ query: `${CANARY} squat` }),
                    },
                  },
                  {
                    id: "call-2",
                    type: "function",
                    function: {
                      name: `${CANARY}_tool`,
                      arguments: JSON.stringify({ note: CANARY }),
                    },
                  },
                ],
              };
        return Response.json({
          model: body.model,
          usage: answered
            ? usage(3000, 0.002)
            : body.model === FILTER_FALLBACK_MODEL
              ? usage(2000, 0.001)
              : usage(1500, 0.003),
          choices: [
            {
              finish_reason:
                !answered && body.model !== FILTER_FALLBACK_MODEL
                  ? "content_filter"
                  : answered
                    ? "stop"
                    : "tool_calls",
              message,
            },
          ],
        });
      },
    );
    t.after(async () => {
      fetch.mock.restore();
      await memory.stop();
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
      await pool.end();
    });
    const pixels = (
      await sharp({
        create: { width: 48, height: 64, channels: 3, background: "#edd7ab" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    const photo = await saveUserImage(user, {
      id: crypto.randomUUID(),
      label: `${CANARY} lunch`,
      date: athleteDate("Europe/Copenhagen"),
      image: pixels,
      purpose: "meal-photo",
    });
    const id = crypto.randomUUID();
    const response = await runTurn(
      user,
      {
        id,
        message: `What did I eat today? ${CANARY}`,
        revision: 0,
        timezone: "Europe/Copenhagen",
        photoIds: [photo.id],
        language: "en",
      },
      undefined,
      { directLogging: true },
    );
    assert.match(response.reply, /You ate well/);
    assert.ok(
      requests.includes("https://api.typesafe.ai/v1/systemone"),
      "Jev was asked",
    );

    const spans = memory.spans();
    const named = (name: string) => spans.filter((s) => s.name === name);
    const [root] = named("coach_turn");
    assert.ok(root, "one trace for the turn");
    assert.equal(root.parentSpanId, undefined);
    assert.ok(spans.every((s) => s.traceId === root.traceId));

    // No content anywhere: names, keys, values or events.
    const strings: string[] = [];
    for (const span of spans) {
      strings.push(span.name, span.status.message ?? "");
      for (const values of [
        span.attributes,
        ...span.events.map((e) => e.attributes),
      ])
        for (const [key, value] of Object.entries(values)) {
          assert.ok(Object.hasOwn(attributes, key), `${key} is allowed`);
          for (const item of Array.isArray(value) ? value : [value])
            if (typeof item === "string") {
              assert.ok(item.length <= 64, `${key} is short`);
              strings.push(item);
            } else
              assert.ok(
                typeof item === "number" || typeof item === "boolean",
                `${key} is a number or boolean`,
              );
        }
    }
    assert.ok(
      strings.every((s) => !s.includes(CANARY) && !s.includes("lunch")),
    );
    assert.equal(
      root.attributes["user.id"],
      userCode("test-only-secret", user),
    );
    assert.ok(!JSON.stringify(spans).includes(user), "never the account id");
    assert.match(String(root.attributes["session.id"]), /^[0-9a-f]{32}$/);

    // The tree: root, preparation (with the photo wait), routing, two
    // rounds and the commit.
    const childrenOf = (span: { spanId: string }) =>
      spans.filter((s) => s.parentSpanId === span.spanId).map((s) => s.name);
    assert.deepEqual(childrenOf(root).sort(), [
      "commit",
      "prepare",
      "round",
      "round",
      "route",
    ]);
    const [prepare] = named("prepare");
    assert.deepEqual(childrenOf(prepare), ["photos_sorted"]);
    assert.equal(named("photos_sorted")[0].attributes["lift.timed_out"], false);
    const rounds = named("round").sort(
      (a, b) =>
        Number(a.attributes["lift.round"]) - Number(b.attributes["lift.round"]),
    );
    assert.deepEqual(childrenOf(rounds[0]).sort(), [
      "chat",
      "chat",
      "tool.exercises",
      "tool.unknown",
    ]);
    assert.deepEqual(childrenOf(rounds[1]), ["chat"]);
    assert.equal(rounds[0].attributes["lift.tool_calls"], 2);

    // Root summary.
    assert.equal(root.attributes["gen_ai.operation.name"], "invoke_agent");
    assert.equal(root.attributes["lift.status"], "done");
    assert.equal(root.attributes["lift.photo_count"], 1);
    assert.equal(root.attributes["lift.language"], "en");
    assert.equal(root.attributes["lift.rounds"], 2);
    assert.equal(root.attributes["lift.tools_called"], 2);
    assert.equal(root.attributes["lift.cost_usd_total"], 0.006);
    assert.equal(root.attributes["gen_ai.usage.input_tokens"], undefined);

    // Jev's usage on the route.
    const route = named("route")[0].attributes;
    assert.equal(route["gen_ai.provider.name"], "typesafe");
    assert.equal(route["gen_ai.request.model"], "jev-1.13.0");
    assert.equal(route["gen_ai.usage.input_tokens"], 812);
    assert.equal(route["lift.route"], "jev");
    assert.equal(route["lift.tier"], "luna");

    // The blocked call keeps its own span and usage.
    const chats = named("chat").map((s) => s.attributes);
    const blocked = chats.find((c) => c["lift.filtered"] === true)!;
    assert.equal(blocked["gen_ai.usage.input_tokens"], 1500);
    assert.equal(blocked["lift.cost_usd"], 0.003);
    assert.equal(
      chats.filter((c) => c["lift.fallback"] === true).length,
      1,
      "the blocked call was retried once on the fallback model",
    );
    for (const chat of chats) {
      assert.equal(typeof chat["gen_ai.usage.input_tokens"], "number");
      assert.equal(typeof chat["gen_ai.usage.output_tokens"], "number");
    }

    // A made-up tool is tool.unknown, recorded as failed by category only.
    const unknown = named("tool.unknown")[0];
    assert.equal(unknown.attributes["gen_ai.tool.name"], "unknown");
    assert.equal(unknown.attributes["lift.ok"], false);
    assert.deepEqual(unknown.status, { code: "error", message: "Error" });
    const exercises = named("tool.exercises")[0].attributes;
    assert.equal(exercises["lift.ok"], true);
    assert.equal(typeof exercises["lift.result_chars"], "number");

    // The turn's metrics point to the trace and count the blocked call.
    const { rows } = await pool.query(
      "SELECT metrics FROM agent_turns WHERE id=$1",
      [id],
    );
    const metrics = rows[0].metrics;
    assert.equal(metrics.traceId, root.traceId);
    assert.deepEqual(
      metrics.rounds.map((r: { filtered?: boolean }) => r.filtered === true),
      [true, false, false],
    );
    assert.deepEqual(metrics.routeTokens, { input: 812, output: 9 });
    assert.ok(metrics.prepMs >= 0 && metrics.routeMs >= 0);
    assert.ok(metrics.routingMs >= metrics.prepMs);
  },
);
