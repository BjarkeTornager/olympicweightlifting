# Spoken daily check-in — 26 September 2026

Production data showed logging depends on remembering to open the app and type: food fell from 5 meals a day to almost none, and 17 lifting videos were uploaded on days with no logged sets. Reminders only point back at the same chore. This prototype lets Coach ask instead: a short spoken conversation that covers only what is still missing today.

## Flow

Today or Coach → **Check in by voice** → **Start talking**. Coach speaks first and asks about training, food and last night's sleep, skipping what is already recorded. After each topic the voice model hands a factual summary to Coach, which saves it through the normal direct-logging path with receipts and Undo. The call shows each save, tells the athlete if one failed, and hangs up after a goodbye (or End). Transcripts stay in the browser.

## Design

- Model: `gemini-3.8-live-extended-thinking` (Gemini Live API, stable), `thinkingLevel: low`. `VOICE_MODEL=gemini-3.8-live` switches to the faster non-thinking model, which must not receive a thinking level.
- `POST /api/voice/session` builds the instructions from today's records, then mints a single-use ephemeral token (`/v1beta/auth_tokens`, 10-minute session, 60-second start window) with the whole setup in `bidiGenerateContentSetup`. With no field mask that setup overrides anything the browser sends. `GEMINI_API_KEY` never leaves the server. Three sessions per minute per account.
- The phone connects straight to `BidiGenerateContentConstrained`. An AudioWorklet (`public/voice-capture-worklet.js`) sends 16 kHz PCM; 24 kHz replies are scheduled with Web Audio and cut off on interruption.
- Tools: `save_to_journal` (non-blocking; queues an ordinary Coach message prefixed as transcribed speech and waits for that turn) and `end_check_in`. Gemini itself never writes to the journal. This model rejects function-response `scheduling`.
- `Permissions-Policy` now allows the microphone for this origin only; `connect-src` adds `wss://generativelanguage.googleapis.com`.
- The availability check uses a plain fetch so a failed optional check can never sign the person out.

## Setup

`GEMINI_API_KEY` is a key in Google Cloud project `lift-journal-bjarke`, restricted to the Generative Language API, on a paid prepay billing account (paid-tier data is not used for Google model training). Speech and transcripts go to Google; the dialog says so on every call.

## Verification

- 6 unit tests: today's context, instructions, token request shape and lifetime, message parsing, transcript joining, PCM round trip. Full suite 288 passing.
- Chromium browser test with a synthetic microphone and a Playwright-served Live socket: audio streaming, transcripts, save through Coach, tool response, hang-up and the receipt in Coach. Full browser suite passed in Chromium, WebKit and Firefox.
- A real text-driven session against Google with the production key and setup: greeting by name, a correct training summary tool call, numbers read back, next topic, clean `end_check_in`. First audio 0.6–1 s after the athlete stops; about 5 s after a save while the tool result returns.

Not yet verified: real speech on iPhone Safari/Home Screen app (echo from the speaker, gym noise, heard weights) and a save through real Coach in production.
