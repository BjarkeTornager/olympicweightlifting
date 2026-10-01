import { z } from "zod";

const label = z.string().trim().min(1).max(120);
const base = {
  title: label,
  caption: z.string().max(400).optional(),
};
const nodeId = z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/);
const unit = z.string().max(30);
const measure = z.number().finite().min(-1000000).max(1000000);
const amount = z.number().finite().min(0).max(1000000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DAY = 86_400_000;
// The parts of each kind, shared by the strict union and the flat tool schema.
const linePoint = z.object({ label, value: measure }).strict();
const lineSeries = z
  .object({ name: label, points: z.array(linePoint).min(2).max(60) })
  .strict();
const targetItem = z
  .object({ label, value: amount, target: amount.gt(0), unit })
  .strict();
const statItem = z
  .object({
    label,
    value: z.string().trim().min(1).max(40),
    unit: unit.optional(),
    change: z.string().trim().max(40).optional(),
    trend: z.enum(["up", "down", "flat"]).optional(),
  })
  .strict();
const comparisonItem = z
  .object({
    label,
    before: measure,
    after: measure,
    unit: unit.optional(),
    // Whether the change is good news: more sleep yes, more body fat no.
    higherIsBetter: z.boolean().optional(),
  })
  .strict();
const splitPart = z.object({ label, value: amount }).strict();
const calendarDay = z
  .object({
    date: day,
    // 0 nothing, 1 a little, 2 a fair amount, 3 a lot.
    level: z.number().int().min(0).max(3),
    label: z.string().max(80).optional(),
  })
  .strict();
const lineFields = {
  unit,
  series: z.array(lineSeries).min(1).max(3),
  target: measure.optional(),
};
const progressFields = { targets: z.array(targetItem).min(1).max(6) };
const statsFields = { stats: z.array(statItem).min(1).max(6) };
const comparisonFields = {
  beforeLabel: label,
  afterLabel: label,
  comparisons: z.array(comparisonItem).min(1).max(10),
};
const splitFields = { unit, parts: z.array(splitPart).min(2).max(6) };
const calendarFields = {
  days: z.array(calendarDay).min(1).max(42),
  legend: z.string().max(120).optional(),
};

export const galleryIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each image once.");

// Display data only: no HTML, scripts, URLs, styles or executable actions.
export const visualSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...base,
        kind: z.literal("table"),
        columns: z.array(label).min(1).max(6),
        rows: z
          .array(z.array(z.string().max(300)).min(1).max(6))
          .min(1)
          .max(30),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("bar_chart"),
        unit: z.string().max(30),
        points: z
          .array(
            z
              .object({
                label,
                value: z.number().min(0).max(1000000),
              })
              .strict(),
          )
          .min(1)
          .max(30),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("diagram"),
        nodes: z
          .array(z.object({ id: nodeId, label }).strict())
          .min(2)
          .max(12),
        edges: z
          .array(
            z
              .object({
                from: nodeId,
                to: nodeId,
                label: z.string().max(80).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(18),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("photo_gallery"),
        imageIds: galleryIdsSchema,
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("route_map"),
        activity: z.enum(["run", "walk", "bike", "other"]),
        distanceKm: z.number().finite().gt(0).max(1000),
        durationSeconds: z.number().int().gt(0).max(604800),
        targetKm: z.number().finite().gt(0).max(80).optional(),
        loop: z.boolean().optional(),
        // The GPS track Apple Health recorded, rather than a suggestion.
        recorded: z.boolean().optional(),
        stops: z
          .array(
            z
              .object({
                lat: z.number().finite().gte(-90).lte(90),
                lng: z.number().finite().gte(-180).lte(180),
                label,
              })
              .strict(),
          )
          .min(2)
          .max(5),
        path: z
          .array(
            z.tuple([
              z.number().finite().gte(-90).lte(90),
              z.number().finite().gte(-180).lte(180),
            ]),
          )
          .min(2)
          .max(200),
      })
      .strict(),
    z
      .object({ ...base, kind: z.literal("line_chart"), ...lineFields })
      .strict(),
    z
      .object({ ...base, kind: z.literal("progress"), ...progressFields })
      .strict(),
    z.object({ ...base, kind: z.literal("stats"), ...statsFields }).strict(),
    z
      .object({ ...base, kind: z.literal("comparison"), ...comparisonFields })
      .strict(),
    z.object({ ...base, kind: z.literal("split"), ...splitFields }).strict(),
    z
      .object({ ...base, kind: z.literal("calendar"), ...calendarFields })
      .strict(),
  ])
  .superRefine((visual, ctx) => {
    if (
      visual.kind === "table" &&
      visual.rows.some((r) => r.length !== visual.columns.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Each row needs one cell per column.",
      });
    if (visual.kind === "split" && !visual.parts.some((part) => part.value > 0))
      ctx.addIssue({
        code: "custom",
        message: "A split needs a part above zero.",
      });
    if (visual.kind === "calendar") {
      const times = visual.days.map((d) => Date.parse(`${d.date}T00:00:00Z`));
      if (new Set(visual.days.map((d) => d.date)).size !== visual.days.length)
        ctx.addIssue({ code: "custom", message: "Give each day once." });
      if (
        times.some(
          (t, i) =>
            Number.isNaN(t) ||
            new Date(t).toISOString().slice(0, 10) !== visual.days[i].date,
        )
      )
        ctx.addIssue({ code: "custom", message: "Use real dates." });
      else if (Math.max(...times) - Math.min(...times) > 41 * DAY)
        ctx.addIssue({
          code: "custom",
          message: "Keep the days within six weeks.",
        });
    }
    if (visual.kind === "diagram") {
      const ids = new Set(visual.nodes.map((n) => n.id));
      if (
        ids.size !== visual.nodes.length ||
        visual.edges.some(
          (e) => !ids.has(e.from) || !ids.has(e.to) || e.from === e.to,
        )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Use unique nodes and connections between existing, different nodes.",
        });
    }
  });
