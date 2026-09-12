import { z } from "zod";
import { suggestedMotionSchema, mergeSuggestedMotion } from "./motion";
export const BODY_VERSION = 1;
export const bodySchema = z
  .object({
    version: z.literal(BODY_VERSION),
    model: z.literal("sam-3d-body"),
    revision: z.literal("11aaa346c7204874a1cbafe3d39a979080b2c55a"),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive().max(960),
    height: z.number().int().positive().max(960),
    status: z.enum(["tracked", "partial", "unavailable"]),
    reason: z.string().max(240),
    motion: suggestedMotionSchema.optional(),
    failure: z
      .enum(["deadline", "service_unavailable", "invalid_response"])
      .optional(),
    frames: z
      .array(
        z
          .object({
            t: z.number().finite().min(0).max(120.2),
            image: z
              .string()
              .max(180_022)
              .regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/)
              .optional(),
          })
          .strict(),
      )
      .max(192),
  })
  .strict();
export type VideoBody = z.infer<typeof bodySchema>;
export function playbackBodyFor(
  body: VideoBody | undefined,
  selected: string | null,
  suggested: boolean,
) {
  if (!suggested || !body) return body;
  const clips =
    body.motion?.clips.filter((c) => c.frames.some((f) => f.image)) ?? [];
  const clip = clips.find((c) => c.id === selected) ?? clips[0];
  return clip ? { ...body, frames: clip.frames } : body;
}
// Evidence timestamps have six decimal places. Seeking exactly to a rounded-
// down PTS can display the preceding frame. Enter the intended frame by 1 ms,
// well inside the supported <=120 FPS source interval, without changing its ID.
export function evidenceSeekTime(time: number, duration = Infinity) {
  return Math.min(duration, Math.max(0, time) + 0.001);
}
// Accommodate the deliberate seek bias and timestamp rounding, but never show
// the next frame's geometry before its pixels have actually been presented.
export function isEvidenceFrameTime(evidenceTime: number, time: number) {
  return (
    Number.isFinite(time) &&
    time >= evidenceTime - 0.000001 &&
    time < evidenceTime + 0.002
  );
}
export function bodyFrameAt(body: VideoBody | undefined, time: number) {
  if (!body || !Number.isFinite(time)) return undefined;
  return body.frames.find((f) => isEvidenceFrameTime(f.t, time));
}
export function mergeBody(
  previous: VideoBody | undefined,
  current: VideoBody,
  start: number,
  end: number,
): VideoBody {
  const kept =
    previous?.sourceSha256 === current.sourceSha256
      ? previous.frames.filter((f) => f.t < start || f.t > end)
      : [];
  const frames = [...kept, ...current.frames].sort((a, b) => a.t - b.t);
  const count = frames.filter((f) => f.image).length;
  return {
    ...current,
    frames,
    motion: mergeSuggestedMotion(
      previous?.sourceSha256 === current.sourceSha256
        ? previous.motion
        : undefined,
      current.motion,
      start,
      end,
    ),
    status: !count
      ? "unavailable"
      : current.status === "unavailable" || count < frames.length
        ? "partial"
        : "tracked",
  };
}
// Never attach a body projection to another source frame or interpolate through
// a missing pose. Playback may hold a complete captured frame for at most 0.4s.
export function bodyReplayAction(
  body: VideoBody | undefined,
  time: number,
  heldTime: number | null,
) {
  const frame = bodyFrameAt(body, time);
  if (frame)
    return frame.image
      ? { kind: "capture" as const, frame }
      : { kind: "clear" as const };
  if (!body || heldTime === null || !Number.isFinite(time) || time < heldTime)
    return { kind: "clear" as const };
  const held = body.frames.find((f) => Math.abs(f.t - heldTime) < 0.00001),
    next = body.frames.find((f) => f.t > heldTime + 0.00001);
  return held?.image &&
    next &&
    next.t - heldTime <= 0.4 &&
    time < next.t - 0.012
    ? { kind: "hold" as const }
    : { kind: "clear" as const };
}
