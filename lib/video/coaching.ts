import { z } from "zod";
import type { VideoAnalysis } from "./types";
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
    observation: z.string().trim().min(10).max(360),
    cue: z.string().trim().min(3).max(160),
    check: z.string().trim().min(3).max(200),
    frames: z.array(z.number().int().min(1)).min(1).max(4),
    focusFrame: z.number().int().min(1),
    evidenceType: z.enum(["position", "movement"]),
    region: z.enum(focusRegions),
  })
  .strict();
const responseSchema = z
  .object({
    strength: z.string().trim().max(260),
    limitation: z.string().trim().max(300),
    moments: z.array(momentSchema).max(3),
  })
  .strict();
export type CoachingMoment = Omit<
  z.infer<typeof momentSchema>,
  "frames" | "focusFrame"
> & {
  attemptLabel?: string;
  id: string;
  evidenceFrames: number[];
  evidenceTimes: number[];
  evidenceTime: number;
  start: number;
  end: number;
};
export type GuidedCoaching = {
  version: 1;
  scope?: "visible_phases";
  strength: string;
  limitation: string;
  moments: CoachingMoment[];
};

export const guidedCoachingInstruction = `The coaching object has this exact structure:
{"strength":"one supported strength, or empty","limitation":"what this view cannot establish, or empty","moments":[{"title":"short coaching priority","observation":"specific visible evidence, not a generic tip","cue":"one change to try next","check":"what visible difference to look for next time","frames":[1,2],"focusFrame":2,"evidenceType":"position|movement","region":"whole_lift|shoulders|elbows|hips|knees|feet|bar"}]}.
Put the single most useful improvement first, at most two supporting moments. Do not call identifying the lift a strength. Each recommendation must explain an observed issue, one practicable cue and how to check whether it helped; avoid generic instructions that could fit any clip. Never manufacture a fault to fill the list. Use only printed 1-based frame labels as evidence, spanning no more than 2.5 seconds. A position may use one frame; claims about motion, timing, balance changes, bar travel or elbow turnover require at least two distinct chronological frames showing the change. focusFrame must be one of frames and show the issue most clearly, not just the start of the event. All evidence frames must support the observation. The viewer can freeze this exact frame and compare supporting frames. A tracked region is an observation aid, never a diagram of an ideal position. Do not infer a cause from a still pose or prescribe changes for unseen phases. You cannot supply coordinates, angles, an ideal trajectory or unobserved movement. If no correction is justified, return moments=[] with a specific limitation. Do not ask questions or require lift selection.`;

export function parseGuidedCoaching(
  content: string,
  analysis: VideoAnalysis,
): GuidedCoaching | null {
  try {
    const parsed = responseSchema.parse(
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
        ? !feedbackMatchesLift(JSON.stringify(parsed), lift)
        : /\b(snatch|clean|jerk)\b|\b(full|complete|entire) lift\b/i.test(
            JSON.stringify({
              strength: parsed.strength,
              moments: parsed.moments,
            }),
          )
    )
      return null;
    const moments: CoachingMoment[] = [];
    for (const raw of parsed.moments) {
      const frames = [...new Set(raw.frames)].sort((a, b) => a - b);
      const times = frames.map((f) => analysis.sampleTimes[f - 1]);
      if (
        times.some(
          (t) => !Number.isFinite(t) || t < 0 || t > analysis.duration + 0.05,
        )
      )
        continue;
      const start = times[0],
        end = times.at(-1)!;
      if (
        end - start > 2.5 ||
        !frames.includes(raw.focusFrame) ||
        (raw.evidenceType === "movement" && new Set(times).size < 2)
      )
        continue;
      const { frames: unused, focusFrame, ...text } = raw;
      void unused;
      moments.push({
        ...text,
        id: `moment-${moments.length + 1}`,
        evidenceFrames: frames,
        evidenceTimes: times,
        evidenceTime: analysis.sampleTimes[focusFrame - 1],
        start: Math.max(0, start - 0.8),
        end: Math.min(analysis.duration, end + 1.2),
      });
    }
    // Invalid evidence never turns into a plausible-looking replay card.
    if (parsed.moments.length && !moments.length) return null;
    return {
      version: 1,
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

export function coachingText(coaching: GuidedCoaching) {
  return [
    coaching.strength ? `**What went well**\n\n${coaching.strength}` : "",
    ...coaching.moments.map(
      (m, i) =>
        `**${i ? m.title : `Main improvement: ${m.title}`}**\n\n${m.observation} (${m.evidenceTime.toFixed(2)}s)\n\n**Try next:** ${m.cue}\n\n${m.check}`,
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
    const p = analysis.tracking.points.find(
      (p) => Math.abs(p.t - time) < 0.001,
    );
    return p ? [{ id: -1, x: p.x, y: p.y }] : [];
  }
  if (analysis.pose?.version !== 2) return [];
  const frame = analysis.pose.frames.find((f) => Math.abs(f.t - time) < 0.001);
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
