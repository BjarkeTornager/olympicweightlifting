import { z } from "zod";

const image = z
  .string()
  .max(180_022)
  .regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/);
export const suggestedMotionSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(["available", "partial", "unavailable"]),
    reason: z.string().max(300),
    clips: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            start: z.number().finite().min(0).max(120.2),
            end: z.number().finite().min(0).max(120.2),
            frames: z
              .array(
                z
                  .object({
                    t: z.number().finite().min(0).max(120.2),
                    image: image.optional(),
                  })
                  .strict(),
              )
              .max(90),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();
export type SuggestedMotion = z.infer<typeof suggestedMotionSchema>;

export function mergeSuggestedMotion(
  previous: SuggestedMotion | undefined,
  current: SuggestedMotion | undefined,
  start: number,
  end: number,
) {
  if (!current) return undefined;
  const clips = [
    ...(previous?.clips.filter((c) => c.end < start || c.start > end) ?? []),
    ...current.clips,
  ].sort((a, b) => a.start - b.start);
  const frames = clips.flatMap((c) => c.frames);
  const available = frames.filter((f) => f.image).length;
  return {
    ...current,
    clips,
    status: !available
      ? ("unavailable" as const)
      : available < frames.length
        ? ("partial" as const)
        : ("available" as const),
  };
}
