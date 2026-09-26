import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, days, emptyJournal } from "../lib/domain";
import { localClock } from "../lib/agent/time-context";
import { mealSchema } from "../lib/nutrition";
import {
  mintVoiceToken,
  voiceContext,
  voiceInstruction,
  voiceSetup,
} from "../lib/voice-checkin";
import {
  appendLine,
  base64ToFloat32,
  liveEvents,
  pcmToBase64,
} from "../lib/voice-live";

const meal = (date: string, name: string, type: "breakfast" | "dinner") =>
  mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    date,
    name,
    type,
    items: [
      {
        name,
        calories: 300,
        protein: 10,
        carbs: 40,
        fat: 8,
        portion: "1 bowl",
      },
    ],
    source: "text",
    estimated: true,
  });

test("voice context reports only today's records and keeps missing ones unknown", () => {
  const s = emptyJournal();
  let context = voiceContext(s, "2026-09-25");
  assert.equal(context.food, "Nothing recorded");
  assert.equal(context.sleep, "Not recorded");
  assert.equal(context.training, "Nothing recorded");
  assert.equal(context.unfinishedWorkout, null);

  s.nutrition.meals.push(
    meal("2026-09-25", "Oats", "breakfast"),
    meal("2026-09-24", "Yesterday's pizza", "dinner"),
  );
  s.health.checkins.push({
    date: "2026-09-25",
    sleepHours: 7.5,
    energy: null,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "",
    updatedAt: new Date().toISOString(),
  });
  const stale = createWorkout(s, days[0], "2026-09-20");
  stale.exercises[0].sets[0] = {
    ...stale.exercises[0].sets[0],
    weight: 60,
    reps: 2,
    logged: true,
    result: "success",
  };
  s.activeWorkout = stale;
  context = voiceContext(s, "2026-09-25");
  assert.equal(context.food, "breakfast: Oats");
  assert.equal(context.sleep, "7 h 30 min");
  assert.match(context.unfinishedWorkout!, /started 2026-09-20, 1 sets logged/);

  s.nutrition.completeDays = ["2026-09-25"];
  assert.equal(voiceContext(s, "2026-09-25").food, "Day marked complete");
});

test("voice instructions carry the date, the records and the save rules", () => {
  const s = emptyJournal();
  const clock = localClock("2026-09-25T19:30:00Z", "Europe/Copenhagen");
  const text = voiceInstruction(voiceContext(s, clock.date), clock, "Bjarke");
  assert.match(text, /21:30 on 2026-09-25 \(Europe\/Copenhagen\)/);
  assert.match(text, /with Bjarke/);
  assert.match(text, /Food: Nothing recorded/);
  assert.match(text, /Never add sets, foods or amounts they did not say/);
  // The whole day is in context from the start.
  assert.match(text, /Everything recorded for 2026-09-25 so far, in full/);
  assert.match(text, /"eatenSoFar":\{"calories":0/);
  assert.match(text, /Never end the call while you are checking something/);
  const setup = voiceSetup(text);
  assert.equal(setup.model, "models/gemini-3.8-live-extended-thinking");
  const names = setup.tools[0].functionDeclarations.map((f) => f.name);
  assert.deepEqual(names, [
    "log_training",
    "log_meal",
    "update_meal",
    "delete_meal",
    "update_training",
    "recall_conversations",
    "read_journal",
    "list_photos",
    "view_photo",
    "log_sleep",
    "log_activity",
    "set_goals",
    "clear_unfinished_workout",
    "undo_save",
    "open_camera",
    "take_photo",
    "end_check_in",
  ]);
  // Long calls continue across connections instead of ending.
  assert.deepEqual(setup.contextWindowCompression, { slidingWindow: {} });
  assert.deepEqual(setup.sessionResumption, {});
  assert.deepEqual(voiceSetup(text, "handle-1").sessionResumption, {
    handle: "handle-1",
  });
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
});

test("voice tokens are single use, short lived and lock the configuration", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let sent: { url: string; init: RequestInit } | null = null;
  const setup = voiceSetup("Instructions");
  const token = await mintVoiceToken(setup, (async (
    url: string,
    init: RequestInit,
  ) => {
    sent = { url, init };
    return Response.json({ name: "auth_tokens/abc" });
  }) as typeof fetch);
  assert.equal(token, "auth_tokens/abc");
  const request = sent!;
  assert.match(request.url, /\/v1beta\/auth_tokens$/);
  assert.equal(
    (request.init.headers as Record<string, string>)["x-goog-api-key"],
    "test-key",
  );
  const body = JSON.parse(request.init.body as string);
  assert.equal(body.uses, 1);
  assert.ok(Date.parse(body.expireTime) - Date.now() <= 10 * 60000);
  assert.ok(Date.parse(body.newSessionExpireTime) - Date.now() <= 60000);
  assert.equal(body.bidiGenerateContentSetup.model, setup.model);
  assert.equal(
    body.bidiGenerateContentSetup.systemInstruction.parts[0].text,
    "Instructions",
  );

  await assert.rejects(
    mintVoiceToken(
      setup,
      (async () =>
        new Response("no", { status: 403 })) as unknown as typeof fetch,
    ),
    /403/,
  );
});

test("live messages become ordered events", () => {
  assert.deepEqual(liveEvents(JSON.stringify({ setupComplete: {} })), [
    { type: "ready" },
  ]);
  assert.deepEqual(
    liveEvents(
      JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { data: "AAA=" } }] },
          outputTranscription: { text: "Did you train?" },
          turnComplete: true,
        },
      }),
    ),
    [
      { type: "audio", data: "AAA=" },
      { type: "said", text: "Did you train?" },
      { type: "turnComplete" },
    ],
  );
  assert.deepEqual(
    liveEvents(
      JSON.stringify({
        serverContent: {
          interrupted: true,
          inputTranscription: { text: "Yes, snatches" },
        },
      }),
    ),
    [{ type: "interrupted" }, { type: "heard", text: "Yes, snatches" }],
  );
  const call = { id: "1", name: "save_to_journal", args: { report: "x" } };
  assert.deepEqual(
    liveEvents(JSON.stringify({ toolCall: { functionCalls: [call] } })),
    [{ type: "toolCall", calls: [call] }],
  );
  assert.deepEqual(liveEvents(JSON.stringify({ goAway: {} })), [
    { type: "goAway" },
  ]);
});

test("transcript fragments join per speaker until a turn closes", () => {
  let lines = appendLine([], "coach", "Did you ");
  lines = appendLine(lines, "coach", "train?");
  lines = appendLine(lines, "you", " Yes");
  lines = appendLine(lines, "coach", "Nice.");
  lines = appendLine(lines, "coach", "What did you eat?", true);
  assert.deepEqual(lines, [
    { role: "coach", text: "Did you train?" },
    { role: "you", text: "Yes" },
    { role: "coach", text: "Nice." },
    { role: "coach", text: "What did you eat?" },
  ]);
});

test("PCM survives the base64 round trip", () => {
  const pcm = new Int16Array([0, 16384, -16384, 32767, -32768]);
  const samples = base64ToFloat32(pcmToBase64(pcm.buffer));
  assert.deepEqual(
    [...samples].map((v) => Math.round(v * 0x8000)),
    [0, 16384, -16384, 32767, -32768],
  );
});
