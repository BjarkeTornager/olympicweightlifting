import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import recorded from "../lib/voice-samples.json";
import { voiceChoices, voiceSamples } from "../lib/voice-options";

test("every voice on offer has a sample in English and Danish", () => {
  for (const [provider, voices] of Object.entries(voiceChoices)) {
    for (const voice of voices) {
      const samples = voiceSamples(
        provider as "google" | "elevenlabs",
        voice.id,
      );
      for (const language of ["en", "da"] as const) {
        const path = samples[language];
        assert.ok(path, `${provider}/${voice.id} ${language}`);
        // A few seconds of speech: not missing, empty or a whole recording.
        const bytes = statSync(`public${path}`).size;
        assert.ok(bytes > 10_000 && bytes < 200_000, `${path}: ${bytes} bytes`);
      }
    }
  }
});

test("no sample is kept for a voice that is no longer offered", () => {
  const offered = new Set(
    Object.entries(voiceChoices).flatMap(([provider, voices]) =>
      voices.map((v) => `${provider}/${v.id}`),
    ),
  );
  assert.deepEqual(
    Object.keys(recorded).filter((key) => !offered.has(key)),
    [],
  );
});
