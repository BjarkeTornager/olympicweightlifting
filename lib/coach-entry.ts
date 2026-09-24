import { liftingPrompt } from "./lifting-coach";
import { trainingPrograms } from "./training-programs";
import type { JournalState } from "./model";

const videoRoute = /^coach\/lifting\/(video|technique)$/;

// Turns a #coach/... link into what Coach should open with. A draft handed
// over in memory (never in the URL) takes precedence over a route prompt.
export function coachEntryIntent(
  route: string,
  state: JournalState,
  draft?: string,
) {
  return {
    initialCapture: route === "coach/capture",
    initialMemories:
      route === "coach/plans"
        ? ("plans" as const)
        : route === "coach/memories"
          ? ("memories" as const)
          : undefined,
    initialVideoReview: videoRoute.test(route),
    initialTrainingPrompt:
      draft ??
      (videoRoute.test(route)
        ? undefined
        : route.startsWith("coach/lifting/")
          ? liftingPrompt(route.split("/")[2])
          : route === "coach/training/new"
            ? "Help me build a reusable training program in Train. My goal is "
            : route.startsWith("coach/training/")
              ? `Update my saved training program “${trainingPrograms(state).find((p) => p.id === route.split("/")[2])?.name ?? "my program"}”: `
              : undefined),
    initialCardioLog:
      route === "coach/cardio" ||
      /^coach\/photo\/[^/]+\/cardio(?:\/log)?$/.test(route),
    initialActivityPhotoLog: /^coach\/photo\/[^/]+\/cardio\/log$/.test(route),
    initialSleepLog:
      route === "coach/sleep" || /^coach\/photo\/[^/]+\/sleep$/.test(route),
    initialPhotoId: route.startsWith("coach/photo/")
      ? route.split("/")[2]
      : undefined,
  };
}
