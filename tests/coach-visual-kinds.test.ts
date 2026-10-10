import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDays,
  recipeMeta,
  savedVisualSchema,
  visualSchema,
  visualToolSchema,
  type SavedVisual,
} from "../lib/coach-visuals";
import { buildCoach, flattenVisual } from "../lib/native-api";

const examples = {
  line_chart: {
    kind: "line_chart",
    title: "Bodyweight, last 14 days",
    unit: "kg",
    series: [
      {
        name: "Bodyweight",
        points: [
          { label: "Sep 15", value: 88.6 },
          { label: "Sep 22", value: 88.1 },
          { label: "Sep 28", value: 87.7 },
        ],
      },
    ],
    target: 85,
  },
  progress: {
    kind: "progress",
    title: "Today so far",
    targets: [
      { label: "Protein", value: 116, target: 180, unit: "g" },
      { label: "Water", value: 1.5, target: 3, unit: "L" },
    ],
  },
  stats: {
    kind: "stats",
    title: "This week",
    stats: [
      { label: "Sessions", value: "4" },
      { label: "Sleep", value: "7 h 24", change: "+18 min", trend: "up" },
    ],
  },
  comparison: {
    kind: "comparison",
    title: "This week against last",
    beforeLabel: "Last week",
    afterLabel: "This week",
    comparisons: [
      {
        label: "Sleep",
        before: 7.1,
        after: 7.4,
        unit: "h",
        higherIsBetter: true,
      },
      {
        label: "Body fat",
        before: 16.5,
        after: 16.2,
        unit: "%",
        higherIsBetter: false,
      },
    ],
  },
  split: {
    kind: "split",
    title: "Today's calories",
    unit: "kcal",
    parts: [
      { label: "Protein", value: 464 },
      { label: "Carbs", value: 604 },
      { label: "Fat", value: 405 },
    ],
  },
  calendar: {
    kind: "calendar",
    title: "Training days in September",
    days: [
      { date: "2026-09-21", level: 3, label: "Snatch + squat" },
      { date: "2026-09-22", level: 0 },
      { date: "2026-09-23", level: 1, label: "Walk" },
    ],
    legend: "Darker is more training",
  },
  recipe: {
    kind: "recipe",
    title: "Salmon rice bowl",
    caption: "Fits today's protein target.",
    servings: 2,
    minutes: 25,
    ingredients: [
      { item: "Salmon fillet", amount: "250 g" },
      { item: "Jasmine rice", amount: "150 g" },
      { item: "Sesame seeds" },
    ],
    steps: ["Cook the rice.", "Roast the salmon for 12 to 15 minutes."],
    nutrition: { kcal: 625, protein: 37 },
  },
};

test("the new visual kinds validate, also through Coach's flat tool schema", () => {
  for (const [kind, visual] of Object.entries(examples)) {
    assert.equal(visualSchema.parse(visual).kind, kind);
    // The model calls show_visual with the flat schema first.
    assert.deepEqual(
      visualSchema.parse(visualToolSchema.parse(visual)),
      visualSchema.parse(visual),
      kind,
    );
  }
});

test("new visuals refuse fields of another kind and impossible data", () => {
  const bad = [
    { ...examples.progress, points: [{ label: "x", value: 1 }] },
    {
      ...examples.progress,
      targets: [{ label: "Protein", value: 10, target: 0, unit: "g" }],
    },
    {
      ...examples.split,
      parts: [
        { label: "A", value: 0 },
        { label: "B", value: 0 },
      ],
    },
    {
      ...examples.calendar,
      days: [
        { date: "2026-09-21", level: 1 },
        { date: "2026-09-21", level: 2 },
      ],
    },
    { ...examples.calendar, days: [{ date: "2026-09-21", level: 4 }] },
    { ...examples.calendar, days: [{ date: "2026-02-30", level: 1 }] },
    {
      ...examples.calendar,
      days: [
        { date: "2026-08-01", level: 1 },
        { date: "2026-09-28", level: 1 },
      ],
    },
    {
      ...examples.line_chart,
      series: [{ name: "One point", points: [{ label: "a", value: 1 }] }],
    },
    { ...examples.stats, stats: [{ label: "Html", value: "" }] },
  ];
  for (const visual of bad)
    assert.equal(
      visualSchema.safeParse(visual).success,
      false,
      JSON.stringify(visual),
    );
});

test("the app receives the new kinds with the same field names", () => {
  for (const visual of Object.values(examples)) {
    const content = visualSchema.parse(visual);
    assert.deepEqual(flattenVisual({ id: "v", content }), {
      id: "v",
      ...content,
    });
  }
});

