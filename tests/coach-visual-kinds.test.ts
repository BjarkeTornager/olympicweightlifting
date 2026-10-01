import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDays,
  visualSchema,
  visualToolSchema,
} from "../lib/coach-visuals";
import { flattenVisual } from "../lib/native-api";

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
