import { test } from "node:test";
import assert from "node:assert/strict";
import { searchWeb, webSearchSchema, webSearchEnabled } from "../lib/web-search";
import { toolDefinitions } from "../lib/agent/engine";
import { systemPrompt } from "../lib/agent/knowledge";

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("a search sends only the query and returns bounded, attributable results", async () => {
  let seen: { url: string; body: Record<string, unknown>; key: string } | undefined;
  const results = await searchWeb(
    { query: "CLIF Bar Cookies and Creme ingredients" },
    {
      key: "test-exa-key",
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        seen = {
          url: String(url),
          body: JSON.parse(String(init?.body)),
          key: String((init?.headers as Record<string, string>)["x-api-key"]),
        };
        return reply({
          results: [
            {
              title: "CLIF BAR Cookies & Creme",
              url: "https://example.test/clif",
              publishedDate: "2026-01-02",
              text: "Ingredients:  organic\u0007 rolled oats,\n\n soy protein isolate.",
            },
          ],
        });
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(seen?.url, "https://api.exa.ai/search");
  assert.equal(seen?.key, "test-exa-key");
  assert.equal(seen?.body.query, "CLIF Bar Cookies and Creme ingredients");
  // Only the query leaves this server; no journal or account fields ride along.
  assert.deepEqual(Object.keys(seen!.body).sort(), [
    "contents",
    "numResults",
    "query",
    "type",
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.test/clif");
  // Control characters and newlines are flattened so retrieved text cannot
  // arrive shaped like a new instruction or speaker turn.
  assert.equal(
    results[0].snippet,
    "Ingredients: organic rolled oats, soy protein isolate.",
  );
});

test("unusable, duplicate and non-web results are discarded", async () => {
  const results = await searchWeb(
    { query: "protein bar nutrition" },
    {
      key: "k",
      fetch: (async () =>
        reply({
          results: [
            { title: "js", url: "javascript:alert(1)", text: "bad" },
            { title: "creds", url: "https://user:pw@example.test/x", text: "bad" },
            { title: "empty", url: "https://example.test/a", text: "   " },
            { title: "ok", url: "https://example.test/b", text: "Real text." },
            { title: "dupe", url: "https://example.test/b", text: "Again." },
            { title: "no url", url: null, text: "orphan" },
          ],
        })) as unknown as typeof fetch,
    },
  );
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://example.test/b"],
  );
});

test("a missing key, a bad query and an upstream failure all fail closed", async () => {
  await assert.rejects(
    () => searchWeb({ query: "anything" }, { key: "", fetch: (async () => reply({})) as unknown as typeof fetch }),
    /not connected yet/,
  );
  assert.equal(webSearchSchema.safeParse({ query: "ok" }).success, false);
  assert.equal(
    webSearchSchema.safeParse({ query: "valid query", extra: 1 }).success,
    false,
  );
  await assert.rejects(
    () =>
      searchWeb({ query: "valid query" }, {
        key: "k",
        fetch: (async () => reply({ error: "nope" }, 500)) as unknown as typeof fetch,
      }),
    /unavailable right now/,
  );
  // A result carrying nothing usable is dropped rather than thrown: Coach gets
  // an empty list and can say it found nothing, which beats an error.
  assert.deepEqual(
    await searchWeb({ query: "valid query" }, {
      key: "k",
      fetch: (async () => reply({ results: [{ unexpected: true }] })) as unknown as typeof fetch,
    }),
    [],
  );
  await assert.rejects(
    () =>
      searchWeb({ query: "valid query" }, {
        key: "k",
        fetch: (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch,
      }),
    /unreadable response/,
  );
});

test("the tool is offered only when configured, and its contract warns Coach", () => {
  const previous = process.env.EXA_API_KEY;
  try {
    delete process.env.EXA_API_KEY;
    assert.equal(webSearchEnabled(), false);
    process.env.EXA_API_KEY = "configured";
    assert.equal(webSearchEnabled(), true);
  } finally {
    if (previous == null) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previous;
  }
  const tool = toolDefinitions.find((t) => t.function.name === "search_web");
  assert.ok(tool, "search_web must be defined");
  const schema = tool.function.parameters as unknown as {
    properties: Record<string, unknown>;
    additionalProperties: boolean;
  };
  assert.deepEqual(Object.keys(schema.properties), ["query"]);
  assert.equal(schema.additionalProperties, false);
  assert.match(tool.function.description, /NEVER put the athlete's name/);
  assert.match(tool.function.description, /untrusted/);

  const prompt = systemPrompt("2026-09-07", "Europe/Copenhagen");
  assert.match(prompt, /use search_web/);
  assert.match(prompt, /must never appear in a query/);
  assert.match(prompt, /untrusted reference material/);
});
