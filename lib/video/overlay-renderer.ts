import type { VideoAnalysis } from "./types";
import { timedObservations } from "./observations";
import { barTrailSegments, currentVideoReview } from "./coaching";
import {
  bodyBones,
  compileFormGuide,
  formGuideAt,
  skinPoint,
} from "./form-guide";
import {
  bracket,
  compileOutlines,
  outlinesAt,
  poseAt,
  visiblePoses,
  type Joint,
  type XY,
} from "./overlay-timeline";

export type OverlayOptions = {
  form: boolean;
  outline: boolean;
  bar: boolean;
  cues: boolean;
  body?: boolean;
};
export function createOverlayTrack(analysis: VideoAnalysis | null) {
  const outlines = compileOutlines(analysis?.segmentation);
  const current = currentVideoReview(analysis);
  const guide = compileFormGuide(current ? analysis : null);
  const motion = current ? (analysis?.body?.motion?.clips ?? []) : [];
  const formAvailable =
    guide.available ||
    motion.some((c) =>
      c.frames.some(
        (f, i) =>
          i > 0 &&
          f.image &&
          c.frames[i - 1].image &&
          f.t - c.frames[i - 1].t <= 0.22,
      ),
    );
  const poses = analysis ? visiblePoses(analysis) : [];
  const moments = currentVideoReview(analysis)
    ? (analysis?.coaching?.moments ?? [])
    : [];
  const bodyAvailable = Boolean(
    analysis?.body?.frames.some(
      (f, i, frames) =>
        i > 0 && f.image && frames[i - 1].image && f.t - frames[i - 1].t <= 0.5,
    ),
  );
  return {
    analysis,
    outlines,
    guide,
    poses,
    moments,
    motion,
    formAvailable,
    bodyAvailable,
    observations: timedObservations(analysis),
  };
}
export type OverlayTrack = ReturnType<typeof createOverlayTrack>;

function polygon(
  ctx: CanvasRenderingContext2D,
  points: XY[],
  w: number,
  h: number,
) {
  ctx.beginPath();
  points.forEach(([x, y], i) =>
    i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h),
  );
  ctx.closePath();
}
function skeleton(
  ctx: CanvasRenderingContext2D,
  points: Joint[],
  w: number,
  h: number,
  shadow: boolean,
) {
  const joints = new Map(points.map((p) => [p.id, p]));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [from, to] of bodyBones) {
    const p = joints.get(from),
      q = joints.get(to);
    if (!p || !q) continue;
    ctx.lineWidth = shadow
      ? h * (from >= 23 && from <= 26 ? 0.024 : 0.018)
      : h * 0.0025;
    ctx.beginPath();
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
    ctx.stroke();
  }
  if (shadow && [11, 12, 24, 23].every((id) => joints.has(id))) {
    polygon(
      ctx,
      [11, 12, 24, 23].map((id) => [joints.get(id)!.x, joints.get(id)!.y]),
      w,
      h,
    );
    ctx.fill();
  }
}

// Draw one affine triangle from an existing reconstruction. This animates the
// projected mesh without decoding another video, holding the original frame,
// or presenting an unrelated sample on top of newer source pixels.
function triangle(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: XY[],
  target: XY[],
  w: number,
  h: number,
) {
  const [[x0, y0], [x1, y1], [x2, y2]] = source.map(([x, y]): XY => [
    x * image.naturalWidth,
    y * image.naturalHeight,
  ]);
  const [[u0, v0], [u1, v1], [u2, v2]] = target.map(([x, y]): XY => [
    x * w,
    y * h,
  ]);
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 0.001) return;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(u0, v0);
  ctx.lineTo(u1, v1);
  ctx.lineTo(u2, v2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, u0 - a * x0 - c * y0, v0 - b * x0 - d * y0);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}
function warpMesh(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  from: Joint[],
  to: Joint[],
  w: number,
  h: number,
) {
  const cols = 10,
    rows = 14;
  const grid = Array.from({ length: (cols + 1) * (rows + 1) }, (_, i) => {
    const source: XY = [
      (i % (cols + 1)) / cols,
      Math.floor(i / (cols + 1)) / rows,
    ];
    return { source, target: skinPoint(source, from, to, w, h) };
  });
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * (cols + 1) + x;
      for (const ids of [
        [i, i + 1, i + cols + 1],
        [i + 1, i + cols + 2, i + cols + 1],
      ])
        triangle(
          ctx,
          image,
          ids.map((j) => grid[j].source),
          ids.map((j) => grid[j].target),
          w,
          h,
        );
    }
}

