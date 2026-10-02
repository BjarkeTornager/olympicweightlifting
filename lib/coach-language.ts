import { z } from "zod";

// The language Coach writes and speaks in, chosen in the iPhone app's
// Profile. Without one (the website, older apps) typed Coach answers in the
// athlete's own language and the voice coach speaks English.
export const coachLanguageSchema = z.enum(["en", "da"]);
export type CoachLanguage = z.infer<typeof coachLanguageSchema>;

const names: Record<CoachLanguage, string> = { en: "English", da: "Danish" };

/** One line for typed Coach's per-message context. */
export function replyLanguage(language?: CoachLanguage) {
  if (!language) return "";
  return language === "da"
    ? "\nThe athlete has chosen Danish for Coach: write every reply in Danish (dansk), whatever language their message is in. Keep numbers, units and the exercise names they use."
    : "\nThe athlete has chosen English for Coach: write every reply in English, whatever language their message is in.";
}

/** The voice coach's first rule: one language, and mishearings aren't a
 * switch. English is the wording the coach has had since September. */
export function speakingRule(language: CoachLanguage = "en") {
  if (language === "en")
    return `1. Speak English only, in every reply. Speech recognition often mishears short or unclear English as Spanish, Danish or another language; that is a transcription error, not the athlete switching language. If you did not understand, say so in English and ask them to repeat. Use another language only if the athlete explicitly asks for it by name ("speak Danish"), and then keep to it.`;
  return `1. Speak ${names[language]} only, in every reply: the athlete chose it in the app. Speech recognition often mishears short or unclear ${names[language]} as Norwegian, Swedish, English or another language; that is a transcription error, not the athlete switching language. If you did not understand, say so in ${names[language]} and ask them to repeat. Use another language only if the athlete explicitly asks for it by name ("speak English"), and then keep to it. Tool arguments stay as described (dates, numbers, catalogue ids); summaries and meal names may be in ${names[language]}.`;
}

/** The time-of-day greeting in the chosen language. */
export function greeting(
  part: "morning" | "afternoon" | "evening" | "night",
  language: CoachLanguage = "en",
) {
  const words = {
    en: {
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
      night: "Hi",
    },
    da: {
      morning: "Godmorgen",
      afternoon: "God eftermiddag",
      evening: "God aften",
      night: "Hej",
    },
  };
  return words[language][part];
}

/** Gemini Live's language code; native audio follows the instructions, but
 * the code keeps transcription on the right language. */
export const speechLanguageCode = (language: CoachLanguage = "en") =>
  language === "da" ? "da-DK" : "en-US";