export type CoachVisual = z.infer<typeof visualSchema>;
// The provider-facing schema stays a plain object. Some tool providers reduce
// nested unions to strings. The strict union above remains the final validator.
const [table, chart, diagram] = visualSchema.options;
const optional = <T extends Record<string, z.ZodType>>(fields: T) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, field.optional()]),
  ) as { [K in keyof T]: z.ZodOptional<T[K]> };
export const visualToolSchema = z
  .object({
    ...base,
    kind: z.enum([
      "table",
      "bar_chart",
      "diagram",
      "line_chart",
      "progress",
      "stats",
      "comparison",
      "split",
      "calendar",
    ]),
    columns: table.shape.columns.optional(),
    rows: table.shape.rows.optional(),
    unit: chart.shape.unit.optional(),
    points: chart.shape.points.optional(),
    nodes: diagram.shape.nodes.optional(),
    edges: diagram.shape.edges.optional(),
    ...optional({ series: lineFields.series, target: lineFields.target }),
    ...optional(progressFields),
    ...optional(statsFields),
    ...optional(comparisonFields),
    parts: splitFields.parts.optional(),
    ...optional(calendarFields),
  })
  .strict();
export type SavedVisual = { id: string; content: CoachVisual };
export const savedVisualSchema = z
  .object({ id: z.string().uuid(), content: visualSchema })
  .strict();
export type CoachResponse = {
  reply: string;
  proposals: import("./agent/actions").ActionPreview[];
  visuals?: SavedVisual[];
};

/** Every day from the first given to the last (at most six weeks), each with
 * its level, or none for a day Coach left out. */
export function calendarDays(
  given: Extract<CoachVisual, { kind: "calendar" }>["days"],
) {
  const byDate = new Map(given.map((d) => [d.date, d]));
  const dates = [...byDate.keys()].sort();
  const start = Date.parse(`${dates[0]}T00:00:00Z`),
    end = Date.parse(`${dates.at(-1)}T00:00:00Z`);
  const days: { date: string; level?: number; label?: string }[] = [];
  for (let t = start; t <= end && days.length < 42; t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push({ date, ...byDate.get(date) });
  }
  // Monday first, as the rest of the journal.
  return { offset: (new Date(start).getUTCDay() + 6) % 7, days };
}
