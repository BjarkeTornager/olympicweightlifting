import { z } from "zod";
import {
  identificationMessages,
  identifyLift,
  respectSelectedLift,
  type LiftIdentification,
} from "./identification";
import type { VideoAnalysis, VideoUpload } from "./types";
import type { GuidedCoaching } from "./coaching";

export type VideoAttempt = {
  id: string;
  start: number;
  end: number;
  identification: LiftIdentification;
  coaching?: GuidedCoaching;
};
const attemptsSchema = z
  .object({
    attempts: z
      .array(
        z
          .object({
            startFrame: z.number().int().min(1),
            endFrame: z.number().int().min(1),
            evidence: z.unknown(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

export function attemptMessages(analysis: VideoAnalysis, frames: string[]) {
  const messages = identificationMessages(analysis, frames);
  const original = messages[0].content;
  const shapeStart = original.indexOf("Return JSON only:"),
    shapeEnd = original.indexOf("\nDefinitions:");
  messages[0].content =
    original.slice(0, shapeStart) +
    `Return JSON only: {"attempts":[{"startFrame":1,"endFrame":48,"evidence":{"visibility":"sufficient|limited|not_lifting","phases":[{"kind":"pull|front_rack_receive|front_rack_hold|leg_drive_from_rack|overhead_receive|direct_pull_to_overhead","frame":1,"evidence":"brief visible observation"}],"limitation":"what cannot be seen"}}]}.
Find up to three attempts across the full video, including partial attempts whose setup or finish is outside the clip. Retain visible phase observations for partial attempts and mark visibility=limited; missing earlier movement must not discard visible later positions. Separate attempts only when the lifter actually starts another repetition. Never split the clean and the later jerk into separate attempts; include the rack pause, recovery and the overhead action together. startFrame/endFrame enclose all visible parts of the attempt using printed frame labels. Each evidence phase belongs inside its attempt's range. Ranges must be chronological and non-overlapping. If more than three repetitions or boundaries cannot be established, return one limited attempt explaining that a shorter clip is needed. Do not invent a lift when no lifting is visible. Each attempt's evidence obeys these definitions:` +
    original
      .slice(shapeEnd)
      .replace(
        "multiple repetitions, ",
        "mixed repetitions within one attempt, ",
      );
  return messages;
}

export function identifyAttempts(
  content: string,
  analysis: VideoAnalysis,
  selected: VideoUpload["lift"],
): VideoAttempt[] {
  const invalid = (): VideoAttempt[] => [
    {
      id: "attempt-1",
      start: 0,
      end: analysis.duration,
      identification: {
        version: 1,
        lift: null,
        status: "uncertain",
        phases: [],
        reason:
          "Coach could not separate the movement reliably. Try a clip containing one complete lift, including any later jerk.",
      },
    },
  ];
  try {
    const parsed = attemptsSchema.parse(
      JSON.parse(
        content
          .trim()
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, ""),
      ),
    );
    let previousEnd = -1;
    const attempts = parsed.attempts.map((a, i) => {
      const start = analysis.sampleTimes[a.startFrame - 1],
        end = analysis.sampleTimes[a.endFrame - 1];
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start <= previousEnd ||
        end <= start ||
        end > analysis.duration + 0.05
      )
        throw Error("Invalid attempt bounds");
      previousEnd = end;
      const identification = respectSelectedLift(
        identifyLift(JSON.stringify(a.evidence), analysis),
        selected,
      );
      if (identification.phases.some((p) => p.time < start || p.time > end))
        throw Error("Evidence outside attempt");
      return { id: `attempt-${i + 1}`, start, end, identification };
    });
    // A split clean/rack/jerk is exactly the mistake this flow must avoid.
    // Without explicit evidence of a reset, do not publish two confident reviews.
    if (
      attempts.some(
        (a, i) =>
          a.identification.lift === "Clean" &&
          attempts[i + 1]?.identification.lift === "Jerk",
      )
    )
      return invalid();
    return attempts;
  } catch {
    return invalid();
  }
}
