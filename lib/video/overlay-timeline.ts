import type { VideoAnalysis } from "./types";
import type { VideoSegmentation } from "./segmentation";

export type XY = [number, number];
export type Joint = { id: number; x: number; y: number };
export type PoseFrame = { t: number; points: Joint[] };
type Timed = { t: number };
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

// Presentation-only interpolation. Evidence used by Coach remains untouched.
// Explicit empty frames break a track, as do cuts, identity changes and long gaps.
export function bracket<T extends Timed>(
  frames: T[],
  time: number,
  maxGap: number,
) {
  if (!frames.length || !Number.isFinite(time)) return null;
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].t < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo < frames.length && Math.abs(frames[lo].t - time) < 0.00001)
    return { a: frames[lo], b: frames[lo], u: 0 };
  // Cover the final source frame's display interval, never a missing interior sample.
  if (lo === frames.length && time - frames[lo - 1].t <= 0.035)
    return { a: frames[lo - 1], b: frames[lo - 1], u: 0 };
  if (!lo || lo === frames.length) return null;
  const a = frames[lo - 1],
    b = frames[lo];
  if (b.t - a.t > maxGap || b.t <= a.t) return null;
  return { a, b, u: (time - a.t) / (b.t - a.t) };
}

export function interpolateJoints(a: Joint[], b: Joint[], u: number): Joint[] {
  const next = new Map(b.map((p) => [p.id, p]));
  return a.flatMap((p) => {
    const q = next.get(p.id);
    return q && Math.hypot(q.x - p.x, q.y - p.y) < 0.18
      ? [{ id: p.id, x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u) }]
      : [];
  });
}

export function poseAt(frames: PoseFrame[], time: number) {
  const pair = bracket(frames, time, 0.22);
  return pair ? interpolateJoints(pair.a.points, pair.b.points, pair.u) : [];
}

// SAM contours have neither equal vertex counts nor a stable first vertex.
// Arc-length resampling, winding and cyclic alignment prevent twisting on replay.
export function resampleContour(polygon: XY[], count = 64): XY[] {
  const lengths = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!total) return [];
  let segment = 0,
    before = 0;
  return Array.from({ length: count }, (_, i) => {
    const distance = (total * i) / count;
    while (
      segment < lengths.length - 1 &&
      before + lengths[segment] < distance
    ) {
      before += lengths[segment++];
    }
    const u = (distance - before) / Math.max(lengths[segment], 1e-9);
    const p = polygon[segment],
      q = polygon[(segment + 1) % polygon.length];
    return [lerp(p[0], q[0], u), lerp(p[1], q[1], u)];
  });
}
const area = (p: XY[]) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0);
const centre = (p: XY[]): XY => [
  p.reduce((s, q) => s + q[0], 0) / p.length,
  p.reduce((s, q) => s + q[1], 0) / p.length,
];
function alignContour(previous: XY[], current: XY[]) {
  if (area(previous) * area(current) < 0) current = [...current].reverse();
  const a = centre(previous),
    b = centre(current);
  let best = Infinity,
    shift = 0;
  for (let s = 0; s < current.length; s++) {
    const score = previous.reduce((sum, p, i) => {
      const q = current[(i + s) % current.length];
      return (
        sum +
        (p[0] - a[0] - q[0] + b[0]) ** 2 +
        (p[1] - a[1] - q[1] + b[1]) ** 2
      );
    }, 0);
    if (score < best) {
      best = score;
      shift = s;
    }
  }
  return current.map((_, i) => current[(i + shift) % current.length]);
}
export function compileOutlines(segmentation: VideoSegmentation | undefined) {
  let previous: VideoSegmentation["frames"][number] | undefined;
  return (segmentation?.frames ?? []).map((frame) => {
    const objects = frame.objects
      .map((object) => {
        let polygon = resampleContour(object.polygon);
        const before = previous?.objects.find(
          (o) => o.id === object.id && o.kind === object.kind,
        );
        if (before && frame.t - previous!.t <= 0.3 && polygon.length)
          polygon = alignContour(before.polygon, polygon);
        return { ...object, polygon };
      })
      .filter((o) => o.polygon.length);
    previous = { t: frame.t, objects };
    return previous;
  });
}
export function outlinesAt(
  frames: ReturnType<typeof compileOutlines>,
  time: number,
) {
  const pair = bracket(frames, time, 0.3);
  if (!pair) return [];
  return pair.a.objects.flatMap((a) => {
    const b = pair.b.objects.find((o) => o.id === a.id && o.kind === a.kind);
    if (!b || b.polygon.length !== a.polygon.length) return [];
    const ca = centre(a.polygon),
      cb = centre(b.polygon);
    const ratio = Math.abs(area(b.polygon) / area(a.polygon));
    if (
      Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) > 0.15 ||
      ratio < 0.5 ||
      ratio > 2
    )
      return [];
    return [
      {
        ...a,
        polygon: a.polygon.map((p, i): XY => [
          lerp(p[0], b.polygon[i][0], pair.u),
          lerp(p[1], b.polygon[i][1], pair.u),
        ]),
      },
    ];
  });
}

export function visiblePoses(a: VideoAnalysis): PoseFrame[] {
  return a.pose?.version === 2 ? a.pose.frames : [];
}
