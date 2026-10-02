import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { localClock } from "../lib/agent/time-context";
import {
  voiceContext,
  voiceInstruction,
  voiceTools,
} from "../lib/voice-checkin";
import {
  elevenLabsAgent,
  elevenLabsAgentId,
  ElevenLabsError,
  elevenLabsSignedUrl,
  elevenLabsStart,
  elevenLabsTools,
  resetElevenLabsAgent,
} from "../lib/voice-elevenlabs";

process.env.ELEVENLABS_API_KEY = "test-key";

beforeEach(() => {
  delete process.env.ELEVENLABS_AGENT_ID;
  resetElevenLabsAgent();
});

type Node = {
  type: string;
  description?: string;
  enum?: string[];
  items?: Node;
  properties?: Record<string, Node>;
  required?: string[];
};

// Every value ElevenLabs asks the model for needs a type it knows and a
// description, or it rejects the agent.
function assertValid(node: Node, path: string) {
  assert.ok(node.description?.trim(), `${path} has a description`);
  if (node.type === "object") {
    for (const key of node.required ?? [])
      assert.ok(
        node.properties?.[key],
        `${path}.${key} is required and defined`,
      );
    for (const [key, child] of Object.entries(node.properties ?? {}))
      assertValid(child, `${path}.${key}`);
  } else if (node.type === "array") {
    assert.ok(node.items, `${path} has items`);
    assertValid(node.items!, `${path}[]`);
  } else {
    assert.ok(
      ["string", "number", "integer", "boolean"].includes(node.type),
      `${path} is ${node.type}`,
    );
  }
}

test("the ElevenLabs coach gets every voice tool but the photo viewers", () => {
  const tools = elevenLabsTools();
  const gemini = voiceTools()[0].functionDeclarations.map((t) => t.name);
  assert.deepEqual(
    tools.map((t) => t.name),
    gemini.filter((name) => name !== "list_photos" && name !== "view_photo"),
  );
  for (const tool of tools) {
    assert.equal(tool.type, "client");
    assert.equal(tool.expects_response, true);
    assert.ok(tool.response_timeout_secs >= 20);
    if ("parameters" in tool) assertValid(tool.parameters as Node, tool.name);
  }
  const meal = tools.find((t) => t.name === "log_meal") as unknown as {
    parameters: Node;
  };
  const item = meal.parameters.properties!.items.items!;
  assert.equal(item.properties!.calories.type, "number");
  assert.deepEqual(meal.parameters.properties!.meal_type.enum, [
    "breakfast",
    "lunch",
    "dinner",
    "snack",
  ]);
  // No parameters at all stays that way, rather than an empty object.
  assert.ok(!("parameters" in tools.find((t) => t.name === "end_check_in")!));
});

test("the agent speaks v4 Turbo, keeps nothing and starts only from a signed link", () => {
  const { conversation_config: config, platform_settings: platform } =
    elevenLabsAgent();
  assert.equal(config.tts.model_id, "eleven_v4_turbo");
  assert.equal(config.tts.agent_output_audio_format, "pcm_24000");
  assert.equal(config.asr.user_input_audio_format, "pcm_16000");
  assert.equal(config.agent.prompt.llm, "gemini-3.8-flash");
  assert.equal(config.agent.first_message, "");
  assert.ok(config.conversation.client_events.includes("client_tool_call"));
  assert.equal(config.conversation.max_duration_seconds, 1800);
  assert.equal(platform.auth.enable_auth, true);
  assert.equal(
    platform.overrides.conversation_config_override.agent.prompt.prompt,
    true,
  );
  assert.equal(platform.privacy.record_voice, false);
  assert.equal(platform.privacy.retention_days, 0);
  // Without a choice, English and the default voice.
  assert.deepEqual(elevenLabsStart("Today's records"), {
    type: "conversation_initiation_client_data",
    conversation_config_override: {
      agent: { prompt: { prompt: "Today's records" }, language: "en" },
      tts: { voice_id: "cjVigY5qzO86Huf0OWal" },
    },
  });
});

