import { z } from "zod";
import { isEvidenceFrameTime } from "./body";
import type { VideoAnalysis } from "./types";

// These are review categories, not diagnoses or a universal model of good form.
export const techniqueIssues = [
  "early_pull_posture",
  "bar_separation",
  "clean_turnover",
  "jerk_dip_posture",
  "overhead_control",
  "split_recovery",
  "other",
] as const;
export type TechniqueIssue = (typeof techniqueIssues)[number];
export const correctionRequestSchema = z
  .object({
    kind: z.literal("preserve_torso"),
    referenceFrame: z.number().int().min(1),
    view: z.literal("side"),
  })
  .strict();
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;
export type BodyPoint = { id: number; x: number; y: number };
export type PostureGhost = {
  version: 1;
  kind: "preserve_torso";
  referenceTime: number;
  focusTime: number;
  side: "left" | "right";
  observed: BodyPoint[];
  suggested: BodyPoint[];
  connections: [number, number][];
  explanation: string;
};
export type CorrectionPreview =
  | { status: "available"; ghost: PostureGhost }
  | { status: "unavailable"; reason: string };

const distance = (a: BodyPoint, b: BodyPoint, w: number, h: number) =>
  Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
const pointIds = [
  11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];
export function visiblePoseAt(a: VideoAnalysis, time: number): BodyPoint[] {
  if (a.pose?.version !== 2) return [];
  const frame = a.pose.frames.find((f) => Math.abs(f.t - time) < 0.001);
  if (
    !frame ||
    new Set(frame.points.map((p) => p.id)).size !== frame.points.length
  )
    return [];
  return frame.points.filter(
    (p) =>
      pointIds.includes(p.id) &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.x <= 1 &&
      p.y >= 0 &&
      p.y <= 1,
  );
}

