import type { CoachLanguage } from "./coach-language";
import { displayMessage } from "./coach-tasks";
import { writtenLanguage } from "./text-language";

// Lines the server writes into Coach's replies itself, rather than the
// model: the receipt for a change, and what Coach says when it can't
// finish or a change is undone. They take the reply's language. The apps'
// screens are in English, so Train and Food keep their English names.
const lines = {
  en: {
    saved:
      "Saved to your journal. You can check the details, tell me a correction, or undo below.",
    review:
      "Ready for your review. Check the details below, then save when they look right. Tell me any corrections before saving.",
    unfinished:
      "I couldn’t finish that request. Try a shorter question or use Train to log your session.",
    undone: "Undone. Your journal has been restored to before this change.",
  },
  da: {
    saved:
      "Gemt i din journal. Du kan tjekke detaljerne, sige til, hvis noget skal rettes, eller fortryde herunder.",
    review:
      "Klar til gennemgang. Tjek detaljerne herunder, og gem, når de ser rigtige ud. Sig til, hvis noget skal rettes, før du gemmer.",
    unfinished:
      "Jeg kunne ikke gøre det færdigt. Prøv et kortere spørgsmål, eller brug Train til at logge din træning.",
    undone:
      "Fortrudt. Din journal er sat tilbage til, som den var før ændringen.",
  },
} satisfies Record<CoachLanguage, Record<string, string>>;

export const coachLines = (language: CoachLanguage = "en") => lines[language];

/** The language of a reply: the one the athlete's words are written in,
    which Coach answers in, then the one chosen in the app. Without either,
    `texts` after the athlete's words are read in turn until one tells:
    Coach's answer in the same message, then the conversation before it
    (earlierWords). */
export function linesLanguage(
  chosen: CoachLanguage | undefined,
  ...texts: (string | undefined)[]
): CoachLanguage {
  const [words, ...rest] = texts;
  const own = words ? writtenLanguage(words) : undefined;
  if (own) return own;
  if (chosen) return chosen;
  for (const text of rest) {
    const language = text ? writtenLanguage(text) : undefined;
    if (language) return language;
  }
  return "en";
}

/** What the athlete and Coach wrote in earlier turns, newest first, for
    linesLanguage when a message's words don't tell ("Sov 7 timer i nat").
    Without the lines above, which only follow the language. */
export function earlierWords(
  turns: { question: string; reply?: string; status: string }[],
) {
  const own = Object.values(lines).flatMap((l) => Object.values(l));
  return turns
    .filter((t) => t.status === "done")
    .reverse()
    .flatMap((t) => [
      displayMessage(t.question).text,
      own.reduce((reply, line) => reply.replace(line, ""), t.reply ?? ""),
    ]);
}

/** What a reply becomes when the change Coach saved is undone, in the
    language of the reply it replaces. */
export const undoneReply = (reply: string | undefined) =>
  coachLines(linesLanguage(undefined, reply)).undone;
