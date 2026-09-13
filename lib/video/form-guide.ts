import type { VideoAnalysis } from "./types";
import {
  bracket,
  interpolateJoints,
  lerp,
  visiblePoses,
  type Joint,
  type PoseFrame,
  type XY,
} from "./overlay-timeline";

export type GuideFrame = PoseFrame & {
  suggested: Joint[];
  adjustment: number;
  phase: string;
  attempt: string;
};
export type FormGuide = {
  frames: GuideFrame[];
  available: boolean;
  reason: string;
};
export const bodyBones: [number, number][] = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
];
const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const smooth = (v: number) => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

// Two-link IK in image space. Feet and hands remain fixed; neither limb length
// can be silently stretched to reach an impossible suggested position.
export function bendBetween(
  root: XY,
  end: XY,
  previous: XY,
  upper: number,
  lower: number,
): XY | null {
  const d = distance(root, end);
  if (d < Math.abs(upper - lower) + 0.01 || d > upper + lower - 0.01)
    return null;
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const high = Math.sqrt(Math.max(0, upper * upper - along * along));
  const dx = (end[0] - root[0]) / d,
    dy = (end[1] - root[1]) / d;
  const candidates: XY[] = [-1, 1].map((sign) => [
    root[0] + along * dx - sign * high * dy,
    root[1] + along * dy + sign * high * dx,
  ]);
  return distance(candidates[0], previous) < distance(candidates[1], previous)
    ? candidates[0]
    : candidates[1];
}

