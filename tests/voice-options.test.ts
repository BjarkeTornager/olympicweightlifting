import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extraVoices,
  resolveVoice,
  voiceChoices,
  voiceOptions,
} from "../lib/voice-options";

test("Profile offers English and Danish and a voice list per provider", () => {
  const options = voiceOptions();
  assert.deepEqual(
    options.languages.map((l) => l.id),
    ["en", "da"],
  );
  assert.ok(options.voices.google.some((v) => v.id === "Orus"));
  assert.ok(options.voices.elevenlabs.some((v) => v.name === "Eric"));
  // Every voice has a name and a description to show.
  for (const list of Object.values(options.voices))
    for (const v of list) assert.ok(v.id && v.name && v.detail);
});

test("an unknown voice falls back to the server default", () => {
  assert.equal(resolveVoice("google", "Achird"), "Achird");
  assert.equal(resolveVoice("google", "NotAVoice"), "Orus");
  assert.equal(resolveVoice("google", undefined), "Orus");
  // A Google voice is not an ElevenLabs voice.
  assert.equal(resolveVoice("elevenlabs", "Achird"), "cjVigY5qzO86Huf0OWal");
});

test("extra voices come from the environment", () => {
  assert.deepEqual(extraVoices("abc123:Mads:Native Danish male, bad id!:X"), [
    { id: "abc123", name: "Mads", detail: "Native Danish male" },
  ]);
  process.env.ELEVENLABS_VOICES = "danishVoice1:Mette:Native Danish female";
  try {
    assert.ok(voiceChoices("elevenlabs").some((v) => v.id === "danishVoice1"));
    assert.equal(resolveVoice("elevenlabs", "danishVoice1"), "danishVoice1");
  } finally {
    delete process.env.ELEVENLABS_VOICES;
  }
});
