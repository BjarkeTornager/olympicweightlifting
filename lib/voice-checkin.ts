import type { JournalState, Workout } from "./model";
import { nextTraining } from "./next-training";
import { formatSleepDuration } from "./health";
import { localClock } from "./agent/time-context";

// Spoken daily check-in over the Gemini Live API. The phone talks to Google
// directly with a single-use token; the API key, instructions and tools are
// fixed here on the server. Saving goes through Coach, never through Gemini.
export const VOICE_MODEL =
  process.env.VOICE_MODEL || "gemini-3.8-live-extended-thinking";
export const VOICE_SESSION_MINUTES = 10;
export const VOICE_SOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export function voiceConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

const loggedSets = (w: Workout) =>
  w.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.logged || s.result).length,
    0,
  );

// What is already recorded for the athlete's local date, so the voice coach
// asks only about what is missing. Absent records stay unknown, never zero.
export function voiceContext(state: JournalState, date: string) {
  const meals = state.nutrition.meals
    .filter((m) => m.date === date)
    .map((m) => `${m.type}: ${m.name}`);
  const checkin = state.health.checkins.find((c) => c.date === date);
  const sessions = state.sessions
    .filter((s) => s.date === date)
    .map((s) => `${s.title} (${loggedSets(s)} sets logged)`);
  const cardio = state.cardio.sessions
    .filter((c) => c.date === date)
    .map((c) => c.title || c.activity);
  const active = state.activeWorkout;
  const next = nextTraining(state, date);
  return {
    date,
    food: state.nutrition.completeDays?.includes(date)
      ? "Day marked complete"
      : meals.length
        ? meals.join("; ")
        : "Nothing recorded",
    sleep:
      checkin?.sleepHours != null
        ? formatSleepDuration(checkin.sleepHours)
        : "Not recorded",
    training: [...sessions, ...cardio].join("; ") || "Nothing recorded",
    unfinishedWorkout: active
      ? `${active.title}, started ${active.date}, ${loggedSets(active)} sets logged`
      : null,
    nextPlanned: next.canStart ? next.title : null,
  };
}

export function voiceInstruction(
  context: ReturnType<typeof voiceContext>,
  clock: ReturnType<typeof localClock>,
  name?: string,
) {
  return `You are the athlete's weightlifting coach doing a short spoken end-of-day check-in${name ? ` with ${name}` : ""}. The point is that the athlete does not have to remember or type anything: you ask, they answer, and you get it recorded.

It is ${clock.time} on ${clock.date} (${clock.timezone}).
Already recorded for ${context.date}:
- Food: ${context.food}
- Sleep last night: ${context.sleep}
- Training: ${context.training}
${context.unfinishedWorkout ? `- An unfinished workout is open: ${context.unfinishedWorkout}\n` : ""}${context.nextPlanned ? `- Next planned session in the programme: ${context.nextPlanned}\n` : ""}
How to run the check-in:
- Open with one short, friendly line and your first question. Ask only about what is not recorded yet, one topic at a time: training, then food, then last night's sleep. Skip anything already recorded unless the athlete brings it up.
- Keep every reply to one or two short sentences. This is a spoken conversation, not a report. No lectures, no nutrition advice unless asked.
- Training: ask what they did. For lifts, get exercise, weight in kg, reps, number of sets, and which attempts were missed. Top sets are enough; do not demand warm-ups. A rest day is a perfectly good answer.
- Food: ask what they ate and roughly how much. Plain descriptions are fine; do not ask for calories or grams.
- Sleep: hours slept last night, optionally how rested they feel.
- If a number is unclear or sounds implausible, ask once. Otherwise briefly repeat numbers back as you move on ("72 made, 75 missed twice, got it").
- As soon as one topic is complete, call save_to_journal with a plain factual report of exactly what the athlete said for that topic, then continue the conversation while it saves. Never add sets, foods or amounts they did not say. Write the report in English, with dates relative to ${context.date} made explicit.
- If saving fails, tell the athlete briefly that it is kept in Coach to retry, and carry on.
- When everything is covered, say a short goodbye and call end_check_in. Also call it if the athlete says they are done.
- Speak the athlete's language; default to English.`;
}

export function voiceTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "save_to_journal",
          description:
            "Record what the athlete reported for one topic (training, food or sleep). Coach saves it to the journal with Undo.",
          behavior: "NON_BLOCKING",
          parameters: {
            type: "OBJECT",
            properties: {
              topic: {
                type: "STRING",
                enum: ["training", "food", "sleep", "other"],
              },
              report: {
                type: "STRING",
                description:
                  "Factual summary of what the athlete said, e.g. 'Trained today (2026-09-25): snatch 72 kg x 2 made, 75 kg x 2 missed twice; back squat 110 kg 3 sets of 5.'",
              },
            },
            required: ["topic", "report"],
          },
        },
        {
          name: "end_check_in",
          description:
            "End the call after saying goodbye, or when the athlete says they are done.",
        },
      ],
    },
  ];
}

export function voiceSetup(instruction: string) {
  return {
    model: `models/${VOICE_MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      // Extended thinking requires a level; low keeps spoken replies prompt.
      // The standard Live model rejects the setting.
      ...(VOICE_MODEL.includes("extended-thinking")
        ? { thinkingConfig: { thinkingLevel: "low" } }
        : {}),
    },
    systemInstruction: { parts: [{ text: instruction }] },
    tools: voiceTools(),
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

// A single-use token that can only open this model with this configuration.
// The browser never sees the API key.
export async function mintVoiceToken(
  setup: ReturnType<typeof voiceSetup>,
  fetcher: typeof fetch = fetch,
) {
  const now = Date.now();
  const response = await fetcher(
    "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + VOICE_SESSION_MINUTES * 60000).toISOString(),
        newSessionExpireTime: new Date(now + 60000).toISOString(),
        // With no field mask, this whole setup overrides what the phone sends.
        bidiGenerateContentSetup: setup,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw Error(`Voice token request failed: ${response.status}`);
  const { name } = (await response.json()) as { name?: string };
  if (!name) throw Error("Voice token response had no token.");
  return name;
}
