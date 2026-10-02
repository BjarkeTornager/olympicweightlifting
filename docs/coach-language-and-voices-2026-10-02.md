# Coach's language and voice — 2 October 2026

In the iPhone app, Profile has two new settings:

- **Coach's language:** English or Dansk. Coach writes every reply in it, in chat and in voice check-ins. Until it's set, it follows the iPhone's language (Danish iPhones get Danish).
- **Voice check-in › Voice:** a voice for each provider. The voice is kept per provider, so switching between Google and ElevenLabs keeps both choices. Both settings stay on the phone and apply from the next message or call.

## How it works

**Typed Coach.**
- `forwardedProps.language` (`en` or `da`) adds one line to the per-message system context (`requestTime`), and the time-of-day greeting follows it ("Godmorgen").
- The reviewed core prompt and its fingerprint are unchanged.
- Without a language (the website, older apps), Coach still answers in the athlete's own language.

**Voice check-ins.** `POST /api/voice/session` takes `language` and `voice`.
- **Instructions:** the first rule ("speak X only; mishearings aren't a switch") and the greeting follow the language. English keeps its September wording.
- **Gemini Live:** gets the voice name and `languageCode` (`da-DK` or `en-US`). Both were checked against the live model.
- **ElevenLabs:** gets `agent.language` and `tts.voice_id` overrides. The agent now allows those two overrides besides the prompt.
- **Voices off the list:** a voice that isn't on the server's list gets the default.

**Voice list.**
- `lib/voice-options.ts` holds coach-like voices: 9 of Google's prebuilt voices and 8 of ElevenLabs' premade ones, each with a short description.
- `/api/v1/config` sends them as `voiceOptions`, with the server's default marked. The list can change without an app update.

## Also fixed

ElevenLabs sends silence as a "..." transcript. The app no longer shows or saves it as a line from the athlete.

## Verification

- **Server:** `tests/coach-language.test.ts`:
  - typed Coach's language line and greeting, with nothing added without a language
  - the voice rule and greeting in Danish
  - voice and language reaching both providers, with the default for anything off the list
  - the agent allowing exactly the overrides the phone sends
  - the voice list
- **App and LiftKit:** voice and language choices with their fallbacks, and silence transcripts.
- **Real Danish calls from the simulator, with real keys:**
  - ElevenLabs with Sarah opened with "Godmorgen Sam! Jeg kan se, du allerede har gået en tur på fyrre minutter…" from the day's records.
  - Google with Kore opened in Danish the same way.
  - Typed Coach answered an English message in Danish.
  - A typed real ElevenLabs conversation in Danish saved sleep with a Danish summary.
