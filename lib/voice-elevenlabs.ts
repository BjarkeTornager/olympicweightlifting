import { voiceConfigured, voiceTools } from "./voice-checkin";

// Spoken check-ins through ElevenLabs' ElevenAgents, the alternative to
// Gemini Live the athlete can choose in the iPhone app. The same instructions
// and tools: ElevenLabs transcribes, Gemini 3.8 Flash (called by ElevenLabs)
// answers and Eleven v4 Turbo speaks. The phone connects with a signed link
// and runs every tool against /api/voice/action, exactly as with Gemini; the
// API key never leaves the server.

const API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";
export const ELEVENLABS_TTS_MODEL = "eleven_v4_turbo";
export const ELEVENLABS_LLM = process.env.ELEVENLABS_LLM || "gemini-3.8-flash";
// Eric, ElevenLabs' default conversational voice: calm, clear and warm.
export const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal";
export const ELEVENLABS_AGENT_NAME = "Lift Journal Coach";
// As long as the iPhone keeps a Gemini call going across reconnects.
export const ELEVENLABS_CALL_MINUTES = 30;
export const ELEVENLABS_CREDIT_MESSAGE =
  "Voice is paused because the ElevenLabs credit has run out. Switch to Google in Profile, or keep typing to Coach.";

export function elevenLabsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export type VoiceProvider = "google" | "elevenlabs";

/** The voices this server can start, Google first (the website's). */
export function voiceProviders(): VoiceProvider[] {
  return [
    ...(voiceConfigured() ? (["google"] as const) : []),
    ...(elevenLabsConfigured() ? (["elevenlabs"] as const) : []),
  ];
}

// Tools that need Gemini's image input: the ElevenLabs coach can't be sent
// a photo mid-call, so it asks what's on the plate instead.
const photoTools = new Set(["list_photos", "view_photo"]);

type GeminiSchema = {
  type: string;
  description?: string;
  enum?: readonly string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: readonly string[];
};

const label = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

/** Gemini's schema (STRING, OBJECT…) as ElevenLabs' JSON schema. ElevenLabs
 * asks the model for each value by its description, so none may be empty. */
export function elevenLabsSchema(
  schema: GeminiSchema,
  fallback: string,
): Record<string, unknown> {
  const type = schema.type.toLowerCase();
  const description = schema.description || fallback;
  if (type === "object")
    return {
      type,
      description,
      properties: Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, value]) => [
          key,
          elevenLabsSchema(value, label(key)),
        ]),
      ),
      required: [...(schema.required ?? [])],
    };
  if (type === "array")
    return {
      type,
      description,
      items: elevenLabsSchema(schema.items!, `One of: ${description}`),
    };
  return { type, description, ...(schema.enum && { enum: [...schema.enum] }) };
}

export function elevenLabsTools() {
  return voiceTools()[0]
    .functionDeclarations.filter((tool) => !photoTools.has(tool.name))
    .map((tool) => ({
      type: "client",
      name: tool.name,
      description: tool.description,
      expects_response: true,
      // The phone retries a save for up to about 20 seconds.
      response_timeout_secs: 30,
      ...("parameters" in tool && {
        parameters: elevenLabsSchema(
          tool.parameters as GeminiSchema,
          tool.description,
        ),
      }),
    }));
}

/** The agent in the ElevenLabs account. Each call's instructions (today's
 * records, recent conversations) replace its placeholder prompt when the
 * phone starts the conversation. */
