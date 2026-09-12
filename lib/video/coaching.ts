import { isEvidenceFrameTime } from "./body";
import { z } from "zod";
import type { VideoAnalysis } from "./types";
import {
  buildPostureGhost,
  correctionRequestSchema,
  techniqueIssues,
  type CorrectionPreview,
} from "./correction";
import { compatibleDrill, techniqueDrills } from "./technique";
import { canReviewIdentification, feedbackMatchesLift } from "./identification";

export const focusRegions = [
  "whole_lift",
  "shoulders",
  "elbows",
  "hips",
  "knees",
  "feet",
  "bar",
] as const;
const momentSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    issue: z.enum(techniqueIssues).optional(),
    why: z.string().trim().min(8).max(240).optional(),
    practice: z.string().trim().min(8).max(260).optional(),
    drill: z
      .enum(["jerk_dip", "snatch_lift_off", "tall_clean"])
      .nullable()
      .optional(),
    certainty: z.enum(["clear", "tentative"]).optional(),
    // A malformed optional guide must not discard otherwise grounded coaching.
    correction: correctionRequestSchema.nullable().optional().catch(null),
    observation: z.string().trim().min(10).max(360),
    cue: z.string().trim().min(3).max(160),
    check: z.string().trim().min(3).max(200),
    frames: z.array(z.number().int().min(1)).min(1).max(4),
    focusFrame: z.number().int().min(1),
    evidenceType: z.enum(["position", "movement"]),
    region: z.enum(focusRegions),
  })
  .strict();
export const coachingResponseSchema = z
  .object({
    strength: z.string().trim().max(260),
    limitation: z.string().trim().max(300),
    // Some providers echo the supplied source catalogue. Ignore this optional
    // metadata entirely: only our compatible drill IDs can produce a link.
    references: z.unknown().optional(),
    moments: z.array(momentSchema).max(3),
    checks: z
      .array(
        z
          .object({
            phase: z.enum([
              "pull",
              "receipt",
              "dip_drive",
              "overhead",
              "recovery",
            ]),
            status: z.enum(["reviewed", "not_visible"]),
            observation: z.string().trim().min(8).max(180),
          })
          .strict(),
      )
      .max(5)
      .optional(),
  })
  .strict();
export type CoachingMoment = Omit<
  z.infer<typeof momentSchema>,
  "frames" | "focusFrame" | "correction"
> & {
  attemptLabel?: string;
  correctionPreview?: CorrectionPreview;
  id: string;
  evidenceFrames: number[];
  evidenceTimes: number[];
  evidenceTime: number;
  start: number;
  end: number;
};
export type GuidedCoaching = {
  version: 1 | 2;
  checks?: z.infer<typeof coachingResponseSchema>["checks"];
  previousFocus?: {
    reviewId: string;
    date: string;
    title: string;
    cue: string;
    check: string;
  };
  scope?: "visible_phases";
  strength: string;
  limitation: string;
  moments: CoachingMoment[];
};

