import { z } from "zod";

const label = z.string().trim().min(1).max(120);
const base = {
  title: label,
  caption: z.string().max(400).optional(),
};
const nodeId = z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/);

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
export const visualToolSchema = z
  .object({
    ...base,
    kind: z.enum(["table", "bar_chart", "diagram"]),
    columns: table.shape.columns.optional(),
    rows: table.shape.rows.optional(),
    unit: chart.shape.unit.optional(),
    points: chart.shape.points.optional(),
    nodes: diagram.shape.nodes.optional(),
    edges: diagram.shape.edges.optional(),
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
