import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modelRequest,
  parseModelResponse,
  providerResponseError,
} from "../lib/agent/provider";

test("monthly key exhaustion is a non-retryable budget error without leaking provider metadata", async () => {
  const error = await providerResponseError(
    Response.json(
      {
        error: {
          code: 403,
          message:
            "Key limit exceeded (monthly limit). Manage secret-account-key here.",
        },
      },
      { status: 403 },
    ),
  );
  assert.equal(error.status, 402);
  assert.match(error.message, /monthly AI allowance/);
  assert.doesNotMatch(error.message, /secret-account-key/);
  const forbidden = await providerResponseError(
    Response.json(
      { error: { message: "Restricted credentials secret-account-key" } },
      { status: 403 },
    ),
  );
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.message, /permissions/);
  assert.doesNotMatch(forbidden.message, /secret-account-key/);
  const oversized = await providerResponseError(
    new Response("x".repeat(9000), { status: 403 }),
  );
  assert.equal(oversized.status, 403);
  assert.equal(
    (await providerResponseError(new Response(null, { status: 503 }))).status,
    503,
  );
});
test("video output budget is isolated from chat and truncated replies are flagged", () => {
  for (const kind of ["openrouter", "ollama"] as const) {
    const config = {
      kind,
      label: "test",
      base: "https://example.test",
      model: "openai/gpt-5.6-luna",
      key: "test",
    };
    const budget = (purpose?: "video_review") => {
      const body = modelRequest([], [], config, { purpose }).body;
      return (
        body.options?.num_predict ??
        ("max_completion_tokens" in body
          ? body.max_completion_tokens
          : undefined)
      );
    };
    assert.equal(budget(), 1800);
    assert.equal(budget("video_review"), 4800);
    const message = { role: "assistant", content: '{"evidence":' };
    assert.equal(
      parseModelResponse(
        kind === "openrouter"
          ? { choices: [{ message, finish_reason: "length" }] }
          : { message, done_reason: "length" },
        kind,
      ).truncated,
      true,
    );
    assert.equal(
      parseModelResponse(
        kind === "openrouter"
          ? { choices: [{ message, finish_reason: "stop" }] }
          : { message, done_reason: "stop" },
        kind,
      ).truncated,
      undefined,
    );
  }
});
test("provider accepts a bounded large lookup batch for engine recovery, but rejects unbounded tool envelopes", () => {
  const response = (count: number) => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: Array.from({ length: count }, (_, i) => ({
            id: `lookup-${i}`,
            function: { name: "exercises", arguments: '{"query":"squat"}' },
          })),
        },
      },
    ],
  });
  assert.equal(
    parseModelResponse(response(12), "openrouter").tool_calls?.length,
    12,
  );
  assert.throws(() => parseModelResponse(response(33), "openrouter"));
});
test("Luna uses Azure's supported completion limit without excluding private tool routes", () => {
  const config = {
    kind: "openrouter" as const,
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5.6-luna",
    key: "server-only",
  };
  for (const visual of [false, true]) {
    const tools = visual
      ? [
          {
            type: "function" as const,
            function: {
              name: "show_visual",
              description: "Show a visual",
              parameters: {},
            },
          },
        ]
      : [];
    const body = modelRequest([], tools, config).body;
    assert.equal("max_tokens" in body, false);
    assert.equal(
      "max_completion_tokens" in body && body.max_completion_tokens,
      visual ? 3200 : 1800,
    );
    assert.deepEqual("provider" in body && body.provider, {
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
      order: ["azure/eu"],
    });
    if (visual) {
      const functions = JSON.parse(JSON.stringify(body)).tools;
      assert.equal(functions[0].function.strict, false);
      assert.deepEqual(
        functions[0].function.parameters,
        tools[0].function.parameters,
      );
      assert.equal(
        "strict" in tools[0].function,
        false,
        "shared tool definitions stay unchanged",
      );
    }
    const previous = modelRequest([], tools, {
      ...config,
      model: "google/gemini-3.8-flash",
    }).body;
    assert.equal("max_completion_tokens" in previous, false);
    assert.equal(
      "max_tokens" in previous && previous.max_tokens,
      visual ? 3200 : 1800,
    );
  }
  const routedTools = [
    {
      type: "function" as const,
      function: {
        name: "log_entry",
        description: "Save an entry",
        parameters: {},
      },
    },
  ];
  const terra = JSON.parse(
    JSON.stringify(
      modelRequest([], routedTools, config, {
        model: "openai/gpt-5.6-terra",
      }).body,
    ),
  );
  assert.equal(terra.model, "openai/gpt-5.6-terra");
  assert.equal(terra.max_completion_tokens, 1800);
  assert.deepEqual(terra.provider, {
    require_parameters: true,
    data_collection: "deny",
    zdr: true,
  });
  assert.equal(terra.tools[0].function.strict, false);
});
test("private photo content is adapted to OpenRouter and Ollama without public URLs", () => {
  const messages = [
    { role: "user" as const, content: "What did I eat?", images: ["YWJj"] },
  ];
  const base = {
    label: "test",
    base: "https://example.test/api",
    model: "vision-test",
    key: "secret",
  };
  const router = JSON.parse(
    JSON.stringify(
      modelRequest(messages, [], { ...base, kind: "openrouter" }).body,
    ),
  );
  assert.deepEqual(router.messages[0].content, [
    { type: "text", text: "What did I eat?" },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,YWJj" } },
  ]);
  assert.equal(router.provider.zdr, true);
  const ollama = JSON.parse(
    JSON.stringify(
      modelRequest(messages, [], { ...base, kind: "ollama" }).body,
    ),
  );
  assert.deepEqual(ollama.messages[0].images, ["YWJj"]);
});
test("OpenRouter adapter preserves tool IDs, JSON arguments and required privacy filters", () => {
  const response = parseModelResponse(
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-a",
                type: "function",
                function: {
                  name: "find_sessions",
                  arguments: '{"from":"2026-09-01"}',
                },
              },
            ],
          },
        },
      ],
    },
    "openrouter",
  );
  const req = modelRequest(
    [
      response,
      {
        role: "tool",
        tool_call_id: "call-a",
        tool_name: "find_sessions",
        content: '{"total":0}',
      },
    ],
    [],
    {
      kind: "openrouter",
      label: "OpenRouter",
      base: "https://openrouter.ai/api/v1",
      model: "test-model",
      key: "server-only",
    },
  );
  assert.equal(req.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(JSON.stringify(req.body).includes("server-only"), false);
  const body = JSON.parse(JSON.stringify(req.body));
  assert.equal(
    body.messages[0].tool_calls[0].function.arguments,
    '{"from":"2026-09-01"}',
  );
  assert.equal(body.messages[1].tool_call_id, "call-a");
  assert.deepEqual(body.provider, {
    require_parameters: true,
    data_collection: "deny",
    zdr: true,
  });
  assert.throws(() =>
    parseModelResponse(
      {
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                { id: "a", function: { name: "bad", arguments: "not json" } },
              ],
            },
          },
        ],
      },
      "openrouter",
    ),
  );
});

