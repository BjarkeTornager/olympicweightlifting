// The judge and the simulated athlete run on a small Gemini text model, billed
// to the Gemini key rather than the production Coach's OpenRouter budget.
import type { Check, Trial, Turn } from "./core";
import { dayForCoach, describeDay } from "../../lib/journal-summary";

export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "gemini-3.8-flash";

async function generate(prompt: string, json: boolean) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: json ? 0 : 0.7,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok)
    throw Error(`${JUDGE_MODEL} request failed: ${response.status}`);
  const data = await response.json();
  return String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

const script = (transcript: Turn[]) =>
  transcript
    .map((t) => `${t.role === "athlete" ? "ATHLETE" : "COACH"}: ${t.text}`)
    .join("\n");

// The next thing the simulated athlete says, or null when their goal is met.
export async function simulateAthlete(goal: string, transcript: Turn[]) {
  const text = await generate(
    `You are role-playing an Olympic weightlifter talking to their coach on a voice call. Stay in character and speak casually and briefly, like a real person on the phone: one or two short sentences, no lists. Only share facts from your goal, and only when asked or when natural. Never invent extra facts. When everything in your goal has been covered and the coach has confirmed it, reply with exactly DONE.

Your goal for this call: ${goal}

Conversation so far:
${script(transcript) || "(The call just started.)"}

Your next line:`,
    false,
  );
  const line = text.trim().replace(/^ATHLETE:\s*/i, "");
  return /^DONE\b/i.test(line) ? null : line;
}

// Yes/no rubric questions answered from the whole trial. Each answer comes
// with a reason, so a failure can be checked against the transcript.
export async function judge(
  trial: Trial,
  today: string,
  questions: string[],
  // Earlier conversations the coach had, as [athlete, coach] pairs.
  memory: [string, string][] = [],
) {
  if (!questions.length) return [];
  const raw = await generate(
    `You grade a conversation between an athlete and their weightlifting coach app. Answer each question strictly from the evidence below. A question passes only if the evidence clearly supports "yes". Do not assume anything not shown.

${
  memory.length
    ? `Earlier conversations the coach remembers (real, from before this call): ${JSON.stringify(memory.map(([athlete, coach]) => ({ athlete, coach })))}
`
    : ""
}Journal before the conversation: ${describeDay(dayForCoach(trial.before, today))}
Journal after the conversation: ${describeDay(dayForCoach(trial.after, today))}
Actions the coach took, with what each returned to the coach: ${JSON.stringify(trial.calls.map((c) => ({ name: c.name, ok: c.ok, args: c.args, returned: c.result })))}

Conversation:
${script(trial.transcript)}

Questions:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Reply as JSON: {"answers":[{"question":1,"pass":true,"reason":"short evidence"}]} with one answer per question, in order.`,
    true,
  );
  const answers: { pass?: boolean; reason?: string }[] =
    JSON.parse(raw).answers ?? [];
  return questions.map((q, i): Check => ({
    name: q,
    kind: "judge",
    pass: answers[i]?.pass === true,
    ...(answers[i]?.pass === true
      ? {}
      : { detail: answers[i]?.reason ?? "no answer" }),
  }));
}
