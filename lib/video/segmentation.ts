import { z } from "zod";

const coordinate = z.number().finite().min(0).max(1);
const outline = z
  .object({
    id: z.string().regex(/^(person|plate)-\d+$/),
    kind: z.enum(["person", "plate"]),
    // Outlines are observations of a region, never joints or bar-hub coordinates.
    polygon: z
      .array(z.tuple([coordinate, coordinate]))
      .min(3)
      .max(64),
  })
  .strict();
export const segmentationSchema = z
  .object({
    version: z.literal(1),
    model: z.literal("sam3.1"),
    revision: z.literal("660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7"),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["tracked", "partial", "unavailable"]),
    reason: z.string().max(240),
    failure: z
      .enum(["deadline", "service_unavailable", "invalid_response"])
      .optional(),
    width: z.number().int().positive().max(960),
    height: z.number().int().positive().max(960),
    frames: z
      .array(
        z
          .object({
            t: z.number().finite().min(0).max(120),
            objects: z.array(outline).max(2),
          })
          .strict(),
      )
      .max(400),
  })
  .strict();
export type VideoSegmentation = z.infer<typeof segmentationSchema>;

export function mergeSegmentation(
  previous: VideoSegmentation | undefined,
  current: VideoSegmentation,
  start: number,
  end: number,
): VideoSegmentation {
  const merged = new Map(
    (previous?.sourceSha256 === current.sourceSha256
      ? previous.frames
      : []
    ).map((f) => [f.t, f]),
  );
  // A failed retry must erase stale outlines, while retaining other attempts.
  for (const t of merged.keys()) if (t >= start && t <= end) merged.delete(t);
  for (const frame of current.frames) merged.set(frame.t, frame);
  const frames = [...merged.values()].sort((a, b) => a.t - b.t);
  const visible = frames.filter((f) => f.objects.length).length;
  const status = !visible
    ? "unavailable"
    : current.status === "unavailable" || visible < frames.length
      ? "partial"
      : "tracked";
  return {
    ...current,
    status,
    frames,
    reason:
      current.status === "unavailable" && visible
        ? "Some object outlines are unavailable. Other attempts retain their visible outlines."
        : current.reason,
  };
}

// Never interpolate a contour across motion or a gap. This is paused-frame
// inspection, not a claim of continuous, frame-accurate tracking at any cadence.
export function segmentationAt(
  segmentation: VideoSegmentation | undefined,
  time: number,
) {
  return segmentationFrameAt(segmentation, time)?.objects ?? [];
}

export function segmentationFrameAt(
  segmentation: VideoSegmentation | undefined,
  time: number,
) {
  if (!segmentation || !Number.isFinite(time)) return undefined;
  const frame = segmentation.frames.reduce<
    VideoSegmentation["frames"][number] | undefined
  >(
    (best, frame) =>
      !best || Math.abs(frame.t - time) < Math.abs(best.t - time)
        ? frame
        : best,
    undefined,
  );
  return frame && Math.abs(frame.t - time) <= 0.012 ? frame : undefined;
}

// Replay an observed video frame together with its masks. Never keep a contour
// on top of newer, unsegmented pixels. A missing sample/occlusion clears both.
export function trackedReplayAction(
  segmentation: VideoSegmentation | undefined,
  time: number,
  heldTime: number | null,
) {
  const frame = segmentationFrameAt(segmentation, time);
  if (frame)
    return frame.objects.length
      ? { kind: "capture" as const, frame }
      : { kind: "clear" as const };
  if (
    !segmentation ||
    heldTime === null ||
    !Number.isFinite(time) ||
    time < heldTime
  )
    return { kind: "clear" as const };
  const next = segmentation.frames.find((f) => f.t > heldTime + 0.00001);
  const held = segmentation.frames.find(
    (f) => Math.abs(f.t - heldTime) < 0.00001,
  );
  if (
    !held?.objects.length ||
    !next ||
    next.t - heldTime > 0.4 ||
    time >= next.t - 0.012
  )
    return { kind: "clear" as const };
  return { kind: "hold" as const };
}

export function segmentationEvidence(
  segmentation: VideoSegmentation | undefined,
  times: number[],
) {
  if (!segmentation) return undefined;
  return {
    model: segmentation.model,
    purpose:
      "Candidate object regions only. Bounds are [left,top,right,bottom], normalized to the video image excluding contact-sheet labels. These do not establish joint positions, bar centres, lift phases or technical faults. Verify against the images.",
    frames: times
      .map((t, i) => ({
        frame: i + 1,
        objects: segmentationAt(segmentation, t).map((o) => ({
          id: o.id,
          kind: o.kind,
          bounds: [
            Math.min(...o.polygon.map((p) => p[0])),
            Math.min(...o.polygon.map((p) => p[1])),
            Math.max(...o.polygon.map((p) => p[0])),
            Math.max(...o.polygon.map((p) => p[1])),
          ],
        })),
      }))
      .filter((f) => f.objects.length),
  };
}
