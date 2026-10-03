import type { CoachLanguage } from "./coach-language";
import { danishOrNothing } from "./text-language";

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

/** The language of a reply: the one chosen in the app, or else the one the
    athlete and Coach write in (Coach answers in the athlete's). */
export function linesLanguage(
  chosen: CoachLanguage | undefined,
  ...texts: (string | undefined)[]
): CoachLanguage {
  return chosen ?? danishOrNothing(texts.filter(Boolean).join("\n")) ?? "en";
}

/** What a reply becomes when the change Coach saved is undone, in the
    language of the reply it replaces. */
export const undoneReply = (reply: string | undefined) =>
  coachLines(linesLanguage(undefined, reply)).undone;
