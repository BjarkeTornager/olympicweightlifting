import { z } from "zod";

// The voices and languages the athlete can pick for spoken check-ins in the
// iPhone app's Profile. The server owns the lists so a new voice needs no app
// release; the phone shows what GET /api/voice/session returns.

export const voiceLanguages = ["en", "da"] as const;
export type VoiceLanguage = (typeof voiceLanguages)[number];
export const voiceLanguageSchema = z.enum(voiceLanguages);

export const languageNames: Record<VoiceLanguage, string> = {
  en: "English",
  da: "Dansk",
};

export type VoiceOption = { id: string; name: string; detail: string };

// A prebuilt Gemini voice chosen to sound like a coach at the platform.
export const DEFAULT_GOOGLE_VOICE = process.env.VOICE_NAME || "Orus";
// Eric, ElevenLabs' default conversational voice: calm, clear and warm.
export const DEFAULT_ELEVENLABS_VOICE =
  process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal";

// Gemini Live's prebuilt voices. Every voice speaks every supported language,
// Danish included.
const googleVoices: VoiceOption[] = [
  { id: "Orus", name: "Orus", detail: "Firm, male" },
  { id: "Algenib", name: "Algenib", detail: "Gravelly, male" },
  { id: "Achird", name: "Achird", detail: "Friendly, male" },
  { id: "Sadachbia", name: "Sadachbia", detail: "Lively, male" },
  { id: "Charon", name: "Charon", detail: "Informative, male" },
  { id: "Fenrir", name: "Fenrir", detail: "Excitable, male" },
  { id: "Puck", name: "Puck", detail: "Upbeat, male" },
  { id: "Kore", name: "Kore", detail: "Firm, female" },
  { id: "Sulafat", name: "Sulafat", detail: "Warm, female" },
  { id: "Aoede", name: "Aoede", detail: "Breezy, female" },
  { id: "Leda", name: "Leda", detail: "Youthful, female" },
  { id: "Zephyr", name: "Zephyr", detail: "Bright, female" },
];

// ElevenLabs' premade voices. They speak Danish through the multilingual
// voice model, with an accent; a native Danish voice from the ElevenLabs
// voice library can be added with ELEVENLABS_VOICES.
const elevenLabsVoices: VoiceOption[] = [
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", detail: "Calm and warm, male" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", detail: "Deep, male" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", detail: "Casual, male" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", detail: "Energetic, male" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", detail: "Warm, British male" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", detail: "Confident, female" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", detail: "Warm, female" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", detail: "Playful, female" },
];

/** Extra voices from the environment, as `id:Name:detail` separated by
 * commas, for example a Danish voice from the ElevenLabs voice library. */
export function extraVoices(raw: string | undefined): VoiceOption[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [id, name, ...detail] = entry.split(":").map((p) => p.trim());
      return id && /^[A-Za-z0-9_-]{1,64}$/.test(id)
        ? [{ id, name: name || id, detail: detail.join(":") || "Added voice" }]
        : [];
    });
}

function withDefault(list: VoiceOption[], fallback: string) {
  return list.some((v) => v.id === fallback)
    ? list
    : [{ id: fallback, name: "Default", detail: "Set on the server" }, ...list];
}

export function voiceChoices(provider: "google" | "elevenlabs") {
  const extra =
    provider === "google"
      ? extraVoices(process.env.VOICE_NAMES)
      : extraVoices(process.env.ELEVENLABS_VOICES);
  const base = provider === "google" ? googleVoices : elevenLabsVoices;
  const list = [
    ...base,
    ...extra.filter((e) => !base.some((v) => v.id === e.id)),
  ];
  return withDefault(
    list,
    provider === "google" ? DEFAULT_GOOGLE_VOICE : DEFAULT_ELEVENLABS_VOICE,
  );
}

/** The chosen voice if this server offers it, otherwise the default. */
export function resolveVoice(
  provider: "google" | "elevenlabs",
  requested: string | undefined,
) {
  const fallback =
    provider === "google" ? DEFAULT_GOOGLE_VOICE : DEFAULT_ELEVENLABS_VOICE;
  return requested && voiceChoices(provider).some((v) => v.id === requested)
    ? requested
    : fallback;
}

/** What Profile shows: the languages, and the voices for each provider. */
export function voiceOptions() {
  return {
    languages: voiceLanguages.map((id) => ({ id, name: languageNames[id] })),
    defaultVoices: {
      google: DEFAULT_GOOGLE_VOICE,
      elevenlabs: DEFAULT_ELEVENLABS_VOICE,
    },
    voices: {
      google: voiceChoices("google"),
      elevenlabs: voiceChoices("elevenlabs"),
    },
  };
}
