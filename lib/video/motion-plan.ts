import type { VideoAnalysis } from "./types";
import { visiblePoseAt } from "./correction";

// Repose only a visibly supported, bounded correction. The existing guide has
// already checked phase, camera, contacts and proportions. No LLM coordinates.
export function movementTargets(analysis: VideoAnalysis) {
  const moments = analysis.coaching?.moments ?? [];
  return moments
    .flatMap((moment) => {
      const preview = moment.correctionPreview;
      if (moment.certainty !== "clear" || preview?.status !== "available")
        return [];
      const ghost = preview.ghost;
      const ids = new Set(ghost.observed.map((p) => p.id));
      const reference = visiblePoseAt(analysis, ghost.referenceTime).filter(
        (p) => ids.has(p.id),
      );
      if (
        reference.length !== ghost.observed.length ||
        !["early_pull_posture", "jerk_dip_posture"].includes(moment.issue ?? "")
      )
        return [];
      return [
        {
          id: moment.id,
          issue: moment.issue!,
          referenceTime: ghost.referenceTime,
          focusTime: ghost.focusTime,
          side: ghost.side,
          reference,
          observed: ghost.observed,
          suggested: ghost.suggested,
        },
      ];
    })
    .slice(0, 1); // One main movement change, bounded GPU work per attempt.
}
