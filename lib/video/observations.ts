import type { VideoAnalysis } from "./types";
import { currentVideoReview } from "./coaching";

const labels = {
  pull: "Pull",
  front_rack_receive: "Front-rack receipt",
  front_rack_hold: "Front-rack hold",
  leg_drive_from_rack: "Dip and drive",
  overhead_receive: "Overhead receipt",
  direct_pull_to_overhead: "Pull to overhead",
};

// These are observations at identified source frames, never manufactured
// corrections. Un-timed phase checks cannot provide a new marker location.
export function timedObservations(analysis: VideoAnalysis | null) {
  if (!analysis || !currentVideoReview(analysis)) return [];
  const attempts = analysis.attempts?.length
    ? analysis.attempts
    : [
        {
          id: "review",
          start: 0,
          end: analysis.duration,
          identification: analysis.identification,
        },
      ];
  return attempts.flatMap((attempt) => {
    const phases = (attempt.identification?.phases ?? [])
      .filter(
        (p) =>
          Number.isFinite(p.time) &&
          p.time >= attempt.start &&
          p.time <= attempt.end,
      )
      .sort((a, b) => a.time - b.time);
    return phases.map((p, i) => ({
      id: `${attempt.id}-observation-${i}`,
      title: labels[p.kind],
      observation: p.evidence,
      time: p.time,
      start: Math.max(
        attempt.start,
        p.time - 0.6,
        i ? (phases[i - 1].time + p.time) / 2 : 0,
      ),
      end: Math.min(
        attempt.end,
        p.time + 0.8,
        i < phases.length - 1 ? (p.time + phases[i + 1].time) / 2 : Infinity,
      ),
    }));
  });
}
