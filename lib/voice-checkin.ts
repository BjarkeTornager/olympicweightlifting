import type { JournalState, Workout } from "./model";
import { EXERCISES } from "./domain";
import { cardioActivities } from "./cardio";
import { foodGroups } from "./nutrition";
import { nextTraining } from "./next-training";
import { formatSleepDuration } from "./health";
import { localClock } from "./agent/time-context";

// Spoken daily check-in over the Gemini Live API. The phone talks to Google
// directly with a single-use token; the API key, instructions and tools are
// fixed here on the server. Saving goes through Coach, never through Gemini.
export const VOICE_MODEL =
  process.env.VOICE_MODEL || "gemini-3.8-live-extended-thinking";
// A prebuilt Gemini voice chosen to sound like a coach at the platform.
export const VOICE_NAME = process.env.VOICE_NAME || "Orus";
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
  return `You are the athlete's Olympic weightlifting coach doing a short spoken end-of-day check-in${name ? ` with ${name}` : ""}. Sound like a real coach at the platform: warm, confident, direct and energetic, with short natural sentences, genuine encouragement for good work and calm matter-of-factness about misses. The point is that the athlete does not have to remember or type anything: you ask, they answer, and you get it recorded.

It is ${clock.time} on ${clock.date} (${clock.timezone}).
Already recorded for ${context.date}:
- Food: ${context.food}
- Sleep last night: ${context.sleep}
- Training: ${context.training}
${context.unfinishedWorkout ? `- An unfinished workout is open: ${context.unfinishedWorkout}. It does not stop you logging other training.\n` : ""}${context.nextPlanned ? `- Next planned session in the programme: ${context.nextPlanned}\n` : ""}
How to run the check-in:
- Open with one short, friendly line and your first question. Ask only about what is not recorded yet, one topic at a time: training, then food, then last night's sleep. Skip anything already recorded unless the athlete brings it up.
- Keep every reply to one or two short sentences. This is a spoken conversation, not a report. No lectures, no nutrition advice unless asked.
- Training: ask what they did. For lifts, get exercise, weight in kg, reps, number of sets, and which attempts were missed. Top sets are enough; do not demand warm-ups. A rest day is a perfectly good answer.
- Food: ask what they ate and roughly how much. Plain descriptions are fine; do not ask for calories or grams.
- Sleep: hours slept last night, optionally how rested they feel.
- If a number is unclear or sounds implausible, ask once. Otherwise briefly repeat numbers back as you move on ("72 made, 75 missed twice, got it").
- Before saving, make sure the details add up. If the numbers don't match (for example five sets but only four weights) or reps are missing, ask one short question. Never save a guess. Never add sets, foods or amounts they did not say.
- As soon as one topic is complete, save it with the matching tool: log_training, log_meal, log_sleep or log_activity. Dates are explicit (today is ${context.date}; "last night" sleep belongs to today). Saves take about a second; wait for the result, then confirm in a few words and move on.
- log_training: one call per workout with every exercise and set. finished is true unless the athlete says they are still training.
- log_meal: estimate calories, protein, carbs and fat yourself from the foods and portions; never ask the athlete for numbers.
- You can fix things yourself, but never change anything the athlete didn't ask about without saying so. Leave an old unfinished workout alone unless the athlete asks or a save is refused because of it; then tell them in one sentence and call clear_unfinished_workout (it saves any logged sets to history, or removes an empty draft), and save again. If the athlete corrects something you just saved, call undo_save with its save_id and save the corrected version. Never send the athlete to another screen to fix it.
- If a save is refused for another reason, say briefly why in plain words and what you will do, then try once more with the fix.
- Camera: if the athlete wants to show you their food, call open_camera, tell them to point it at the plate and tap the shutter or say "take it" (then call take_photo). When the photo arrives, name what you see with rough portions, ask for a quick yes or correction, then log_meal with that photo's id in photo_ids.
- When everything is covered, say a short goodbye and call end_check_in. Also call it if the athlete says they are done.
- Speak the athlete's language; default to English.`;
}

