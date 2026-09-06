import { test } from "node:test";
import assert from "node:assert/strict";
import { modelRequest, parseModelResponse } from "../lib/agent/provider";
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
