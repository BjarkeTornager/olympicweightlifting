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
export type CoachingMoment = Omit<z.infer<typeof momentSchema>, "frames"> & {
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

export const guidedCoachingInstruction = `Return JSON only, with this exact structure:
{"strength":"one supported strength, or empty","limitation":"what this view cannot establish, or empty","moments":[{"title":"short coaching priority","observation":"what is visibly happening","cue":"one thing to try next","check":"how to check the next attempt","frames":[1,2],"region":"whole_lift|shoulders|elbows|hips|knees|feet|bar"}]}.
Put the single most useful improvement first. Include at most two supporting moments and never manufacture a fault to fill the list. Use only printed 1-based frame labels from the supplied images as evidence; each moment must refer to one brief event, spanning no more than five seconds. All these frames must visibly support the observation. The replay will highlight the selected body region only where independent pose tracking is available. You cannot supply coordinates, angles, a perfect trajectory, or unobserved movement. Distinguish observations from possible causes. If no correction is justified, return moments=[] and explain why in limitation. Do not ask questions or require the user to choose a lift before providing supported feedback.`;

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
      if (end - start > 5) continue;
      const { frames: unused, ...text } = raw;
      void unused;
      moments.push({
        ...text,
        id: `moment-${moments.length + 1}`,
        evidenceFrames: frames,
        evidenceTimes: times,
        evidenceTime: start,
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