// A narrow, illustrative counterfactual: preserve THIS lifter's earlier trunk
// orientation. Pixels are never warped and an LLM never chooses joint coordinates.
// Hands, shoulders and feet stay fixed; limb lengths are preserved
// in image-pixel space, including non-square portrait video.
export function buildPostureGhost(
  a: VideoAnalysis,
  moment: {
    issue?: TechniqueIssue;
    evidenceTimes: number[];
    evidenceTime: number;
  },
  request: CorrectionRequest,
): CorrectionPreview {
  const unavailable = (reason: string): CorrectionPreview => ({
    status: "unavailable",
    reason,
  });
  if (
    !correctionRequestSchema.safeParse(request).success ||
    !["early_pull_posture", "jerk_dip_posture"].includes(moment.issue ?? "")
  )
    return unavailable(
      "This correction needs a different kind of visual guide.",
    );
  const before = a.sampleTimes[request.referenceFrame - 1],
    at = moment.evidenceTime;
  if (
    !Number.isFinite(before) ||
    !Number.isFinite(at) ||
    before < 0 ||
    at > a.duration ||
    at - before < 0.08 ||
    at - before > 2.5 ||
    !moment.evidenceTimes.includes(before) ||
    !moment.evidenceTimes.includes(at)
  )
    return unavailable(
      "A clear earlier position in the same movement is needed for this preview.",
    );
  const phases = a.identification?.phases ?? [];
  const matching = phases.some((p) =>
    moment.issue === "jerk_dip_posture"
      ? p.kind === "leg_drive_from_rack" &&
        p.time >= before - 0.15 &&
        p.time <= at + 1.5
      : p.kind === "pull" && p.time >= before - 0.15 && p.time <= at + 0.15,
  );
  const crossed = phases.some(
    (p) =>
      p.time > before &&
      p.time <= at &&
      [
        "front_rack_receive",
        "overhead_receive",
        "direct_pull_to_overhead",
      ].includes(p.kind),
  );
  if (!matching || crossed)
    return unavailable(
      "The reference must belong to the same pull or dip, before the receiving phase.",
    );
  if (!(a.width > 0 && a.height > 0 && Number.isFinite(a.width + a.height)))
    return unavailable("The video geometry is unavailable.");
  const reference = visiblePoseAt(a, before),
    observed = visiblePoseAt(a, at);
  const w = a.width,
    h = a.height;
  for (const side of [0, 1]) {
    const ids = [
      11 + side,
      13 + side,
      15 + side,
      23 + side,
      25 + side,
      27 + side,
      29 + side,
      31 + side,
    ];
    const [shoulderId, , , hipId, , ankleId, heelId, toeId] = ids;
    const ref = new Map(reference.map((p) => [p.id, p])),
      current = new Map(observed.map((p) => [p.id, p]));
    // Foot landmarks and the full visible arm/leg on this side are needed. A missing
    // elbow must not become a plausible straight arm in the suggested silhouette.
    if (!ids.every((id) => ref.has(id) && current.has(id))) continue;
    const hip = current.get(hipId)!,
      shoulder = current.get(shoulderId)!;
    const rh = ref.get(hipId)!,
      rs = ref.get(shoulderId)!;
    const length = distance(hip, shoulder, w, h),
      previousLength = distance(rh, rs, w, h);
    // Early-pull illustrations stop at knee height; they must never flatten the
    // normal torso opening during extension. A dip must actually be in the rack.
    if (
      moment.issue === "early_pull_posture" &&
      (current.get(15 + side)!.y < current.get(25 + side)!.y ||
        ref.get(15 + side)!.y < ref.get(25 + side)!.y)
    )
      continue;
    if (
      moment.issue === "jerk_dip_posture" &&
      (distance(current.get(15 + side)!, shoulder, w, h) > length * 0.5 ||
        distance(ref.get(15 + side)!, rs, w, h) > previousLength * 0.5)
    )
      continue;
    if (
      length < h * 0.1 ||
      length > h * 0.55 ||
      length / previousLength < 0.85 ||
      length / previousLength > 1.15
    )
      continue;
    // A front-facing shoulder span, substantial camera movement or an unreliable
    // foot track cannot define a side-view posture target.
    const other = current.get(12 - side),
      otherRef = ref.get(12 - side);
    if (
      !other ||
      !otherRef ||
      distance(shoulder, other, w, h) > length * 0.45 ||
      distance(rs, otherRef, w, h) > previousLength * 0.45
    )
      continue;
    if (
      [ankleId, heelId, toeId].some(
        (id) => distance(ref.get(id)!, current.get(id)!, w, h) > h * 0.025,
      )
    )
      continue;
    if (shoulder.y >= hip.y || rs.y >= rh.y) continue;
    const angle = Math.atan2(
      (shoulder.x - hip.x) * w,
      -(shoulder.y - hip.y) * h,
    );
    const referenceAngle = Math.atan2((rs.x - rh.x) * w, -(rs.y - rh.y) * h);
    const delta = referenceAngle - angle;
    const degrees = (Math.abs(delta) * 180) / Math.PI;
    // These are engineering rejection bounds, not validated fault thresholds or
    // measurements shown to the athlete. The visual review must establish a fault.
    if (
      degrees < 6 ||
      degrees > 18 ||
      Math.abs(angle) <= Math.abs(referenceAngle) ||
      (moment.issue === "jerk_dip_posture" &&
        Math.abs(referenceAngle) > (15 * Math.PI) / 180)
    )
      continue;
    // Keep the shoulders/arms with the bar. Restore the reference torso
    // orientation by repositioning the hips, then solve the knee with planted
    // feet and unchanged thigh/shin lengths. Rotating the shoulder around a
    // fixed hip can otherwise demand an impossible arm position.
    const points = ids.map((id) => current.get(id)!);
    const kneeId = 25 + side;
    const knee = current.get(kneeId)!,
      ankle = current.get(ankleId)!;
    const targetHip = {
      id: hipId,
      x: shoulder.x - (length * Math.sin(referenceAngle)) / w,
      y: shoulder.y + (length * Math.cos(referenceAngle)) / h,
    };
    const thigh = distance(hip, knee, w, h),
      shin = distance(knee, ankle, w, h);
    const span = distance(targetHip, ankle, w, h);
    if (
      span < h * 0.01 ||
      span > thigh + shin + 1e-7 ||
      span < Math.abs(thigh - shin) ||
      distance(targetHip, hip, w, h) > h * 0.08
    )
      continue;
    const along = (thigh ** 2 - shin ** 2 + span ** 2) / (2 * span);
    const offset = Math.sqrt(Math.max(0, thigh ** 2 - along ** 2));
    const dx = ((ankle.x - targetHip.x) * w) / span,
      dy = ((ankle.y - targetHip.y) * h) / span;
    const choices = [-1, 1].map((sign) => ({
      id: kneeId,
      x: targetHip.x + (along * dx - sign * offset * dy) / w,
      y: targetHip.y + (along * dy + sign * offset * dx) / h,
    }));
    const targetKnee = choices.sort(
      (p, q) => distance(p, knee, w, h) - distance(q, knee, w, h),
    )[0];
    if (distance(targetKnee, knee, w, h) > h * 0.08) continue;
    const suggested = points.map((p) =>
      p.id === hipId ? targetHip : p.id === kneeId ? targetKnee : { ...p },
    );
    if (
      suggested.some(
        (p) =>
          p.x < 0 ||
          p.x > 1 ||
          p.y < 0 ||
          p.y > 1 ||
          !Number.isFinite(p.x + p.y),
      )
    )
      continue;
    return {
      status: "available",
      ghost: {
        version: 1,
        kind: "preserve_torso",
        referenceTime: before,
        focusTime: at,
        side: side === 0 ? "left" : "right",
        observed: points,
        suggested,
        connections: [
          [shoulderId, 13 + side],
          [13 + side, 15 + side],
          [shoulderId, hipId],
          [hipId, 25 + side],
          [25 + side, ankleId],
          [ankleId, heelId],
          [heelId, toeId],
        ],
        explanation:
          "The teal guide suggests a hip and knee position that preserves your earlier torso orientation while keeping your shoulders, hands and feet at their observed positions. It illustrates this coaching cue; it is not a universal ideal lift.",
      },
    };
  }
  return unavailable(
    "The side view, visible joints or reference position are not clear enough for a reliable body guide. Use the evidence frames and cue.",
  );
}

export function ghostAt(preview: CorrectionPreview | undefined, time: number) {
  return preview?.status === "available" &&
    Number.isFinite(time) &&
    isEvidenceFrameTime(preview.ghost.focusTime, time)
    ? preview.ghost
    : null;
}

export function poseReviewEvidence(a: VideoAnalysis) {
  return a.sampleTimes
    .map((t, i) => ({ frame: i + 1, time: t, points: visiblePoseAt(a, t) }))
    .filter((f) => f.points.length);
}
