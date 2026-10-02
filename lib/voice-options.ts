import { VOICE_NAME } from "./voice-checkin";
import { ELEVENLABS_VOICE_ID, voiceProviders } from "./voice-elevenlabs";
import type { VoiceProvider } from "./voice-elevenlabs";

// The voices the athlete can pick from in the iPhone app, per provider:
// coach-like ones from Google's prebuilt voices and ElevenLabs' premade
// library, which every account has. The server sends this list, so it can
// change without an app update, and only accepts voices on it.
export const voiceChoices: Record<
  VoiceProvider,
  { id: string; name: string; detail: string }[]
> = {
  google: [
    { id: "Algenib", name: "Algenib", detail: "Male, gravelly and grounded" },
    {
      id: "Fenrir",
      name: "Fenrir",
      detail: "Male, high-energy and passionate",
    },
    { id: "Puck", name: "Puck", detail: "Male, upbeat and cheerful" },
    { id: "Alnilam", name: "Alnilam", detail: "Male, firm and commanding" },
    { id: "Achird", name: "Achird", detail: "Male, friendly and warm" },
    { id: "Orus", name: "Orus", detail: "Male, firm and no-nonsense" },
    { id: "Kore", name: "Kore", detail: "Female, firm and direct" },
    {
      id: "Laomedeia",
      name: "Laomedeia",
      detail: "Female, upbeat and energetic",
    },
    { id: "Sulafat", name: "Sulafat", detail: "Female, warm and encouraging" },
  ],
  elevenlabs: [
    {
      id: "cjVigY5qzO86Huf0OWal",
      name: "Eric",
      detail: "Male, smooth and trustworthy",
    },
    {
      id: "IKne3meq5aSn9XLyUdCD",
      name: "Charlie",
      detail: "Male, deep and confident, Australian",
    },
    {
      id: "iP95p4xoKVk53GoZ742B",
      name: "Chris",
      detail: "Male, down-to-earth and natural",
    },
    {
      id: "TX3LPaxmHKxFdv7VOQHJ",
      name: "Liam",
      detail: "Male, energetic and warm",
    },
    {
      id: "pNInz6obpgDQGcFmaJgB",
      name: "Adam",
      detail: "Male, firm and dominant",
    },
    {
      id: "EXAVITQu4vr4xnSDxMaL",
      name: "Sarah",
      detail: "Female, confident and reassuring",
    },
    {
      id: "FGY2WhTYpPnrIDTdsKH5",
      name: "Laura",
      detail: "Female, sunny and enthusiastic",
    },
    {
      id: "XrExE9yKIg1WjnnlVkGX",
      name: "Matilda",
      detail: "Female, knowledgeable and upbeat",
    },
  ],
};

const defaults: Record<VoiceProvider, () => string> = {
  google: () => VOICE_NAME,
  elevenlabs: () => ELEVENLABS_VOICE_ID,
};

/** The voice for a call: the athlete's pick if it's on the list, otherwise
 * this server's default. */
export function voiceFor(provider: VoiceProvider, requested?: string) {
  return voiceChoices[provider].some((v) => v.id === requested)
    ? requested!
    : defaults[provider]();
}

/** What the app shows, for the voices this server can run. */
export function voiceOptions() {
  return voiceProviders().flatMap((provider) =>
    voiceChoices[provider].map((voice) => ({
      provider,
      ...voice,
      isDefault: voice.id === defaults[provider](),
    })),
  );
}
