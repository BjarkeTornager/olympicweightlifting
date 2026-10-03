// Tidies a voice call's transcript. The live model's speech-to-text arrives
// as fragments without reliable punctuation, casing or spacing, and it
// mishears domain words. After a call, a text model fixes those line by line,
// using the coach's replies and exercise names as context. It never adds,
// drops or summarises what was said, and anything that doesn't check out
// keeps the raw line. The raw transcript is kept beside the tidy one.
import { EXERCISES } from "./domain";
import {
  modelRequest,
  providerConfig,
  readModelResponse,
} from "./agent/provider";

export type Line = { role: "you" | "coach"; text: string };
export const TIDY_MODEL = "openai/gpt-5.6-luna";

const exerciseNames = [
  ...new Set(EXERCISES.map((e: { name: string }) => e.name)),
].join(", ");

export const tidyInstructions = `You tidy a speech-to-text transcript of a voice call between an athlete and their strength, nutrition and wellbeing coach. "you" lines are the athlete, "coach" lines the coach. The athlete may speak Danish or English; keep every Danish or English line in the language it was spoken.

For each line:
- Fix punctuation, capital letters, spacing and words run together, and split run-on speech into sentences.
- Correct a word only when it was clearly misheard, judging from the conversation (the coach's replies show what the coach understood), exercise names and ordinary food, drink, sleep and training vocabulary. Keep numbers, units and names exactly as said unless they are clearly misheard.
- The athlete speaks only Danish or English. A short "you" line in another language (such as "Não", "Sí" or "Claro") is a mishearing: write the Danish or English words it most plausibly was, judging from the coach's reply.
- Remove only filler sounds such as "um" and "øh" and words repeated by a stumble.
- Never add, drop, reorder, merge or summarise content, never answer or comment, and keep the speaker. If unsure, keep the original words.
- Return only the words spoken, without a speaker label such as "coach:" or "you:".

Exercise names in this app, for spelling (lower-case them mid-sentence as usual): ${exerciseNames}.

Return JSON only: {"lines":["tidied line 1","tidied line 2",...]} with exactly one string per input line, in the same order.`;

// A speaker label the model put in front of a line, such as "coach: ".
const label = /^\s*(?:you|coach|athlete|speaker)\s*:\s*/i;

// Removes a speaker label from a tidy line unless it was spoken.
export function withoutLabel(tidy: string, raw: string) {
  return label.test(raw) ? tidy : tidy.replace(label, "");
}

// Accepts the model's lines only when they plausibly are the same speech:
// one per input line, none empty, and no line much shorter or longer than
// what was said. A doubtful line keeps its raw text.
export function acceptTidy(raw: Line[], lines: unknown): Line[] | null {
  if (!Array.isArray(lines) || lines.length !== raw.length) return null;
  return raw.map((line, i) => {
    const text =
      typeof lines[i] === "string"
        ? withoutLabel(lines[i], line.text).trim()
        : "";
    const before = line.text.trim().length;
    const ok =
      text.length > 0 &&
      text.length <= Math.max(before * 1.6, before + 40) &&
      text.length >= Math.min(before * 0.5, before - 40);
    return { role: line.role, text: ok ? text : line.text.trim() };
  });
}

type Fetch = typeof fetch;
const CHUNK = 80;

// Tidies a whole call, 80 lines at a time; a chunk that fails keeps its raw
// lines. Null when nothing could be tidied.
export async function tidyTranscript(
  raw: Line[],
  transport: Fetch = fetch,
): Promise<Line[] | null> {
  const chunks: Line[][] = [];
  let tidied = false;
  for (let i = 0; i < raw.length; i += CHUNK) {
    const part = raw.slice(i, i + CHUNK);
    const done = await tidyChunk(part, transport).catch(() => null);
    tidied ||= Boolean(done);
    chunks.push(done ?? part);
  }
  return tidied ? chunks.flat() : null;
}

async function tidyChunk(
  raw: Line[],
  transport: Fetch,
): Promise<Line[] | null> {
  const config = providerConfig();
  if (!config || config.kind !== "openrouter" || !raw.length) return null;
  const request = modelRequest(
    [
      { role: "system", content: tidyInstructions },
      {
        role: "user",
        content: JSON.stringify({
          lines: raw.map((l) => ({ speaker: l.role, text: l.text })),
        }),
      },
    ],
    [],
    config,
    { model: TIDY_MODEL },
  );
  const response = await transport(request.url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
    },
    // Room for the whole transcript back, with its punctuation.
    body: JSON.stringify({
      ...request.body,
      max_completion_tokens: Math.min(16000, 800 + raw.length * 120),
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const reply = await readModelResponse(
    await response.json(),
    "openrouter",
    TIDY_MODEL,
  );
  if (reply.truncated) return null;
  const json = reply.content.slice(
    reply.content.indexOf("{"),
    reply.content.lastIndexOf("}") + 1,
  );
  try {
    return acceptTidy(raw, (JSON.parse(json) as { lines?: unknown }).lines);
  } catch {
    return null;
  }
}
