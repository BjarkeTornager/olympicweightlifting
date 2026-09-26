import { coachTasks } from "./coach-tasks";
import { trainingPrograms } from "./training-programs";
import type { JournalState } from "./model";

const videoRoute = /^coach\/lifting\/(video|technique)$/;

// Turns a #coach/... link into what Coach should open with. A draft handed
// over in memory (never in the URL) is kept alongside any route task.
export function coachEntryIntent(
  route: string,
  state: JournalState,
  draft?: string,
) {
  return {
    initialCapture: route === "coach/capture",
    initialVoice: route === "coach/voice",
    initialMemories:
      route === "coach/plans"
        ? ("plans" as const)
        : route === "coach/memories"
          ? ("memories" as const)
          : undefined,
    initialVideoReview: videoRoute.test(route),
    // A draft handed over from another screen is the person's own question.
    initialTrainingPrompt: draft,
    initialTask: videoRoute.test(route)
      ? undefined
      : route.startsWith("coach/lifting/")
        ? coachTasks.lifting(route.split("/")[2])
        : route === "coach/training/new"
          ? coachTasks.newProgram()
          : route.startsWith("coach/training/")
            ? coachTasks.editProgram(
                trainingPrograms(state).find(
                  (p) => p.id === route.split("/")[2],
                )?.name ?? "my program",
              )
            : undefined,
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
