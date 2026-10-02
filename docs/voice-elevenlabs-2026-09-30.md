# ElevenLabs as a second voice — 30 September 2026

The iPhone app can run spoken check-ins with ElevenLabs instead of Google. Profile › Voice check-in switches between them. The choice is kept on the phone and applies from the next call. The website stays on Google.

## How it works

- **Google** (default): Gemini Live, `gemini-3.8-live-extended-thinking`, one model that listens and speaks (see [voice-checkin-2026-09-26.md](voice-checkin-2026-09-26.md)).
- **ElevenLabs**: an ElevenAgents agent. ElevenLabs transcribes the speech, Gemini 3.8 Flash (called by ElevenLabs) decides what to say, and Eleven v4 Turbo speaks it.
- Both run the same instructions and tools. Every save still goes through `POST /api/voice/action`, with receipts and Undo. The call screen and transcripts are unchanged.
- `POST /api/voice/session` takes `provider: "elevenlabs"` from the iPhone. It returns a signed WebSocket link and the call's instructions (`start`); the phone sends `start` first. The API key never leaves the server.
- The agent ("Lift Journal Coach") is created in the ElevenLabs account on the first call. After that it is found by name, and its settings are applied once per server start (`lib/voice-elevenlabs.ts`). If it is deleted in the dashboard, it is made again.
  - Audio: 16 kHz in and 24 kHz out, the same as Gemini, so the iPhone's audio code is shared.
  - Signed links only, so the agent can't be reached without this server.
  - The prompt can be overridden per call and is replaced by that call's instructions.
- On the phone, `ElevenLabsProtocol` (LiftVoice) turns ElevenLabs' messages into the same events as Gemini's. `VoiceCall` runs either. Notes from the app ("the athlete started the call", "Apple Health added sleep") become a `user_message` when the coach should answer, and a `contextual_update` otherwise.
  - Tool results go back as text. ElevenLabs ends the call if it gets an object.
- `/api/v1/config` lists `voiceProviders`. The picker appears only when both voices are set up.

## Setup

Set `ELEVENLABS_API_KEY` on Railway. The key needs ElevenAgents write access; voice read access helps with choosing voices.

Optional settings:
- `ELEVENLABS_VOICE_ID`: default Eric, `cjVigY5qzO86Huf0OWal`.
- `ELEVENLABS_LLM`: default `gemini-3.8-flash`.
- `ELEVENLABS_AGENT_ID`: use a fixed agent instead of the one found by name.

Without the key, nothing changes: the app offers Google only.

## Privacy

- The agent does not record audio (`record_voice: false`) and schedules each conversation for deletion (`retention_days: 0`). Transcripts are stored in the athlete's account, as with Google.
- ElevenLabs' full zero-retention mode needs an Enterprise plan.
- The consent screen and the privacy policy name ElevenLabs.

## Limits

- **Photos (updated 2 October):** a photo taken with the call's camera now reaches the ElevenLabs coach. `/api/voice/photo` uploads a 1024 px copy to the conversation, and the phone sends it as a `multimodal_message`. Saved photos still can't be opened. The original note follows. The ElevenLabs coach can't be sent photos mid-call. `list_photos` and `view_photo` are left out. A photo taken with the call's camera is still saved and linked to the meal, and the coach asks what's on the plate.
- **Session resumption:** ElevenLabs has none. After a dropped connection, the call reconnects with a fresh link and the last few lines, as Gemini does without a resumption handle.
- **Cost:** about $0.08 a minute beyond the plan's included minutes, plus Gemini 3.8 Flash tokens. Gemini Live's list price is about $0.023 a minute.

## Verification

- **Server:** 6 tests (`tests/voice-elevenlabs.test.ts`):
  - every tool translated with a type and description, and no photo tools
  - agent settings
  - created once, then reused
  - an existing agent updated, and a deleted one remade
  - a failed sync retried, and credit errors told apart
  - the no-photos instructions
- **LiftKit:** 5 tests (`ElevenLabsProtocolTests`): every message kind, tool arguments keeping their snake_case names, format and credit failures, and the outgoing shapes.
- **App:** the provider choice and its fallback.
- **End to end in the simulator,** against a local stand-in for ElevenLabs with the real agent endpoints and conversation socket:
  - The server created the agent and signed a link.
  - The coach opened, and its audio played.
  - An interrupted reply was trimmed to what was said.
  - `log_sleep` saved 7.5 h through the real server with a receipt.
  - The goodbye ended the call ("1 saved").
  - A Google call on the same build then greeted with the saved sleep.
- **Not yet done:** a real call through ElevenLabs. It needs the key.