export function elevenLabsAgent() {
  return {
    name: ELEVENLABS_AGENT_NAME,
    tags: ["lift-journal"],
    conversation_config: {
      // The iPhone records 16 kHz and plays 24 kHz, as with Gemini.
      asr: { user_input_audio_format: "pcm_16000" },
      tts: {
        model_id: ELEVENLABS_TTS_MODEL,
        voice_id: ELEVENLABS_VOICE_ID,
        agent_output_audio_format: "pcm_24000",
      },
      conversation: {
        max_duration_seconds: ELEVENLABS_CALL_MINUTES * 60,
        client_events: [
          "conversation_initiation_metadata",
          "ping",
          "audio",
          "interruption",
          "user_transcript",
          "agent_response",
          "agent_response_correction",
          "client_tool_call",
          "client_error",
        ],
      },
      agent: {
        // The coach opens from the day's records once the app says the call
        // started, as with Gemini.
        first_message: "",
        language: "en",
        prompt: {
          prompt:
            "You are the athlete's coach. This call's instructions arrive when it starts.",
          llm: ELEVENLABS_LLM,
          // Low, like Gemini Live's thinking level: replies stay prompt.
          reasoning_effort: "low",
          tools: elevenLabsTools(),
        },
      },
    },
    platform_settings: {
      // Only a signed link from this server starts a call.
      auth: { enable_auth: true },
      overrides: {
        conversation_config_override: { agent: { prompt: { prompt: true } } },
      },
      // No recordings; transcripts are kept here, not at ElevenLabs.
      privacy: { record_voice: false, retention_days: 0, delete_audio: true },
    },
  };
}

type Fetcher = typeof fetch;

async function request<T>(
  fetcher: Fetcher,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetcher(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY!,
      ...(init.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ElevenLabsError(response.status, detail.slice(0, 300));
  }
  return (await response.json()) as T;
}

export class ElevenLabsError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`ElevenLabs request failed: ${status} ${detail}`);
  }
  /** Out of characters or credit: retrying cannot help. */
  get credit() {
    return (
      this.status === 402 ||
      /quota|credit|insufficient|payment/i.test(this.message)
    );
  }
}

let agent: Promise<string> | undefined;

/** The agent's id, found by name or created, with this release's tools and
 * settings applied once per server process. */
export function elevenLabsAgentId(fetcher: Fetcher = fetch) {
  agent ??= syncAgent(fetcher).catch((error) => {
    agent = undefined;
    throw error;
  });
  return agent;
}

async function syncAgent(fetcher: Fetcher) {
  const config = elevenLabsAgent();
  let id = process.env.ELEVENLABS_AGENT_ID;
  if (!id) {
    const page = await request<{
      agents: { agent_id: string; name: string }[];
    }>(
      fetcher,
      `/v1/convai/agents?search=${encodeURIComponent(ELEVENLABS_AGENT_NAME)}&page_size=30`,
    );
    id = page.agents.find((a) => a.name === ELEVENLABS_AGENT_NAME)?.agent_id;
  }
  if (id) {
    try {
      await request(fetcher, `/v1/convai/agents/${id}`, {
        method: "PATCH",
        body: config,
      });
      return id;
    } catch (error) {
      // Deleted in the ElevenLabs dashboard: make it again, unless a fixed
      // id was configured.
      const gone = error instanceof ElevenLabsError && error.status === 404;
      if (!gone || process.env.ELEVENLABS_AGENT_ID) throw error;
    }
  }
  const created = await request<{ agent_id: string }>(
    fetcher,
    "/v1/convai/agents/create",
    { method: "POST", body: config },
  );
  return created.agent_id;
}

/** A signed link that opens one conversation with the agent. */
export async function elevenLabsSignedUrl(fetcher: Fetcher = fetch) {
  for (let attempt = 0; ; attempt++) {
    const id = await elevenLabsAgentId(fetcher);
    try {
      const { signed_url } = await request<{ signed_url: string }>(
        fetcher,
        `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`,
      );
      return signed_url;
    } catch (error) {
      // The agent was deleted in the ElevenLabs dashboard: make it again.
      if (
        attempt === 0 &&
        error instanceof ElevenLabsError &&
        error.status === 404
      ) {
        agent = undefined;
        continue;
      }
      throw error;
    }
  }
}

/** What the phone sends first on the socket: this call's instructions. */
export function elevenLabsStart(instruction: string) {
  return {
    type: "conversation_initiation_client_data",
    conversation_config_override: {
      agent: { prompt: { prompt: instruction } },
    },
  };
}

/** For tests: forget the agent found in this process. */
export function resetElevenLabsAgent() {
  agent = undefined;
}