const text = (description?: string) => ({ type: "STRING", description });
const number = (description?: string) => ({ type: "NUMBER", description });
const summaryField = text(
  "One short sentence of what the athlete reported, in their words, shown in their journal.",
);
const dateField = text("YYYY-MM-DD");

export function voiceTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "log_training",
          description:
            "Save one workout the athlete reported: every exercise with its sets. Continues a workout already recorded for that date.",
          parameters: {
            type: "OBJECT",
            properties: {
              summary: summaryField,
              date: dateField,
              title: text("Short workout name, e.g. 'Clean & jerk'"),
              finished: {
                type: "BOOLEAN",
                description: "False only if the athlete is still training.",
              },
              exercises: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    exercise: text(
                      `Catalogue id: ${EXERCISES.map((e) => e.id).join(", ")}. For anything else use custom:Name.`,
                    ),
                    sets: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          weight_kg: number(),
                          reps: { type: "INTEGER" },
                          made: {
                            type: "BOOLEAN",
                            description: "False for a missed lift.",
                          },
                        },
                        required: ["weight_kg", "reps", "made"],
                      },
                    },
                  },
                  required: ["exercise", "sets"],
                },
              },
            },
            required: ["summary", "date", "title", "exercises"],
          },
        },
        {
          name: "log_meal",
          description:
            "Save one meal with your own estimate of calories and macros per item.",
          parameters: {
            type: "OBJECT",
            properties: {
              summary: summaryField,
              date: dateField,
              meal_type: {
                type: "STRING",
                enum: ["breakfast", "lunch", "dinner", "snack"],
              },
              name: text("Short meal name"),
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    name: text(),
                    portion: text("e.g. '2 slices', '300 g'"),
                    calories: number(),
                    protein_g: number(),
                    carbs_g: number(),
                    fat_g: number(),
                    food_groups: {
                      type: "ARRAY",
                      items: { type: "STRING", enum: Object.keys(foodGroups) },
                    },
                    ingredients: {
                      type: "ARRAY",
                      items: { type: "STRING" },
                      description:
                        "Main ingredients the athlete named or you can see; leave out anything you would be guessing.",
                    },
                  },
                  required: [
                    "name",
                    "portion",
                    "calories",
                    "protein_g",
                    "carbs_g",
                    "fat_g",
                    "food_groups",
                    "ingredients",
                  ],
                },
              },
              photo_ids: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "Ids of photos taken in this call of this meal.",
              },
            },
            required: ["summary", "date", "meal_type", "name", "items"],
          },
        },
        {
          name: "log_sleep",
          description: "Save hours slept, on the date the athlete woke up.",
          parameters: {
            type: "OBJECT",
            properties: {
              summary: summaryField,
              date: dateField,
              hours: number(),
            },
            required: ["summary", "date", "hours"],
          },
        },
        {
          name: "log_activity",
          description: "Save a walk, run, ride or other cardio activity.",
          parameters: {
            type: "OBJECT",
            properties: {
              summary: summaryField,
              date: dateField,
              activity: { type: "STRING", enum: [...cardioActivities] },
              minutes: number(),
              distance_km: number(),
            },
            required: ["summary", "date", "activity", "minutes"],
          },
        },
        {
          name: "clear_unfinished_workout",
          description:
            "Resolve the open unfinished workout: logged sets go to history, an empty draft is removed. Undoable.",
          parameters: {
            type: "OBJECT",
            properties: { summary: summaryField },
            required: ["summary"],
          },
        },
        {
          name: "undo_save",
          description:
            "Undo one save from this call, by the save_id it returned.",
          parameters: {
            type: "OBJECT",
            properties: { save_id: text() },
            required: ["save_id"],
          },
        },
        {
          name: "open_camera",
          description:
            "Open the phone camera so the athlete can show you their food.",
        },
        {
          name: "take_photo",
          description:
            "Take the photo when the athlete says so. Returns its id; the image follows.",
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
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
      },
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