function suggestFrame(
  a: VideoAnalysis,
  frame: PoseFrame,
  all: PoseFrame[],
): GuideFrame {
  const points = new Map(
    frame.points.map((p) => [p.id, [p.x * a.width, p.y * a.height] as XY]),
  );
  const proposed = new Map(points);
  const attempt = a.attempts?.find(
    (v) => frame.t >= v.start && frame.t <= v.end,
  );
  // No interpolation or phase inference across repetitions or failed attempts.
  if (a.attempts?.length && !attempt)
    return {
      ...frame,
      suggested: [],
      adjustment: 0,
      phase: "Recorded movement",
      attempt: "outside",
    };
  const identity = attempt?.identification ?? a.identification;
  const phases = identity?.phases ?? [];
  const start = attempt?.start ?? 0,
    end = attempt?.end ?? a.duration;
  const within = all.filter((f) => f.t >= start && f.t <= end);
  let label = "Recorded transition";
  let maxChange = 0;
  if (identity?.status !== "supported")
    return {
      ...frame,
      suggested: [],
      adjustment: 0,
      phase: label,
      attempt: "unsupported",
    };
  const rack = phases.find(
    (p) => p.kind === "front_rack_receive" || p.kind === "front_rack_hold",
  )?.time;
  const drive = phases.find((p) => p.kind === "leg_drive_from_rack")?.time;
  const overhead = phases.find(
    (p) =>
      p.kind === "overhead_receive" || p.kind === "direct_pull_to_overhead",
  )?.time;
  const pull = phases.find((p) => p.kind === "pull")?.time;

  for (const side of [0, 1]) {
    const shoulder = points.get(11 + side),
      other = points.get(12 - side),
      hip = points.get(23 + side);
    const knee = points.get(25 + side),
      ankle = points.get(27 + side),
      wrist = points.get(15 + side);
    const elbow = points.get(13 + side);
    if (!shoulder || !hip || !knee || !ankle || !wrist || !elbow) continue;
    const torso = distance(shoulder, hip);
    if (
      torso < a.height * 0.1 ||
      torso > a.height * 0.5 ||
      !other ||
      distance(shoulder, other) > torso * 0.5
    )
      continue;
    let targetHip: XY | undefined, targetShoulder: XY | undefined;
    if (
      pull !== undefined &&
      frame.t >= start &&
      frame.t < (rack ?? overhead ?? end) &&
      wrist[1] >= knee[1]
    ) {
      // Reference is this athlete's initial pull, not a universal back angle.
      const reference = within.find(
        (f) =>
          f.t >= start &&
          f.t <= pull + 0.15 &&
          [11 + side, 23 + side, 25 + side, 15 + side].every((id) =>
            f.points.some((p) => p.id === id),
          ),
      );
      const rs = reference?.points.find((p) => p.id === 11 + side),
        rh = reference?.points.find((p) => p.id === 23 + side);
      const rw = reference?.points.find((p) => p.id === 15 + side),
        rk = reference?.points.find((p) => p.id === 25 + side);
      if (rs && rh && rw && rk && rw.y >= rk.y) {
        const dx = (rh.x - rs.x) * a.width,
          dy = (rh.y - rs.y) * a.height;
        const len = Math.hypot(dx, dy);
        const blend = smooth((wrist[1] - knee[1]) / (torso * 0.18));
        const angle = Math.atan2(hip[0] - shoulder[0], hip[1] - shoulder[1]);
        const goal = Math.atan2(dx, dy);
        const delta = Math.max(-0.12, Math.min(0.12, goal - angle)) * blend;
        if (len > 0 && dy > 0)
          targetHip = [
            shoulder[0] + Math.sin(angle + delta) * torso,
            shoulder[1] + Math.cos(angle + delta) * torso,
          ];
        label = "Pull · steady trunk angle";
      }
    } else if (
      rack !== undefined &&
      drive !== undefined &&
      frame.t >= rack &&
      frame.t <= (overhead ?? drive + 0.5) &&
      distance(wrist, shoulder) < torso * 0.55 &&
      hip[1] < knee[1]
    ) {
      // A jerk dip is vertical. Do not impose this relationship on the clean
      // catch, its squat recovery, or a snatch (which have different demands).
      const leg = distance(hip, ankle);
      const shallow = leg / (distance(hip, knee) + distance(knee, ankle));
      if (frame.t >= drive - 0.8 && shallow > 0.82) {
        const angle = Math.atan2(hip[0] - shoulder[0], hip[1] - shoulder[1]);
        const blend =
          smooth((shallow - 0.82) / 0.1) *
          smooth((frame.t - Math.max(rack, drive - 0.8)) / 0.2);
        const adjusted = angle - Math.max(-0.12, Math.min(0.12, angle)) * blend;
        targetHip = [
          shoulder[0] + Math.sin(adjusted) * torso,
          shoulder[1] + Math.cos(adjusted) * torso,
        ];
        label = "Dip & drive · upright support";
      }
    } else if (
      overhead !== undefined &&
      frame.t >= overhead &&
      wrist[1] < shoulder[1] - torso * 0.5
    ) {
      // Stack the visible shoulder towards the supporting wrist, with the hip,
      // wrist and foot fixed. Retain the observed split/squat and grip width.
      const blend = smooth((frame.t - overhead) / 0.18);
      const x =
        shoulder[0] +
        Math.max(
          -torso * 0.08,
          Math.min(torso * 0.08, wrist[0] - shoulder[0]),
        ) *
          blend;
      const dx = x - hip[0];
      if (Math.abs(dx) < torso * 0.6)
        targetShoulder = [x, hip[1] - Math.sqrt(torso * torso - dx * dx)];
      label = "Overhead · supported alignment";
    }
    if (targetHip) {
      const bent = bendBetween(
        targetHip,
        ankle,
        knee,
        distance(hip, knee),
        distance(knee, ankle),
      );
      if (
        bent &&
        distance(bent, knee) < torso * 0.18 &&
        distance(targetHip, hip) <= torso * 0.13
      ) {
        proposed.set(23 + side, targetHip);
        proposed.set(25 + side, bent);
        maxChange = Math.max(maxChange, distance(targetHip, hip) / torso);
      }
    }
    if (targetShoulder) {
      const bent = bendBetween(
        targetShoulder,
        wrist,
        elbow,
        distance(shoulder, elbow),
        distance(elbow, wrist),
      );
      if (bent && distance(bent, elbow) < torso * 0.18) {
        proposed.set(11 + side, targetShoulder);
        proposed.set(13 + side, bent);
        maxChange = Math.max(
          maxChange,
          distance(targetShoulder, shoulder) / torso,
        );
      }
    }
  }
  return {
    ...frame,
    phase: label,
    adjustment: maxChange,
    attempt: attempt?.id ?? "lift",
    suggested: frame.points.map((p) => {
      const v = proposed.get(p.id)!;
      if (v === points.get(p.id)) return p;
      return { id: p.id, x: v[0] / a.width, y: v[1] / a.height };
    }),
  };
}

