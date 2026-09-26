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

## Update: direct saves, fixes and camera (26 September, afternoon)

The first real use showed the relay was the problem: the voice coach forwarded a summary to text Coach, which asked its own follow-up questions ("which load was repeated?"), each costing a full model turn, while an empty unfinished workout from 20 September blocked the save and Coach could only send the athlete to Train.

- The voice coach now saves through `POST /api/voice/action` with structured tools (`log_training`, `log_meal`, `log_sleep`, `log_activity`, `clear_unfinished_workout`, `undo_save`). Each call becomes one ordinary journal action checked by the same change guards and saved with a Coach receipt and Undo (`[voice]` messages, labelled "From your voice check-in"). Server time per save is 20–90 ms in the database tests; there is no second model. A repeated call id returns the same save.
- The voice coach resolves inconsistent numbers before saving and estimates meal nutrition and tags itself.
- A finished session is no longer blocked by an unfinished workout from another date, for voice and text Coach. `discard_workout` clears an old draft only if it has no logged sets; otherwise `finish_workout` keeps the sets. The fixed Coach policy fingerprint was updated for this deliberate change.
- "Take a photo of my food": `open_camera` shows a viewfinder in the call (`camera=(self)`), the shutter or `take_photo` saves a meal photo, sends the image to the coach, and `log_meal` can link it. Only photos seen in the call are accepted as meal sources.
- Coach shows a blue Talk button in place of Send while the message is empty.
- Voice: `VOICE_NAME=Algenib` in production.

## Update: memory, full journal access and calls that last (26 September, evening)

- **Conversation memory in PostgreSQL** (`lib/conversation-memory.ts`, table `voice_calls`, migration `0010_voice_call_memory`). Voice transcripts are saved during and after each call (`POST /api/voice/transcript`, upsert per call id, account-scoped). The voice coach starts with the last ten conversations (typed and spoken) and has `recall_conversations` to search the whole history; typed Coach has `conversation_history`, sees ten recent exchanges (was eight) and recent voice calls. Search is PostgreSQL full-text (`simple` configuration, prefix matching) so Danish and English both work. Restate was considered and not used: it provides durable workflow execution, not storage or search, and would add a separately hosted service.
- **The voice coach sees the journal and photos**: `read_journal` (≤14 days, with meal/session ids and photo ids), `list_photos`, `view_photo` (the phone fetches the private image and sends it to the model), and corrections `update_meal`, `delete_meal` (new action; reviewed in typed Coach), `update_training`. Adding food to a meal already logged — including from a photo — updates that meal instead of creating another.
- **Calls survive**: session resumption handles and sliding-window context compression; on `goAway` or a dropped socket the phone requests a fresh single-use token with the handle and continues the conversation. Returning to the app resumes the call (microphone re-acquired if iOS ended it); if iOS needs a tap to restart audio the call shows *Paused* with **Continue**. The 10-minute cap is now 30 minutes. A web page cannot keep listening while another app is in front; iOS suspends it.
- **Transcript view**: saves appear inline as receipts in one scrolling conversation with a one-line summary, instead of a growing list that pushed the transcript away.

Not device-verified: background/foreground resume and Continue on a physical iPhone.

## Update: English, missing topics only, safe goodbyes and releases (26 September, late afternoon)

Evidence from the owner's calls (`voice_calls` transcripts and deployment logs):

- **Spanish and a "different voice"**: speech recognition heard a short reply as "¿Qué fue?" and the instructions said to follow the athlete's language. Reproduced against the API; fixed with an English-only rule (switch only on an explicit request, ask to repeat when unclear) and `speechConfig.languageCode: "en-US"`. A resume test kept the same voice (≈131 Hz before, 129 Hz after), so the change of voice was the language, not resumption.
- **Asking about logged topics**: the context held the whole day, but the model still walked training → food → sleep. The server now decides which topics are missing and the instruction says exactly which to ask about, or none.
- **Calls ending early**: several transcripts end after short replies ("Not yet.") without a goodbye. `end_check_in` now leaves a 12-second window; anything the athlete says cancels the hang-up. The coach must ask "Anything else?" and hear a clear no.
- **Releases**: the container was replaced with roughly 13 seconds without a server, and #13's version check refused an older app's reconnect. Ongoing calls may now reconnect regardless of app version (only new calls need the current client), reconnects retry for about 40 seconds (continuing from the last lines when no resumption handle exists), saves retry with one id, `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=30` and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=20` keep the old server serving until the new one is live (also recorded in `.railway/railway.ts`, which now preserves the voice and search keys).
- **Diagnostics**: dropped sockets, `goAway`, reconnects and failures are logged via `POST /api/voice/event` (codes and short reasons only). An outdated app gets an **Update now** button.
- **Restate** would not have prevented any of these: audio runs between the phone and Google, and saves are already transactional and idempotent.