function fakeElevenLabs(routes: Record<string, (body?: unknown) => Response>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const { pathname, search } = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: pathname + search, body });
    assert.equal(
      (init?.headers as Record<string, string>)["xi-api-key"],
      "test-key",
    );
    const route = routes[`${method} ${pathname}`];
    return route ? route(body) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const json = (value: unknown, status = 200) => Response.json(value, { status });

test("the agent is created once, then reused for every call", async () => {
  const { fetcher, calls } = fakeElevenLabs({
    "GET /v1/convai/agents": () =>
      json({ agents: [{ agent_id: "other", name: "Someone else" }] }),
    "POST /v1/convai/agents/create": () => json({ agent_id: "agent_1" }),
    "GET /v1/convai/conversation/get-signed-url": () =>
      json({
        signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?token=t",
      }),
  });
  assert.equal(
    await elevenLabsSignedUrl(fetcher),
    "wss://api.elevenlabs.io/v1/convai/conversation?token=t",
  );
  await elevenLabsSignedUrl(fetcher);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path.split("?")[0]}`),
    [
      "GET /v1/convai/agents",
      "POST /v1/convai/agents/create",
      "GET /v1/convai/conversation/get-signed-url",
      "GET /v1/convai/conversation/get-signed-url",
    ],
  );
  assert.equal(
    calls[1].body && (calls[1].body as { name: string }).name,
    "Lift Journal Coach",
  );
  assert.ok(calls[2].path.endsWith("agent_id=agent_1"));
});

test("an existing agent gets this release's tools, and a deleted one is made again", async () => {
  let patched = 0;
  const found = fakeElevenLabs({
    "GET /v1/convai/agents": () =>
      json({ agents: [{ agent_id: "agent_7", name: "Lift Journal Coach" }] }),
    "PATCH /v1/convai/agents/agent_7": () => (patched++, json({})),
  });
  assert.equal(await elevenLabsAgentId(found.fetcher), "agent_7");
  assert.equal(await elevenLabsAgentId(found.fetcher), "agent_7");
  assert.equal(patched, 1);

  resetElevenLabsAgent();
  const gone = fakeElevenLabs({
    "GET /v1/convai/agents": () =>
      json({ agents: [{ agent_id: "agent_7", name: "Lift Journal Coach" }] }),
    "POST /v1/convai/agents/create": () => json({ agent_id: "agent_8" }),
  });
  assert.equal(await elevenLabsAgentId(gone.fetcher), "agent_8");

  // A configured id is never replaced behind the owner's back.
  resetElevenLabsAgent();
  process.env.ELEVENLABS_AGENT_ID = "agent_fixed";
  const fixed = fakeElevenLabs({});
  await assert.rejects(elevenLabsAgentId(fixed.fetcher), ElevenLabsError);
  assert.deepEqual(
    fixed.calls.map((c) => c.path),
    ["/v1/convai/agents/agent_fixed"],
  );
});

test("a failed sync is retried on the next call, and running out of credit is told apart", async () => {
  let attempts = 0;
  const { fetcher } = fakeElevenLabs({
    "GET /v1/convai/agents": () =>
      ++attempts === 1
        ? json({ detail: { status: "quota_exceeded" } }, 401)
        : json({ agents: [] }),
    "POST /v1/convai/agents/create": () => json({ agent_id: "agent_2" }),
  });
  const error = await elevenLabsAgentId(fetcher).catch((e) => e);
  assert.ok(error instanceof ElevenLabsError && error.credit);
  assert.equal(await elevenLabsAgentId(fetcher), "agent_2");
  assert.ok(!new ElevenLabsError(500, "server error").credit);
  assert.ok(new ElevenLabsError(402, "").credit);
});

test("the ElevenLabs coach is told it can't see photos", () => {
  const state = emptyJournal();
  const clock = localClock(
    new Date("2026-09-30T07:00:00Z"),
    "Europe/Copenhagen",
  );
  const context = voiceContext(state, clock.date);
  const gemini = voiceInstruction(context, clock, "Sam");
  const eleven = voiceInstruction(context, clock, "Sam", "checkin", [], {
    seesPhotos: false,
  });
  assert.match(gemini, /view_photo/);
  assert.doesNotMatch(eleven, /view_photo|list_photos/);
  assert.match(eleven, /You can't see the photo/);
  assert.match(eleven, /open_camera/);
});