export const guidedCoachingInstruction = `Return a coaching object with only strength, limitation, checks, and moments. Do not echo the source catalogue or add references, URLs or other metadata.
checks: [{"phase":"pull|receipt|dip_drive|overhead|recovery","status":"reviewed|not_visible","observation":"what was actually assessed, or what evidence is missing"}]. Assess each applicable visible phase before selecting a priority; do not substitute movement identification for a technique assessment. Check chronology and body/bar relationships using images and the supplied 2D landmarks. Landmarks are imperfect image-plane observations, not biomechanical measurements.
moments: [{"title":"short priority","issue":"early_pull_posture|bar_separation|clean_turnover|jerk_dip_posture|overhead_control|split_recovery|other","why":"why addressing this observed issue is useful; no unsupported causal diagnosis","observation":"specific visible evidence","cue":"one practical change for the next attempt","check":"the visible difference to look for on the next comparable attempt","practice":"one brief, low-load practice task matched to this issue; no workout prescription","drill":null,"certainty":"clear|tentative","frames":[1,2],"focusFrame":2,"evidenceType":"position|movement","region":"whole_lift|shoulders|elbows|hips|knees|feet|bar","correction":null}].
Pick ONE main improvement first, at most two supporting moments. Include a cue, a practice task, why it matters and a checkable result. Use the supplied issue rubric and compatible drill catalogue. drill is a catalogue ID or null; never create URLs. Prefer a compatible catalogue practice task. Otherwise suggest a simple controlled rehearsal of the current lift with an empty bar or light load. Never invent compound drills, unusual mid-lift pauses or exercises that need unseen equipment. If a previous focus is supplied, assess that issue in the NEW images without assuming it recurs. Prior text alone cannot establish improvement or deterioration; do not claim a before/after result without paired evidence.
Use only printed 1-based frame labels as evidence, spanning no more than 2.5 seconds. Motion, timing, balance changes, bar travel or turnover require at least two distinct chronological frames. focusFrame must be one of frames and clearly show the issue. Do not prescribe changes to unseen phases, invent a fault to fill a list, or use a generic cue that could fit any clip. If no correction is justified, moments=[] with a precise limitation and the actual phase checks.
Optional correction: {"kind":"preserve_torso","referenceFrame":1,"view":"side"}. Only request this for a CLEAR early_pull_posture or jerk_dip_posture issue in a fixed side view. referenceFrame must be an earlier frame in frames, showing this athlete's suitable starting torso position in the SAME early pull (both frames before the bar passes the knees) or jerk dip. focusFrame must show a later loss of that posture, before receipt or drive. Do not request it for front/oblique views, normal extension above the knees, a moving camera, an unsuitable start posture, or uncertain faults. The application may omit the ghost when geometry is unreliable. correction=null for all other cases. This is an illustrative posture adjustment, never perfect form. Do not supply coordinates, angles, an ideal trajectory or generated missing movement.`;

export function parseGuidedCoaching(
  content: string,
  analysis: VideoAnalysis,
  onInvalid?: (reason: CoachingFailure) => void,
): GuidedCoaching | null {
  try {
    const parsed = coachingResponseSchema.parse(
      JSON.parse(
        content
          .trim()
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, ""),
      ),
    );
    const lift = analysis.identification?.lift;
    if (!canReviewIdentification(analysis.identification)) return null;
    if (
      lift
        ? !feedbackMatchesLift(
            JSON.stringify({
              strength: parsed.strength,
              moments: parsed.moments,
            }),
            lift,
          )
        : /\b(snatch|clean|jerk)\b|\b(full|complete|entire) lift\b/i.test(
            JSON.stringify({
              strength: parsed.strength,
              moments: parsed.moments,
            }),
          )
    ) {
      onInvalid?.("lift_label");
      return null;
    }
    const moments: CoachingMoment[] = [];
    let failure: CoachingFailure = "frame_range";
    for (const raw of parsed.moments) {
      const frames = [...new Set(raw.frames)].sort((a, b) => a - b);
      const times = frames.map((f) => analysis.sampleTimes[f - 1]);
      if (
        times.some(
          (t) => !Number.isFinite(t) || t < 0 || t > analysis.duration + 0.05,
        )
      ) {
        failure = "frame_range";
        continue;
      }
      const start = times[0],
        end = times.at(-1)!;
      if (end - start > 2.5) {
        failure = "evidence_span";
        continue;
      }
      if (!frames.includes(raw.focusFrame)) {
        failure = "focus_frame";
        continue;
      }
      if (raw.evidenceType === "movement" && new Set(times).size < 2) {
        failure = "movement_frames";
        continue;
      }
      const { frames: unused, focusFrame, correction, ...text } = raw;
      void unused;
      const drill = compatibleDrill(text.drill ?? undefined, text.issue, lift);
      const moment: CoachingMoment = {
        ...text,
        ...(drill ? { practice: drill.instruction } : {}),
        ...(text.drill && !drill ? { drill: null } : {}),
        id: `moment-${moments.length + 1}`,
        evidenceFrames: frames,
        evidenceTimes: times,
        evidenceTime: analysis.sampleTimes[focusFrame - 1],
        start: Math.max(0, start - 0.8),
        end: Math.min(analysis.duration, end + 1.2),
      };
      if (correction)
        moment.correctionPreview =
          raw.certainty === "clear"
            ? buildPostureGhost(analysis, moment, correction)
            : {
                status: "unavailable",
                reason:
                  "Coach needs clearer evidence of this adjustment before showing a body guide.",
              };
      moments.push(moment);
    }
    // Invalid evidence never turns into a plausible-looking replay card.
    if (parsed.moments.length && !moments.length) {
      onInvalid?.(failure);
      return null;
    }
    return {
      version: 2,
      checks: parsed.checks,
      ...(!lift ? { scope: "visible_phases" as const } : {}),
      strength: parsed.strength,
      // Keep the validated first-pass boundary on partial coaching. A model
      // saying "the full lift is not visible" must not reject otherwise useful
      // cues, or introduce a different lift label through its limitation.
      limitation: lift ? parsed.limitation : analysis.identification!.reason,
      moments,
    };
  } catch {
    return null;
  }
}