export function renderOverlays(
  ctx: CanvasRenderingContext2D,
  track: OverlayTrack,
  time: number,
  options: OverlayOptions,
  images: Map<string, HTMLImageElement>,
) {
  const a = track.analysis,
    w = ctx.canvas.width,
    h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!a) return { count: 0, phase: "" };
  let count = 0;
  const regions = outlinesAt(track.outlines, time);
  if (options.body && track.bodyAvailable) {
    const person = regions.find((r) => r.kind === "person");
    if (person) {
      // Grey always means recorded geometry. It must never stand in for a
      // corrected target, including while a mesh texture is loading.
      ctx.fillStyle = "#c8d5ed55";
      polygon(ctx, person.polygon, w, h);
      ctx.fill();
      const frames = a.body?.frames ?? [];
      let pair = bracket(frames, time, 0.5);
      if (pair?.a === pair?.b)
        pair =
          bracket(frames, time + 0.00002, 0.5) ??
          bracket(frames, time - 0.00002, 0.5);
      if (pair && pair.a !== pair.b && pair.a.image && pair.b.image) {
        const targetPose = poseAt(track.poses, time);
        const bounds = (p: XY[]) => ({
          x: Math.min(...p.map(([x]) => x)),
          y: Math.min(...p.map(([, y]) => y)),
          w: Math.max(...p.map(([x]) => x)) - Math.min(...p.map(([x]) => x)),
          h:
            Math.max(...p.map(([, y]) => y)) - Math.min(...p.map(([, y]) => y)),
        });
        const target = bounds(person.polygon);
        for (const [frame, weight] of [
          [pair.a, 1 - pair.u],
          [pair.b, pair.u],
        ] as const) {
          const texture = frame.image ? images.get(frame.image) : undefined;
          const source = outlinesAt(track.outlines, frame.t).find(
            (p) => p.id === person.id,
          );
          if (
            !texture?.complete ||
            !texture.naturalWidth ||
            !source ||
            weight <= 0.01
          )
            continue;
          const from = bounds(source.polygon);
          if (from.w <= 0 || from.h <= 0) continue;
          const sx = target.w / from.w,
            sy = target.h / from.h;
          if (sx < 0.7 || sx > 1.4 || sy < 0.7 || sy > 1.4) continue;
          ctx.save();
          polygon(ctx, person.polygon, w, h);
          ctx.clip();
          ctx.globalAlpha = weight * 0.65;
          const sourcePose = poseAt(track.poses, frame.t);
          if (sourcePose.length >= 8 && targetPose.length >= 8)
            warpMesh(ctx, texture, sourcePose, targetPose, w, h);
          else {
            ctx.translate(
              (target.x - from.x * sx) * w,
              (target.y - from.y * sy) * h,
            );
            ctx.scale(sx, sy);
            ctx.drawImage(texture, 0, 0, w, h);
          }
          ctx.restore();
        }
      }
      count++;
    }
  }
  const form = options.form ? formGuideAt(track.guide, time) : null;
  const correctionClip = options.form
    ? track.motion.find((c) => time >= c.start && time <= c.end)
    : undefined;
  const correctedFrames = correctionClip?.frames ?? [];
  let correctedPair = bracket(correctedFrames, time, 0.22);
  if (correctedPair?.a === correctedPair?.b)
    correctedPair =
      bracket(correctedFrames, time + 0.00002, 0.22) ??
      bracket(correctedFrames, time - 0.00002, 0.22);
  const corrected =
    correctedPair &&
    correctedPair.a !== correctedPair.b &&
    correctedPair.a.image &&
    correctedPair.b.image
      ? [
          [correctedPair.a.image, 1 - correctedPair.u] as const,
          [correctedPair.b.image, correctedPair.u] as const,
        ].map(([key, weight]) => ({ image: images.get(key), weight }))
      : [];
  const correctedReady =
    corrected.length === 2 &&
    corrected.every((f) => f.image?.complete && f.image.naturalWidth);
  const correctionFade =
    correctedReady && correctionClip
      ? Math.max(
          0,
          Math.min(
            1,
            (time - correctionClip.start) / 0.1,
            (correctionClip.end - time) / 0.1,
          ),
        )
      : 0;
  // If joints are briefly obscured but SAM still observes the selected person,
  // retain a neutral recorded silhouette. Never extrapolate a correction or
  // silently switch to a spectator just to keep a coloured shadow visible.
  if (options.form && track.formAvailable && !form && correctionFade < 1) {
    const person = regions.find((r) => r.kind === "person");
    if (person) {
      ctx.globalAlpha = 1 - correctionFade;
      ctx.fillStyle = "#d5e7e54d";
      polygon(ctx, person.polygon, w, h);
      ctx.fill();
      ctx.globalAlpha = 1;
      count++;
    }
  }
  if (form) {
    const shade = Math.max(0, Math.min(1, form.adjustment / 0.02));
    const color = `${Math.round(213 - 133 * shade)}, ${Math.round(231 - shade)}, ${Math.round(229 - 34 * shade)}`;
    ctx.fillStyle = `rgba(${color}, ${0.3 + shade * 0.2})`;
    ctx.strokeStyle = `rgba(${color}, ${0.5 + shade * 0.17})`;
    // The continuous contour is also the loading fallback for mesh textures.
    // Missing poses are never filled by an unrelated reconstruction.
    const person = regions.find((r) => r.kind === "person");
    ctx.globalAlpha = 1 - correctionFade;
    if (person) {
      polygon(
        ctx,
        person.polygon.map((p) =>
          skinPoint(p, form.observed, form.suggested, w, h),
        ),
        w,
        h,
      );
      ctx.fill();
    } else skeleton(ctx, form.suggested, w, h, true);
    const bodyFrames = a.body?.frames ?? [];
    let pair = bracket(bodyFrames, time, 0.5);
    // An isolated texture is not a motion track. At an exact timestamp select
    // its adjacent interval rather than briefly flashing a single 3D image.
    if (pair?.a === pair?.b)
      pair =
        bracket(bodyFrames, time + 0.00002, 0.5) ??
        bracket(bodyFrames, time - 0.00002, 0.5);
    if (
      correctionFade < 1 &&
      pair &&
      pair.a !== pair.b &&
      pair.a.image &&
      pair.b.image
    ) {
      let start = bodyFrames.indexOf(pair.a),
        end = bodyFrames.indexOf(pair.b);
      while (
        start > 0 &&
        bodyFrames[start - 1].image &&
        bodyFrames[start].t - bodyFrames[start - 1].t <= 0.5
      )
        start--;
      while (
        end < bodyFrames.length - 1 &&
        bodyFrames[end + 1].image &&
        bodyFrames[end + 1].t - bodyFrames[end].t <= 0.5
      )
        end++;
      const fade = Math.max(
        0,
        Math.min(
          1,
          (time - bodyFrames[start].t) / 0.12,
          (bodyFrames[end].t - time) / 0.12,
        ),
      );
      for (const [frame, weight] of pair.a === pair.b
        ? [[pair.a, 1] as const]
        : [[pair.a, 1 - pair.u] as const, [pair.b, pair.u] as const]) {
        const image = frame.image ? images.get(frame.image) : undefined;
        const sourcePose = poseAt(track.poses, frame.t);
        if (
          image?.complete &&
          image.naturalWidth &&
          sourcePose.length >= 8 &&
          weight > 0.01
        ) {
          ctx.globalAlpha =
            weight * fade * (1 - correctionFade) * (0.25 + shade * 0.4);
          warpMesh(ctx, image, sourcePose, form.suggested, w, h);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffffbd";
    skeleton(ctx, form.observed, w, h, false);
    count++;
  }
  if (correctionFade > 0) {
    for (const frame of corrected) {
      ctx.globalAlpha = correctionFade * frame.weight;
      ctx.drawImage(frame.image!, 0, 0, w, h);
    }
    ctx.globalAlpha = 1;
    count++;
  }
  if (options.outline)
    for (const region of regions) {
      polygon(ctx, region.polygon, w, h);
      ctx.strokeStyle = region.kind === "plate" ? "#83d5ea" : "#ffde59";
      ctx.lineWidth = h * 0.0035;
      ctx.stroke();
      count++;
    }
  if (options.bar) {
    ctx.strokeStyle = "#83d5ea";
    ctx.lineWidth = h * 0.005;
    ctx.lineJoin = "round";
    for (const segment of barTrailSegments(a, time)) {
      ctx.beginPath();
      segment.forEach((p, i) =>
        i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h),
      );
      ctx.stroke();
      count++;
    }
  }
  if (options.cues) {
    const moment = track.moments.find((m) => time >= m.start && time <= m.end);
    const observation = moment
      ? undefined
      : track.observations.find((o) => time >= o.start && time < o.end);
    if (observation || moment) {
      const size = Math.max(13, w * 0.026);
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      const text = moment
        ? `Try · ${moment.title}`
        : `Observed · ${observation!.title}`;
      const label = text.length > 44 ? `${text.slice(0, 41)}…` : text;
      const width = Math.min(w - 24, ctx.measureText(label).width + 24);
      ctx.fillStyle = "#17252ed9";
      ctx.fillRect(12, 12, width, size + 20);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 24, 22 + size / 2, width - 24);
      count++;
    }
    const ids: Record<string, number[]> = {
      shoulders: [11, 12],
      elbows: [13, 14],
      hips: [23, 24],
      knees: [25, 26],
      feet: [27, 28],
    };
    const points = poseAt(track.poses, time).filter((p) =>
      ids[moment?.region ?? ""]?.includes(p.id),
    );
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, h * 0.022, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffde59";
      ctx.lineWidth = h * 0.004;
      ctx.stroke();
      count++;
    }
  }
  return { count, phase: form?.phase ?? "" };
}
