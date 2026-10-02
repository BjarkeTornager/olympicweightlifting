import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { localClock } from "../lib/agent/time-context";
import { requestTime } from "../lib/agent/knowledge";
import { turnInputSchema } from "../lib/agent/input";
import {
  voiceContext,
  voiceInstruction,
  voiceSetup,
} from "../lib/voice-checkin";
import { elevenLabsAgent, elevenLabsStart } from "../lib/voice-elevenlabs";
import { voiceChoices, voiceFor, voiceOptions } from "../lib/voice-options";

process.env.GEMINI_API_KEY ||= "test";
process.env.ELEVENLABS_API_KEY ||= "test";

const morning = localClock(
  new Date("2026-10-02T06:30:00Z"),
  "Europe/Copenhagen",
);
const evening = localClock(
  new Date("2026-10-02T18:30:00Z"),
  "Europe/Copenhagen",
);

test("typed Coach replies in the chosen language, and in the athlete's own without one", () => {
  const time = morning.time;
  const unset = requestTime(morning.date, morning.timezone, time);
  assert.match(unset, /say "Good morning"/);
  assert.doesNotMatch(unset, /has chosen/);
  const danish = requestTime(morning.date, morning.timezone, time, "da");
  assert.match(danish, /say "Godmorgen"/);
  assert.match(
    danish,
    /write every reply in Danish \(dansk\), whatever language/,
  );
  const english = requestTime(morning.date, morning.timezone, time, "en");
  assert.match(english, /write every reply in English, whatever language/);

  const turn = {
    id: crypto.randomUUID(),
    message: "Hej",
    revision: 0,
    timezone: "Europe/Copenhagen",
  };
  assert.equal(
    turnInputSchema.parse({ ...turn, language: "da" }).language,
    "da",
  );
  assert.equal(turnInputSchema.parse(turn).language, undefined);
  assert.equal(
    turnInputSchema.safeParse({ ...turn, language: "de" }).success,
    false,
  );
});

test("the voice coach speaks the chosen language and greets in it", () => {
  const context = voiceContext(emptyJournal(), evening.date);
  const english = voiceInstruction(context, evening, "Sam");
  // English keeps the wording the voice coach has had since September.
  assert.match(
    english,
    /1\. Speak English only, in every reply\. Speech recognition often mishears short or unclear English as Spanish, Danish/,
  );
  assert.match(english, /say "Good evening"/);
  const danish = voiceInstruction(context, evening, "Sam", "checkin", [], {
    language: "da",
  });
  assert.match(
    danish,
    /1\. Speak Danish only, in every reply: the athlete chose it/,
  );
  assert.match(
    danish,
    /mishears short or unclear Danish as Norwegian, Swedish, English/,
  );
  assert.match(danish, /say "God aften"/);
  assert.doesNotMatch(danish, /Speak English only/);
});

test("a call uses the chosen voice and language, and the default for anything not on the list", () => {
  assert.equal(voiceFor("google", "Kore"), "Kore");
  assert.equal(
    voiceFor("google", "SomeoneElse"),
    process.env.VOICE_NAME || "Orus",
  );
  assert.equal(
    voiceFor("elevenlabs", "EXAVITQu4vr4xnSDxMaL"),
    "EXAVITQu4vr4xnSDxMaL",
  );
  assert.equal(voiceFor("elevenlabs", undefined), "cjVigY5qzO86Huf0OWal");

  const google = voiceSetup("Coach", undefined, {
    voice: "Kore",
    language: "da",
  });
  assert.equal(
    google.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
      .voiceName,
    "Kore",
  );
  assert.equal(google.generationConfig.speechConfig.languageCode, "da-DK");
  assert.equal(
    voiceSetup("Coach").generationConfig.speechConfig.languageCode,
    "en-US",
  );

  assert.deepEqual(
    elevenLabsStart("Coach", { voice: "EXAVITQu4vr4xnSDxMaL", language: "da" }),
    {
      type: "conversation_initiation_client_data",
      conversation_config_override: {
        agent: { prompt: { prompt: "Coach" }, language: "da" },
        tts: { voice_id: "EXAVITQu4vr4xnSDxMaL" },
      },
    },
  );
  // The agent must allow exactly what the phone overrides.
  const allowed =
    elevenLabsAgent().platform_settings.overrides.conversation_config_override;
  assert.deepEqual(allowed, {
    agent: { prompt: { prompt: true }, language: true },
    tts: { voice_id: true },
  });
});

test("the app gets each provider's voices, with this server's default marked once", () => {
  const options = voiceOptions();
  for (const provider of ["google", "elevenlabs"] as const) {
    const mine = options.filter((o) => o.provider === provider);
    assert.equal(mine.length, voiceChoices[provider].length);
    assert.ok(mine.every((o) => o.name && o.detail && o.id));
    assert.equal(mine.filter((o) => o.isDefault).length, 1, provider);
    assert.equal(new Set(mine.map((o) => o.id)).size, mine.length);
  }
});