test("a reply blocked by the host's content filter is retried once on the fallback model", async (t) => {
  const { mock } = await import("node:test");
  const { callModel, FILTER_FALLBACK_MODEL } =
    await import("../lib/agent/provider");
  process.env.AGENT_PROVIDER = "openrouter";
  process.env.AGENT_MODEL = "openai/gpt-5.6-luna";
  process.env.OPENROUTER_API_KEY = "test-key";
  const models: string[] = [];
  const fetch = mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      models.push(body.model);
      // Privacy routing is unchanged on the retry.
      assert.equal(body.provider.zdr, true);
      assert.equal(body.provider.data_collection, "deny");
      const filtered = body.model !== FILTER_FALLBACK_MODEL;
      return Response.json({
        choices: [
          {
            finish_reason: filtered ? "content_filter" : "stop",
            message: {
              role: "assistant",
              content: filtered
                ? "I'm sorry, but I cannot assist with that request."
                : "Three light doubles.",
            },
          },
        ],
      });
    },
  );
  t.after(() => fetch.mock.restore());
  const reply = await callModel(
    [{ role: "user", content: "How many sets when I'm tired?" }],
    [],
    AbortSignal.timeout(5000),
  );
  assert.equal(reply.content, "Three light doubles.");
  assert.deepEqual(models, ["openai/gpt-5.6-luna", FILTER_FALLBACK_MODEL]);
  // The fallback itself is not retried again.
  models.length = 0;
  const direct = await callModel(
    [{ role: "user", content: "Hi" }],
    [],
    AbortSignal.timeout(5000),
    undefined,
    { model: FILTER_FALLBACK_MODEL },
  );
  assert.equal(direct.content, "Three light doubles.");
  assert.deepEqual(models, [FILTER_FALLBACK_MODEL]);
});
