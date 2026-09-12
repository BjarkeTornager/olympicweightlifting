import type { VideoAnalysis, SavedVideoReview } from "../../lib/video/types";
import { buildPostureGhost } from "../../lib/video/correction";

// Synthetic geometry used only for engineering checks, never a validated lift.
export function correctionAnalysis(): VideoAnalysis {
  const point = (id: number, x: number, y: number) => ({
    id,
    x: x / 320,
    y: y / 480,
  });
  const reference = [
    point(11, 160, 156),
    point(12, 168, 156),
    point(13, 210, 211),
    point(15, 190, 176),
    point(23, 160, 276),
    point(25, 160, 360),
    point(27, 160, 420),
    point(29, 150, 430),
    point(31, 190, 430),
  ];
  const focus = [
    point(
      11,
      160 + 120 * Math.sin(Math.PI / 18),
      300 - 120 * Math.cos(Math.PI / 18),
    ),
    point(
      12,
      168 + 120 * Math.sin(Math.PI / 18),
      300 - 120 * Math.cos(Math.PI / 18),
    ),
    point(13, 210, 235),
    point(15, 190, 200),
    point(23, 160, 300),
    point(25, 160, 360),
    point(27, 160, 420),
    point(29, 150, 430),
    point(31, 190, 430),
  ];
  return {
    version: 1,
    reviewVersion: 2,
    width: 320,
    height: 480,
    duration: 2,
    frameCount: 60,
    sampleTimes: [0, 0.5, 1, 1.5],
    identification: {
      version: 1,
      status: "supported",
      lift: "Jerk",
      reason: "Synthetic separate dip and overhead receipt.",
      phases: [
        {
          kind: "leg_drive_from_rack",
          time: 1.2,
          frame: 4,
          evidence: "Synthetic dip and drive from shoulders.",
        },
      ],
    },
    pose: {
      version: 2,
      status: "tracked",
      reason: "Synthetic points",
      frames: [
        { t: 0.5, points: reference },
        { t: 1, points: focus },
      ],
    },
    tracking: {
      status: "not_requested",
      reason: "",
      points: [],
      coverage: 0,
      horizontalRangeCm: null,
      riseCm: null,
      peakUpwardVelocity: null,
      velocities: [],
    },
  };
}
export function correctionReview(): SavedVideoReview {
  const analysis = correctionAnalysis();
  const moment = {
    id: "priority-1",
    title: "Keep your dip upright",
    issue: "jerk_dip_posture" as const,
    why: "A steadier dip gives you a consistent position to drive from.",
    observation:
      "The trunk leans forward between the rack hold and bottom of the dip.",
    cue: "Dip straight down with the rack settled.",
    practice: "Rehearse a few controlled dips with an empty bar.",
    check:
      "Compare your torso position in the hold and bottom of the next dip.",
    certainty: "clear" as const,
    drill: "jerk_dip" as const,
    evidenceFrames: [2, 3],
    evidenceTimes: [0.5, 1],
    evidenceTime: 1,
    start: 0.35,
    end: 1.5,
    region: "shoulders" as const,
    evidenceType: "movement" as const,
  };
  analysis.coaching = {
    version: 2,
    strength: "The front rack is visible.",
    limitation: "Synthetic fixture, not a real technique assessment.",
    checks: [
      {
        phase: "dip_drive",
        status: "reviewed",
        observation: "Both the hold and dip are visible.",
      },
    ],
    moments: [
      {
        ...moment,
        correctionPreview: buildPostureGhost(analysis, moment, {
          kind: "preserve_torso",
          referenceFrame: 2,
          view: "side",
        }),
      },
    ],
  };
  return {
    id: "00000000-0000-4000-8000-000000000098",
    lift: "Jerk",
    date: "2026-09-12",
    load: "",
    status: "ready",
    stage: "Review ready",
    createdAt: "2026-09-12T12:00:00Z",
    error: null,
    feedback: "Synthetic coaching",
    hasMedia: true,
    analysis,
  };
}