export type CoachingFailure =
  | "lift_label"
  | "frame_range"
  | "evidence_span"
  | "focus_frame"
  | "movement_frames";

export function coachingText(coaching: GuidedCoaching) {
  return [
    coaching.strength ? `**What went well**\n\n${coaching.strength}` : "",
    ...coaching.moments.map((m, i) =>
      [
        `**${i ? m.title : `Main improvement: ${m.title}`}**\n\n${m.observation} (${m.evidenceTime.toFixed(2)}s)`,
        m.why ? `**Why this matters:** ${m.why}` : "",
        `**Try next:** ${m.cue}`,
        m.practice ? `**Practice:** ${m.practice}` : "",
        m.drill
          ? `[Drill demonstration: ${techniqueDrills[m.drill].name}](${techniqueDrills[m.drill].url})`
          : "",
        `**Check next time:** ${m.check}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
    coaching.limitation,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const regionIds: Record<CoachingMoment["region"], number[]> = {
  whole_lift: [],
  shoulders: [11, 12],
  elbows: [13, 14],
  hips: [23, 24],
  knees: [25, 26],
  feet: [27, 28, 29, 30, 31, 32],
  bar: [],
};
export const VIDEO_REVIEW_VERSION = 2;
export function currentVideoReview(analysis?: VideoAnalysis | null) {
  return analysis?.reviewVersion === VIDEO_REVIEW_VERSION;
}

// Frame inspection never paints a marker from an earlier/later posture. Dense
// review decoding produces a pose sample at each actual evidence timestamp.
export function evidenceFocusPoints(
  analysis: VideoAnalysis,
  moment: CoachingMoment,
  time: number,
) {
  if (!moment.evidenceTimes.some((t) => Math.abs(t - time) < 0.025)) return [];
  if (moment.region === "bar") {
    const p = analysis.tracking.points.find((p) =>
      isEvidenceFrameTime(p.t, time),
    );
    return p ? [{ id: -1, x: p.x, y: p.y }] : [];
  }
  if (analysis.pose?.version !== 2) return [];
  const frame = analysis.pose.frames.find((f) =>
    isEvidenceFrameTime(f.t, time),
  );
  return (
    frame?.points.filter((p) => regionIds[moment.region].includes(p.id)) ?? []
  );
}

export function barTrailSegments(analysis: VideoAnalysis, time: number) {
  const segments: { x: number; y: number; t: number }[][] = [];
  let previous: (typeof analysis.tracking.points)[number] | undefined;
  for (const p of analysis.tracking.points) {
    if (p.t > time) break;
    if (p.t < time - 1.5) continue;
    if (!previous || p.t - previous.t > 0.12 || p.t <= previous.t)
      segments.push([]);
    segments.at(-1)!.push(p);
    previous = p;
  }
  return segments.filter((s) => s.length > 1);
}
// Hide stale tracks and gaps. Do not interpolate over occlusion or across people.
export function focusPoints(
  analysis: VideoAnalysis,
  region: CoachingMoment["region"],
  time: number,
) {
  if (region === "bar") {
    const p = analysis.tracking.points.findLast((p) => p.t <= time);
    return p && time - p.t <= 0.1 ? [{ id: -1, x: p.x, y: p.y }] : [];
  }
  const frame = analysis.pose?.frames.findLast((f) => f.t <= time);
  if (!frame || time - frame.t > 0.1) return [];
  return frame.points.filter((p) => regionIds[region].includes(p.id));
}
