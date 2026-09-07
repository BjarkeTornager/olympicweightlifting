import { test } from "node:test";
import assert from "node:assert/strict";
import { modelRequest, parseModelResponse } from "../lib/agent/provider";
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