export function compileFormGuide(
  a: VideoAnalysis | null | undefined,
): FormGuide {
  const poses = a ? visiblePoses(a) : [];
  const frames = a ? poses.map((frame) => suggestFrame(a, frame, poses)) : [];
  const available = frames.filter((f) => f.adjustment > 0.005).length >= 3;
  return {
    frames,
    available,
    reason: available
      ? "A suggested silhouette follows your timing and proportions. Pull, jerk-dip and overhead alignment are adjusted where the side view supports them. Grey transitions follow your recorded movement; they are not an ideal-form assessment."
      : "A form guide needs a clear side view, continuous body tracking and an identified lift. This review does not have enough evidence for a corrected animation.",
  };
}

export function formGuideAt(guide: FormGuide, time: number) {
  if (!guide.available) return null;
  const pair = bracket(guide.frames, time, 0.22);
  if (
    !pair ||
    pair.a.attempt !== pair.b.attempt ||
    ["outside", "unsupported"].includes(pair.a.attempt)
  )
    return null;
  const observed = interpolateJoints(pair.a.points, pair.b.points, pair.u);
  const suggested = interpolateJoints(
    pair.a.suggested,
    pair.b.suggested,
    pair.u,
  );
  if (
    ![0, 1].some((side) =>
      [11, 13, 15, 23, 25, 27].every((id) =>
        observed.some((p) => p.id === id + side),
      ),
    )
  )
    return null;
  return {
    observed,
    suggested,
    adjustment: lerp(pair.a.adjustment, pair.b.adjustment, pair.u),
    phase: pair.u < 0.5 ? pair.a.phase : pair.b.phase,
  };
}

// Linear blend skinning of the selected lifter's silhouette. Each contour point
// follows its nearest bones; this keeps the shadow recognisably their own body.
// It is a 2D counterfactual, not a new measured 3D motion or an anatomical mesh.
export function skinPoint(
  point: XY,
  observed: Joint[],
  suggested: Joint[],
  width: number,
  height: number,
): XY {
  const a = new Map(
    observed.map((p) => [p.id, [p.x * width, p.y * height] as XY]),
  );
  const b = new Map(
    suggested.map((p) => [p.id, [p.x * width, p.y * height] as XY]),
  );
  const p: XY = [point[0] * width, point[1] * height];
  const candidates = bodyBones
    .flatMap(([from, to]) => {
      const s = a.get(from),
        e = a.get(to),
        ns = b.get(from),
        ne = b.get(to);
      if (!s || !e || !ns || !ne) return [];
      const dx = e[0] - s[0],
        dy = e[1] - s[1],
        d2 = dx * dx + dy * dy;
      if (d2 < 4) return [];
      const u = ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / d2;
      const v = ((p[1] - s[1]) * dx - (p[0] - s[0]) * dy) / Math.sqrt(d2);
      const ndx = ne[0] - ns[0],
        ndy = ne[1] - ns[1],
        nl = Math.hypot(ndx, ndy);
      if (nl < 2) return [];
      const nearest: XY = [
        s[0] + Math.max(0, Math.min(1, u)) * dx,
        s[1] + Math.max(0, Math.min(1, u)) * dy,
      ];
      return [
        {
          d: distance(p, nearest),
          point: [
            ns[0] + u * ndx - (v * ndy) / nl,
            ns[1] + u * ndy + (v * ndx) / nl,
          ] as XY,
        },
      ];
    })
    .sort((x, y) => x.d - y.d)
    .slice(0, 2);
  if (!candidates.length) return point;
  const sum = candidates.reduce((s, c) => s + 1 / (c.d + 2) ** 3, 0);
  return [
    candidates.reduce((s, c) => s + c.point[0] / (c.d + 2) ** 3, 0) /
      sum /
      width,
    candidates.reduce((s, c) => s + c.point[1] / (c.d + 2) ** 3, 0) /
      sum /
      height,
  ];
}
