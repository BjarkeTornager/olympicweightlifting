# Voice samples, photos on ElevenLabs and faster saves — 2 October 2026

Three changes from the owner's first calls with the new voices.

## Hear a voice before picking it

Picking a voice in Profile › Voice check-in › Voice plays a sample of about five seconds, like choosing a ringtone. The sample is in Coach's chosen language: English, "Morning! Great work on the squats yesterday. How did you sleep last night?", or Danish.

- **Recording:** `scripts/voice-samples.ts` records all 17 voices through the same setups a call uses, Gemini Live and the ElevenLabs agent, so a sample sounds like a call. It keeps a sample only if its transcript matches the line (all 34 matched on the first try). The line avoids numbers, because transcripts write them as digits.
- **Files:** AAC in `public/voice-samples/<provider>/<id>.<lang>.m4a`, 40–60 KB each and 1.5 MB in all. `lib/voice-samples.json` lists them.
- **Serving:** `/api/v1/config` sends each voice's sample paths as `samples`. The files are public static assets.
- **App:** `VoiceSamplePlayer` plays them with `AVAudioPlayer` (`.playback`, spoken audio, ducking other audio). A new pick stops the last, and leaving the list stops it too.
- **New voices:** to add one, put it in `lib/voice-options.ts` and run the script for it (`npx tsx scripts/voice-samples.ts elevenlabs/<id>`). A test fails if any voice on offer lacks a sample.

## The ElevenLabs coach sees photos

In a Danish ElevenLabs call, the coach said it couldn't see a photo the athlete had just taken. ElevenLabs can take images in a running conversation, so the flow is now:

1. The phone saves the photo as before.
2. `POST /api/voice/photo` uploads a 1024 px copy to the call's conversation (`/v1/convai/conversations/{id}/files`, with the key on the server) and returns a file id.
3. The phone sends the photo note as a `multimodal_message` with that file.

The agent's `file_input` is enabled, with at most 10 files per call.

- **Fallback:** if the upload fails, the note says so and the coach asks about the plate.
- **Saved photos:** `list_photos` and `view_photo` remain Gemini-only.
- **Measured** with a drawn plate through the local server:
  - The upload took 3.6 s.
  - The coach answered 1.9 s later: "Jeg kan se to spejlæg og to skiver rugbrød. Passer det…?"
  - After "Ja", it called `log_meal` with the photo linked and the items in Danish.

## Saves no longer leave silence

The coach used to wait for each save before speaking ("Call the tool first, then confirm").

**New rule.** The coach acknowledges in a few words in the same turn and calls the tool at once. It never claims a save before the tool returns success. It doesn't announce a successful save at all, because the app shows every save. A failed save is still said plainly.

**Configuration.** ElevenLabs' save tools have `pre_tool_speech: "force"`. Reads and call controls keep `"auto"`.

**Measured** from the athlete's answer "Jeg sov syv timer i nat", with a 400 ms simulated save:

| | Before | After |
|---|---|---|
| ElevenLabs, first word from the coach | 3.7 s, 9.7 s | 1.7, 1.9, 2.1 s ("Syv timer, noteret.") |
| ElevenLabs, next question | 3.7 s, 9.7 s | about 4.3 s |
| Gemini Live, first word from the coach | ~5 s after a save (September notes) | 0.7, 0.8 s ("Syv timer, modtaget."), save during speech |

## Verification

- **Server:**
  - every voice has both samples, and no samples are stale
  - the photo upload, and its failure
  - the save tools' speech settings
  - the photo and save rules in the instructions
  - all existing voice tests
- **LiftKit:** the conversation id from the metadata, and the shape of the photo message.
- **Simulator** against a local server with the real keys: picking Puck played `Puck.da.m4a` (4.6 s), fetched from the server.

## Update: a line for everyone (2 October, later)

With the [health-for-everyone positioning](product-principles.md), the sample line became "Morning! Nice job on yesterday's walk. How did you sleep last night?" (Danish: "Godmorgen! Flot klaret med gåturen i går. Hvordan har du sovet i nat?").

The 18 Google samples were re-recorded. The ElevenLabs account ran out of credit partway, so its 16 samples keep the earlier line until it's topped up; then run `npx tsx scripts/voice-samples.ts elevenlabs/<id>`.

Recording through the agent costs conversation minutes, about 8–10 for a full set plus tests. With a key that has Text to Speech access, recording could use the cheaper TTS API instead.
