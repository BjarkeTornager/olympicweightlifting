import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, days, emptyJournal } from "../lib/domain";
import { localClock } from "../lib/agent/time-context";
import { mealSchema } from "../lib/nutrition";
import { addDrink } from "../lib/hydration";
import {
  mintVoiceToken,
  voiceClientShowsCards,
  voiceContext,
  voiceInstruction,
  voiceSetup,
} from "../lib/voice-checkin";
import {
  appendLine,
  joinFragment,
  base64ToFloat32,
  isCreditError,
  liveEvents,
  pcmToBase64,
  placeCard,
  promisesAction,
  promisesCard,
  recapLines,
  spokenLines,
  CARD_NUDGE_AFTER_MS,
  NUDGE_AFTER_MS,
  VOICE_CREDIT_MESSAGE,
} from "../lib/voice-live";
import { cardRefusal, cardVisual, voiceToolArgs } from "../lib/voice-actions";

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
  assert.equal(context.sleep, "Not recorded yet");
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
  // No em dashes, said or written, and none in the instructions themselves.
  assert.match(text, /Never use em dashes/);
  assert.ok(!text.includes("—"), "the voice instructions use no em dashes");
  // The whole day is in context from the start.
  assert.match(text, /Everything recorded for 2026-09-25 so far, in full/);
  assert.match(text, /"eatenSoFar":\{"calories":0/);
  assert.match(text, /Never end the call while you are checking something/);
  // Late data is looked up rather than asked for.
  assert.match(text, /Sleep last night: Not recorded yet/);
  assert.match(
    text,
    /If the athlete says you should already know something, call read_journal/,
  );
  assert.doesNotMatch(
    text,
    /sends last night's sleep and workouts from Apple Health/,
  );
  const withHealth = emptyJournal();
  withHealth.health.vitals = [
    {
      date: "2026-09-24",
      restingHeartRate: 52,
      heartRateVariabilityMs: 58,
      averageHeartRate: null,
      steps: null,
      activeEnergyKcal: null,
      source: "apple-health",
      updatedAt: new Date().toISOString(),
    },
  ];
  assert.match(
    voiceInstruction(voiceContext(withHealth, clock.date), clock),
    /before asking about sleep or training that is missing, call read_journal for today once/,
  );
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
    "log_drink",
    "log_supplement",
    "delete_supplement",
    "log_body_fat",
    "delete_drink",
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

test("an app that draws cards gets show_card and is told how to use it; older ones are told they can't", () => {
  const clock = localClock("2026-09-25T17:00:00Z", "Europe/Copenhagen");
  const context = voiceContext(emptyJournal(), clock.date);
  const plain = voiceInstruction(context, clock, "Sam");
  const cards = voiceInstruction(context, clock, "Sam", "checkin", [], {
    cards: true,
  });
  const names = (text: string, showsCards?: boolean) =>
    voiceSetup(text, undefined, {
      cards: showsCards,
    }).tools[0].functionDeclarations.map((f) => f.name);
  // Without cards the tool list is exactly as before (pinned above).
  assert.deepEqual(names(plain), names(plain, false));
  assert.ok(!names(plain).includes("show_card"));
  const withCards = names(cards, true);
  assert.deepEqual(
    withCards.filter((n) => n !== "show_card"),
    names(plain),
  );
  assert.equal(withCards[withCards.indexOf("undo_save") + 1], "show_card");

  assert.match(cards, /you can put things on it with show_card/);
  assert.match(cards, /not a report; longer things go on a card\./);
  assert.match(cards, /don't claim it's there before the tool returns/);
  assert.match(cards, /never read out the ingredients, steps or numbers/);
  assert.match(cards, /Never say you can't show things on screen/);
  assert.doesNotMatch(cards, /You can't put anything on the athlete's screen/);
  assert.match(plain, /You can't put anything on the athlete's screen/);
  // This app's typed Coach may not draw a recipe card either.
  assert.match(plain, /offer to talk them through it step by step/);
  assert.doesNotMatch(plain, /typed Coach/);
  assert.doesNotMatch(plain, /show_card|on a card/);
  for (const text of [plain, cards])
    assert.ok(!text.includes("—"), "no em dashes in either version");

  // The app's voice version says whether it draws cards.
  const headers = (version?: string) =>
    new Headers(version ? { "X-Voice-Client": version } : {});
  assert.equal(voiceClientShowsCards(headers()), false);
  assert.equal(voiceClientShowsCards(headers("3")), false);
  assert.equal(voiceClientShowsCards(headers("4")), true);
  assert.equal(voiceClientShowsCards(headers("5")), true);
});

test("show_card's declaration lists every card kind and the recipe's parts", () => {
  const card = voiceSetup("Instructions", undefined, {
    cards: true,
  }).tools[0].functionDeclarations.find((f) => f.name === "show_card")!;
  assert.ok("parameters" in card);
  const parameters = card.parameters as {
    properties: Record<string, { type: string; enum?: readonly string[] }>;
    required: string[];
  };
  assert.deepEqual(
    [...parameters.properties.kind.enum!],
    ["recipe", "table", "bar_chart", "line_chart", "progress", "stats"],
  );
  assert.deepEqual(parameters.required, ["summary", "kind", "title"]);
  assert.equal(parameters.properties.servings.type, "INTEGER");
  assert.equal(parameters.properties.ingredients.type, "ARRAY");
  // A picture can be asked for only while pictures are switched on.
  assert.ok(!("picture" in parameters.properties));
  const tools = voiceSetup("Instructions", undefined, {
    cards: true,
    pictures: true,
  }).tools[0].functionDeclarations;
  const names = tools.map((f) => f.name);
  assert.equal(names[names.indexOf("show_card") + 1], "show_picture");
  const drawn = tools.find((f) => f.name === "show_card")!;
  assert.ok("parameters" in drawn);
  assert.equal(
    (drawn.parameters as typeof parameters).properties.picture.type,
    "BOOLEAN",
  );
  // Pictures need an app that draws cards.
  assert.ok(
    !voiceSetup("Instructions", undefined, {
      pictures: true,
    }).tools[0].functionDeclarations.some((f) => f.name === "show_picture"),
  );
});

test("the coach offers a picture of the dish only while pictures are on", () => {
  const clock = localClock("2026-09-25T17:00:00Z", "Europe/Copenhagen");
  const context = voiceContext(emptyJournal(), clock.date);
  const instruction = (pictures: boolean) =>
    voiceInstruction(context, clock, "Sam", "checkin", [], {
      cards: true,
      pictures,
    });
  const on = instruction(true),
    off = instruction(false);
  assert.match(on, /set picture to true \(or call show_picture/);
  assert.match(on, /never describe it as if you can see it/);
  assert.match(on, /there's no picture this time/);
  assert.match(on, /Pictures are only of food\./);
  assert.doesNotMatch(off, /show_picture|set picture/);
  assert.match(off, /There are no pictures of dishes in this call/);
  for (const text of [on, off]) {
    assert.match(text, /Never say you can't show things on screen/);
    assert.ok(!text.includes("—"), "no em dashes");
  }
});

test("only what was said is kept as the call's transcript", () => {
  const visual = {
    id: crypto.randomUUID(),
    content: {
      kind: "stats" as const,
      title: "This week",
      stats: [{ label: "Sleep", value: "7.2", unit: "h" }],
    },
  };
  assert.deepEqual(
    spokenLines([
      { role: "coach", text: "I'll put it on your screen." },
      { role: "card", id: "c1", visual },
      { role: "save", id: "s1", label: "Meal", state: "saved" },
      { role: "you", text: "Thanks" },
    ]),
    [
      { role: "coach", text: "I'll put it on your screen." },
      { role: "you", text: "Thanks" },
    ],
  );
});

test("a picture added to a card on screen updates that card where it is", () => {
  const recipe = (pictureId?: string) => ({
    id: "8e2a7c1d-4b5f-4e60-9a7b-1c2d3e4f5a6b",
    content: {
      kind: "recipe" as const,
      title: "Salmon rice bowl",
      servings: 2,
      ingredients: [{ item: "Salmon fillet", amount: "250 g" }],
      ...(pictureId ? { pictureId } : {}),
    },
  });
  const said = { role: "coach" as const, text: "A picture's on its way." };
  const shown = placeCard([{ role: "you", text: "A dinner idea?" }], {
    role: "card",
    id: "card-1",
    visual: recipe(),
  });
  const drawn = placeCard([...shown, said], {
    role: "card",
    id: "card-1",
    visual: recipe("5a0c9e1d-7b3f-4e62-8d14-2f6a9c3b7e58"),
  });
  assert.deepEqual(
    drawn.map((e) => e.role),
    ["you", "card", "coach"],
  );
  const [, card] = drawn;
  assert.ok(card.role === "card" && card.visual.content.kind === "recipe");
  assert.equal(
    card.visual.content.pictureId,
    "5a0c9e1d-7b3f-4e62-8d14-2f6a9c3b7e58",
  );
  // Another card is its own entry.
  assert.equal(
    placeCard(drawn, { role: "card", id: "card-2", visual: recipe() }).length,
    4,
  );
});

test("a promised card followed by silence is noticed", () => {
  assert.ok(
    promisesAction("Sure, a quick salmon bowl. I'll put it on your screen."),
  );
  assert.ok(promisesAction("Let me show you the week."));
  assert.ok(promisesAction("I'll draw that up."));
  assert.ok(promisesAction("Let me check your sleep."));
  assert.ok(
    !promisesAction("I'll put it on your screen. About twenty minutes."),
  );
  // A card takes longer to write than a save, so the nudge waits longer.
  assert.ok(promisesCard("Sure. I'll put it on your screen."));
  assert.ok(promisesCard("Let me show you the week."));
  assert.ok(!promisesCard("Let me check your sleep."));
  assert.ok(CARD_NUDGE_AFTER_MS > NUDGE_AFTER_MS);
});

test("an offer waits for the athlete's answer and is never nudged", () => {
  for (const offer of [
    "Here it is. Let me know if you'd like me to draw it.",
    "Let me know if you want me to show you a picture.",
    "I'll put a picture on it if you want.",
    "If you'd like, I'll draw it for you.",
    "Would you like me to show you the week?",
  ]) {
    assert.ok(!promisesAction(offer), offer);
    assert.ok(!promisesCard(offer), offer);
  }
  // Checking whether the athlete did something is still a promise.
  assert.ok(promisesAction("Let me check if you logged your sleep."));
});

test("a call that starts afresh after a drop hears the cards on screen, with their ids", () => {
  const visual = {
    id: crypto.randomUUID(),
    content: {
      kind: "recipe" as const,
      title: "Salmon rice bowl",
      servings: 2,
      ingredients: [{ item: "Salmon fillet", amount: "250 g" }],
    },
  };
  const card = crypto.randomUUID();
  assert.equal(
    recapLines([
      { role: "you", text: "What should I cook?" },
      { role: "coach", text: "A salmon rice bowl." },
      { role: "card", id: card, visual },
      { role: "save", id: "s1", label: "Meal", state: "saved" },
      { role: "you", text: "What does it look like?" },
    ]),
    [
      "Athlete: What should I cook?",
      "Coach: A salmon rice bowl.",
      `(Card on screen: Salmon rice bowl, recipe, card_id ${card})`,
      "Athlete: What does it look like?",
    ].join("\n"),
  );
});

test("show_card's flat arguments become the visuals typed Coach draws", () => {
  const card = (args: Record<string, unknown>) =>
    cardVisual(voiceToolArgs.show_card.parse({ summary: "Show me", ...args }));
  // Blanks a model sends for fields it leaves out are dropped; a recipe
  // without servings is for one, and macros become estimated nutrition.
  assert.deepEqual(
    card({
      kind: "recipe",
      title: "Salmon rice bowl",
      caption: "",
      minutes: 0,
      ingredients: [
        { item: "Salmon fillet", amount: "250 g" },
        { item: "Sesame seeds", amount: "" },
      ],
      steps: ["Cook the rice.", "Pan-fry the salmon."],
      kcal: 620,
      protein_g: 42,
      carbs_g: null,
      // Fields of other kinds are ignored.
      columns: ["Day"],
    }),
    {
      title: "Salmon rice bowl",
      kind: "recipe",
      servings: 1,
      ingredients: [
        { item: "Salmon fillet", amount: "250 g" },
        { item: "Sesame seeds" },
      ],
      steps: ["Cook the rice.", "Pan-fry the salmon."],
      nutrition: { kcal: 620, protein: 42 },
    },
  );
  // A quick meal idea has no method and no macros.
  assert.deepEqual(
    card({
      kind: "recipe",
      title: "Skyr bowl",
      servings: 2,
      ingredients: [{ item: "Skyr", amount: "400 g" }],
    }),
    {
      title: "Skyr bowl",
      kind: "recipe",
      servings: 2,
      ingredients: [{ item: "Skyr", amount: "400 g" }],
    },
  );
  // Table rows are objects of cells, so ElevenLabs' schema can take them;
  // numbers said as numbers are still text in a cell.
  assert.deepEqual(
    card({
      kind: "table",
      title: "Two dinners",
      columns: ["Dish", "Protein"],
      rows: [{ cells: ["Salmon bowl", 42] }, { cells: ["Chili", "38"] }],
    }),
    {
      title: "Two dinners",
      kind: "table",
      columns: ["Dish", "Protein"],
      rows: [
        ["Salmon bowl", "42"],
        ["Chili", "38"],
      ],
    },
  );
  // A line chart is one series named after its title.
  assert.deepEqual(
    card({
      kind: "line_chart",
      title: "Sleep this week",
      unit: "h",
      points: [
        { label: "Mon", value: 7.2 },
        { label: "Tue", value: 6.8 },
      ],
      target: 8,
    }),
    {
      title: "Sleep this week",
      kind: "line_chart",
      unit: "h",
      series: [
        {
          name: "Sleep this week",
          points: [
            { label: "Mon", value: 7.2 },
            { label: "Tue", value: 6.8 },
          ],
        },
      ],
      target: 8,
    },
  );
  // The kind's own fields are required by the same strict check.
  assert.throws(
    () => card({ kind: "recipe", title: "Nothing in it" }),
    /ingredients/,
  );
  assert.throws(
    () =>
      card({
        kind: "recipe",
        title: "Too many",
        ingredients: Array.from({ length: 21 }, (_, i) => ({ item: `${i}` })),
      }),
    /ingredients/,
  );
  assert.throws(() =>
    card({
      kind: "line_chart",
      title: "One day",
      points: [{ label: "Mon", value: 7 }],
    }),
  );
  assert.throws(() => card({ kind: "calendar", title: "Not for voice" }));

  // An app older than voice version 4 is told to say it instead.
  const app = (version: string) => new Headers({ "X-Voice-Client": version });
  assert.match(
    cardRefusal("show_card", app("3"))!,
    /can't show cards; give the gist in words/,
  );
  assert.equal(cardRefusal("show_card", app("4")), undefined);
  assert.match(cardRefusal("show_picture", app("3"))!, /can't show cards/);
  assert.equal(cardRefusal("show_picture", app("4")), undefined);
  assert.equal(cardRefusal("log_meal", app("3")), undefined);
});

test("the coach asks only about missing topics and keeps to English", () => {
  const s = emptyJournal();
  const clock = localClock("2026-09-25T12:00:00Z", "Europe/Copenhagen");
  assert.deepEqual(voiceContext(s, clock.date).missing, [
    "training",
    "food",
    "last night's sleep",
    "drinks today",
  ]);
  s.nutrition.meals.push(meal("2026-09-25", "Oats", "breakfast"));
  s.health.checkins.push({
    date: "2026-09-25",
    sleepHours: 7,
    energy: null,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "",
    updatedAt: new Date().toISOString(),
  });
  assert.deepEqual(voiceContext(s, clock.date).missing, [
    "training",
    "drinks today",
  ]);
  const w = createWorkout(s, days[0], "2026-09-25");
  w.exercises[0].sets[0] = {
    ...w.exercises[0].sets[0],
    weight: 60,
    reps: 2,
    logged: true,
    result: "success",
  };
  s.sessions.push(w);
  addDrink(s, { date: "2026-09-25", ml: 500, kind: "water" });
  const context = voiceContext(s, clock.date);
  assert.deepEqual(context.missing, []);
  const text = voiceInstruction(context, clock);
  assert.match(text, /Topics still missing today: none/);
  assert.match(text, /do not ask about training, food or sleep/);
  // Only exercises actually done appear in the day.
  assert.ok(context.day.workouts[0].exercises.every((e) => e.sets.length));
  assert.match(text, /1\. Speak English only, in every reply/);
  // Acknowledged straight away, saved while speaking, never claimed early.
  assert.match(text, /Don't make the athlete wait in silence for a save/);
  assert.match(
    text,
    /Never claim it is saved, logged or recorded before the tool has returned success/,
  );
  assert.match(text, /Never announce a check or save and then go quiet/);
  assert.match(text, /Short answers like "not yet"/);
  assert.equal(
    voiceSetup(text).generationConfig.speechConfig.languageCode,
    "en-US",
  );
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
  // Out of prepaid credit: a clear message, and no pointless retries.
  await assert.rejects(
    mintVoiceToken(
      setup,
      (async () =>
        new Response("{}", { status: 402 })) as unknown as typeof fetch,
    ),
    (e: Error) =>
      e.message === VOICE_CREDIT_MESSAGE && isCreditError(e.message),
  );
  assert.ok(
    isCreditError(
      "Your prepayment credits are depleted. Please go to AI Studio",
    ),
  );
  assert.ok(!isCreditError("The voice connection closed."));
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
  lines = appendLine(lines, "you", " ");
  lines = appendLine(lines, "coach", "Nice.");
  lines = appendLine(lines, "coach", "What did you eat?", true);
  assert.deepEqual(lines, [
    { role: "coach", text: "Did you train?" },
    { role: "you", text: "Yes " },
    { role: "coach", text: "Nice." },
    { role: "coach", text: "What did you eat?" },
  ]);
  // A word without its space gets one; a reply split mid-sentence stays one line.
  lines = appendLine([], "coach", "Let's review your sleep for");
  lines = appendLine(lines, "coach", "last night. You slept 7");
  lines = appendLine(lines, "coach", ".5 hours and", true);
  lines = appendLine(lines, "coach", "feel rested?", true);
  assert.deepEqual(lines, [
    {
      role: "coach",
      text: "Let's review your sleep for last night. You slept 7.5 hours and feel rested?",
    },
  ]);
  // Noise that transcribes as nothing adds no line.
  assert.deepEqual(appendLine([], "you", "  "), []);
});

test("fragments get a space between words, but not inside numbers", () => {
  assert.equal(joinFragment("hours", "and"), "hours and");
  assert.equal(joinFragment("done.", "Next"), "done. Next");
  assert.equal(joinFragment("Did you ", "train?"), "Did you train?");
  assert.equal(joinFragment("7", ".5"), "7.5");
  assert.equal(joinFragment("7.", "5"), "7.5");
  assert.equal(joinFragment("1,", "500 ml"), "1,500 ml");
  assert.equal(joinFragment("great", "!"), "great!");
  assert.equal(joinFragment("", "Hi"), "Hi");
});

test("PCM survives the base64 round trip", () => {
  const pcm = new Int16Array([0, 16384, -16384, 32767, -32768]);
  const samples = base64ToFloat32(pcmToBase64(pcm.buffer));
  assert.deepEqual(
    [...samples].map((v) => Math.round(v * 0x8000)),
    [0, 16384, -16384, 32767, -32768],
  );
});

test("background noise does not interrupt the coach, but speaking does", async () => {
  const { createBargeInGate } = await import("../lib/voice-live");
  const chunk = (amplitude: number) =>
    Int16Array.from({ length: 1600 }, (_, i) =>
      Math.round(amplitude * 32767 * Math.sin(i / 3)),
    );
  const silent = (out: Int16Array[]) =>
    out.length === 1 && out[0].every((x) => x === 0);
  const gate = createBargeInGate();
  // A quiet room while the coach is silent passes straight through.
  for (let i = 0; i < 30; i++)
    assert.deepEqual(gate(chunk(0.01), false), [chunk(0.01)]);
  // While the coach speaks, steady background noise is silenced.
  for (let i = 0; i < 10; i++) assert.ok(silent(gate(chunk(0.015), true)));
  // A short clang (two chunks) is silenced too.
  assert.ok(silent(gate(chunk(0.5), true)));
  assert.ok(silent(gate(chunk(0.5), true)));
  assert.ok(silent(gate(chunk(0.01), true)));
  // Sustained speech opens the gate and keeps its beginning.
  assert.ok(silent(gate(chunk(0.2), true)));
  assert.ok(silent(gate(chunk(0.2), true)));
  const opened = gate(chunk(0.2), true);
  assert.equal(opened.length, 3);
  assert.ok(opened.every((c) => c.some((x) => x !== 0)));
  // The coach's own voice echoing back is not the athlete, even when
  // sustained; the athlete must be clearly louder than the playback.
  const echoGate = createBargeInGate();
  for (let i = 0; i < 10; i++)
    assert.ok(silent(echoGate(chunk(0.08), true, 0.2)));
  assert.ok(silent(echoGate(chunk(0.5), true, 0.2)));
  assert.ok(silent(echoGate(chunk(0.5), true, 0.2)));
  assert.equal(echoGate(chunk(0.5), true, 0.2).length, 3);
  // Once open, everything passes until the coach stops.
  assert.deepEqual(gate(chunk(0.01), true), [chunk(0.01)]);
  assert.deepEqual(gate(chunk(0.01), false), [chunk(0.01)]);
});