test("a recipe card is bounded, strict and fits the app and the website", () => {
  const recipe = examples.recipe;
  const valid = (visual: object) => visualSchema.safeParse(visual).success;
  const long = (n: number) => "x".repeat(n);
  // A quick meal idea needs no steps, time or nutrition.
  assert.ok(
    valid({
      kind: "recipe",
      title: "Skyr with berries",
      servings: 1,
      ingredients: [{ item: "Skyr", amount: "200 g" }],
    }),
  );
  // The largest card there is room for.
  assert.ok(
    valid({
      ...recipe,
      servings: 12,
      minutes: 600,
      ingredients: Array.from({ length: 20 }, () => ({
        item: long(80),
        amount: long(40),
      })),
      steps: Array.from({ length: 12 }, () => long(300)),
      nutrition: { kcal: 5000, protein: 500, carbs: 500, fat: 500 },
      pictureId: crypto.randomUUID(),
    }),
  );
  const bad = [
    { ...recipe, servings: 0 },
    { ...recipe, servings: 13 },
    { ...recipe, servings: 1.5 },
    { ...recipe, minutes: 0 },
    { ...recipe, minutes: 601 },
    { ...recipe, ingredients: [] },
    {
      ...recipe,
      ingredients: Array.from({ length: 21 }, () => ({ item: "Egg" })),
    },
    { ...recipe, ingredients: [{ item: long(81) }] },
    { ...recipe, ingredients: [{ item: "Egg", amount: long(41) }] },
    { ...recipe, ingredients: [{ item: " ", amount: "2" }] },
    { ...recipe, ingredients: [{ item: "Egg", amount: "" }] },
    { ...recipe, ingredients: [{ item: "Egg", note: "free range" }] },
    { ...recipe, steps: Array.from({ length: 13 }, () => "Stir.") },
    { ...recipe, steps: [long(301)] },
    { ...recipe, steps: [""] },
    { ...recipe, nutrition: {} },
    { ...recipe, nutrition: { kcal: 5001 } },
    { ...recipe, nutrition: { protein: 501 } },
    { ...recipe, nutrition: { fat: -1 } },
    { ...recipe, nutrition: { kcal: 600, sugar: 12 } },
    { ...recipe, pictureId: "not-a-uuid" },
    { ...recipe, pictureId: "../api/images/1" },
    // Only the server attaches a picture; there is no picture flag yet.
    { ...recipe, picture: true },
    { ...recipe, imageIds: [crypto.randomUUID()] },
    { ...examples.stats, servings: 2 },
    { ...examples.split, ingredients: recipe.ingredients },
  ];
  for (const visual of bad)
    assert.equal(valid(visual), false, JSON.stringify(visual));
  // An empty nutrition object says why, on the field.
  const empty = visualSchema.safeParse({ ...recipe, nutrition: {} });
  assert.deepEqual(
    !empty.success && empty.error.issues.map((issue) => issue.path),
    [["nutrition"]],
  );
  // Coach's tool can't point a card at a picture; the server sets that.
  assert.equal(
    visualToolSchema.safeParse({ ...recipe, pictureId: crypto.randomUUID() })
      .success,
    false,
  );
  assert.equal(recipeMeta({ servings: 2, minutes: 25 }), "2 servings · 25 min");
  assert.equal(recipeMeta({ servings: 1 }), "1 serving");
  assert.equal(recipeMeta({ servings: 4, minutes: 60 }), "4 servings · 1 h");
  assert.equal(
    recipeMeta({ servings: 4, minutes: 75 }),
    "4 servings · 1 h 15 min",
  );
});

test("calendar days fall on their weekday, with the days Coach left out blank", () => {
  // Training on Wednesday 16 and Friday 18 September: Thursday stays empty.
  const { offset, days } = calendarDays([
    { date: "2026-09-18", level: 3 },
    { date: "2026-09-16", level: 2, label: "Snatch" },
  ]);
  assert.equal(offset, 2);
  assert.deepEqual(days, [
    { date: "2026-09-16", level: 2, label: "Snatch" },
    { date: "2026-09-17" },
    { date: "2026-09-18", level: 3 },
  ]);
  // Six whole weeks, across a month end, is the most there is room for.
  const wide = calendarDays([
    { date: "2026-08-31", level: 1 },
    { date: "2026-10-11", level: 1 },
  ]);
  assert.equal(wide.offset, 0);
  assert.equal(wide.days.length, 42);
  assert.equal(wide.days.at(-1)?.date, "2026-10-11");
  assert.equal(
    visualSchema.safeParse({
      ...examples.calendar,
      days: wide.days.filter((d) => d.level),
    }).success,
    true,
  );
});

test("a progress card a newer version saved still reads, without the fields this version doesn't know", () => {
  // As a newer version might save it: extra fields on a target.
  const saved = {
    id: crypto.randomUUID(),
    content: {
      kind: "progress",
      title: "Today so far",
      targets: [
        {
          label: "Protein",
          value: 80,
          target: 110,
          unit: "g",
          suggested: false,
          hidden: true,
        },
      ],
    },
  };
  const known = [{ label: "Protein", value: 80, target: 110, unit: "g" }];
  const web = savedVisualSchema.parse(saved).content;
  assert.equal(web.kind, "progress");
  assert.deepEqual(web.kind === "progress" && web.targets, known);
  const phone = buildCoach([
    {
      id: crypto.randomUUID(),
      question: "How am I doing?",
      photoIds: [],
      createdAt: new Date().toISOString(),
      status: "done",
      reply: "Protein is on its way.",
      visuals: [saved as unknown as SavedVisual],
    },
  ]);
  assert.deepEqual(phone.turns[0].visuals?.[0].targets, known);
  // Coach's own tool still refuses a field it doesn't know.
  assert.equal(visualToolSchema.safeParse(saved.content).success, false);
});
