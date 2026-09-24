import type { JournalState } from "../model";
import { readFoodPhoto } from "../food-photos";
import { readUserImage } from "../user-images";
import { activityLoggingPrompt } from "../images";
import { prepareFoodTags } from "./food-tags";
import type { ActionPreview, AgentAction } from "./actions";
import type { TurnReads } from "./read-tools";

type BundleEntry = Extract<
  AgentAction,
  { kind: "record_bundle" }
>["entries"][number];
export type GuardedAction = AgentAction | BundleEntry;

export type ChangeGuardContext = {
  userId: string;
  state: JournalState;
  reads: TurnReads;
  // Image IDs whose pixels reached a model call in this turn.
  viewedImageIds: Set<string>;
  // The athlete's message for this turn.
  message: string;
  // Earlier turns, oldest first, for photos kept on an unsaved meal review.
  recent: { status: string; proposals?: ActionPreview[] }[];
  saving: boolean;
  liftingBriefReview?: boolean;
};

const memoryKinds = [
  "save_memory",
  "forget_memory",
  "save_plan",
  "delete_plan",
  "dismiss_plan",
];
const covers = (ranges: { from: string; to: string }[], date: string) =>
  ranges.some((r) => r.from <= date && r.to >= date);

// Refuses a change built on records the model has not read in this turn, and
// normalises meal photo sources and food tags. Throws a message for the model.
export async function guardChange(
  action: GuardedAction,
  ctx: ChangeGuardContext,
) {
  const { userId, state, reads, viewedImageIds } = ctx;
  if (
    ctx.saving &&
    (action.kind === "record_meal" || action.kind === "repeat_meal")
  ) {
    const mealDate =
      action.kind === "record_meal" ? action.meal.date : action.date;
    if (!covers(reads.foodRanges, mealDate))
      throw Error(
        "Read food_journal for this meal's date without filters before logging, to check for an existing meal. Correct existing meals with update_meal; do not log the same report again.",
      );
  }
  if ("routineId" in action && !reads.routines.has(action.routineId))
    throw Error(
      "Read the full original routine using training_library with routineId before editing, deleting or starting it.",
    );
  if (
    "trainingProgramId" in action &&
    !reads.programs.has(action.trainingProgramId)
  )
    throw Error(
      "Read the full original program using training_library with programId before editing, deleting or starting it.",
    );
  if (
    (action.kind === "start_routine" || action.kind === "start_training_day") &&
    !reads.draft
  )
    throw Error(
      "Read current_workout before starting a routine or program day.",
    );
  if (memoryKinds.includes(action.kind) && !reads.coachMemory)
    throw Error("Read coach_memory before preparing this change.");
  if (action.kind === "set_lifting_brief") {
    if (ctx.liftingBriefReview === false)
      throw Error(
        "Refresh the app to review all lifting brief details before changing them.",
      );
    if (!reads.liftingReview)
      throw Error(
        "Read lifting_review before updating the lifting brief; preserve unchanged reported fields.",
      );
  }
  if (action.kind === "repeat_meal" && !reads.meals.has(action.mealId))
    throw Error("Read the original meal or favourite first.");
  if (
    action.kind === "record_checkin" &&
    !reads.healthDates.has(action.checkin.date)
  )
    throw Error(
      "Read the health overview for this check-in date first, then preserve values the athlete hasn’t changed.",
    );
  if (
    action.kind === "record_cardio" &&
    !covers(reads.cardioRanges, action.cardio.date)
  )
    throw Error(
      "Read the cardio journal for this date without an activity filter first to check existing activities.",
    );
  if (
    (action.kind === "update_cardio" || action.kind === "delete_cardio") &&
    !reads.cardio.has(action.cardioId)
  )
    throw Error("Read the full original cardio activity first.");
  if (action.kind === "record_cardio" || action.kind === "update_cardio") {
    const original =
      action.kind === "update_cardio"
        ? state.cardio.sessions.find((entry) => entry.id === action.cardioId)
        : undefined;
    const sources =
      (action.kind === "record_cardio"
        ? action.cardio.photoIds
        : action.changes.photoIds) ??
      original?.photoIds ??
      [];
    const allowed = new Set([...viewedImageIds, ...(original?.photoIds ?? [])]);
    if (!sources.length && ctx.message === activityLoggingPrompt(true))
      throw Error(
        "This is a photo logging request. Include the inspected source image in cardio.photoIds; ask for clarification if it does not show a readable completed activity.",
      );
    if (sources.some((id) => !allowed.has(id)))
      throw Error(
        "Read this activity photo with inspect_images before logging its measurements. Catalog metadata alone is not visual evidence.",
      );
    for (const id of sources) {
      const image = await readUserImage(userId, id);
      if (!["activity", "health", "unclassified"].includes(image.category))
        throw Error(
          "Use an activity screenshot, not a food, sleep or unrelated image, as the source of an activity.",
        );
    }
  }
  if (action.kind === "update_meal" && !reads.meals.has(action.mealId))
    throw Error("Read the full original meal first.");
  if (action.kind === "set_diet_targets" && !reads.food)
    throw Error("Read current nutrition targets first.");
  if (action.kind === "record_meal" || action.kind === "update_meal") {
    // Sources may be attached, inspected in this turn, or retained
    // from an owned meal/pending review. Catalog metadata is not pixels.
    const previous =
      ctx.recent
        .filter((r) => r.status === "done")
        .at(-1)
        ?.proposals?.filter(
          (p) => !p.status && new Date(p.expiresAt).getTime() > Date.now(),
        )
        .flatMap((p) => [
          ...(p.meal ? [p.meal] : []),
          ...(p.entries ?? []).flatMap((e) => (e.meal ? [e.meal] : [])),
        ]) ?? [];
    const original =
      action.kind === "update_meal"
        ? state.nutrition.meals.find((m) => m.id === action.mealId)
        : undefined;
    const allowed = new Set([
      ...viewedImageIds,
      ...previous.flatMap((meal) => meal.photoIds),
      ...(original?.photoIds ?? []),
    ]);
    if (action.meal.photoIds.some((id) => !allowed.has(id)))
      throw Error(
        "Use Food photos attached to this message, read with inspect_images in this turn, or already linked to this meal or pending review. For a saved catalog photo, call inspect_images and read its returned pixels before preparing the meal; no re-upload is needed.",
      );
    await Promise.all(
      action.meal.photoIds.map((id) => readFoodPhoto(userId, id)),
    );
    if (
      !action.meal.photoIds.length &&
      (action.meal.source === "photo" ||
        (action.kind === "record_meal" &&
          viewedImageIds.size > 0 &&
          action.meal.items.some((item) =>
            item.classification?.ingredients.some(
              (tag) => tag.evidence === "label" || tag.evidence === "visible",
            ),
          )))
    )
      throw Error(
        "A meal based on a food image must link its source photo in meal.photoIds, including when ingredients were read from a label. Use the relevant attached or inspected Food photo ID.",
      );
    action.meal.items = prepareFoodTags(action.meal.items, {
      newMeal: action.kind === "record_meal",
      viewedImages: action.meal.photoIds.some((id) => viewedImageIds.has(id)),
      previous: original?.items ?? previous.flatMap((meal) => meal.items),
    });
    // Provider estimates are always labelled as estimates, regardless of model flags.
    action.meal.estimated = true;
    action.meal.source = action.meal.photoIds.length ? "photo" : "text";
  }
  if (
    (action.kind === "update_session" ||
      action.kind === "log_workout_progress") &&
    action.sessionId &&
    !reads.sessions.has(action.sessionId)
  )
    throw Error("Read the full original session first.");
  if (
    action.kind === "merge_sessions" &&
    action.sessionIds.some((id) => !reads.sessions.has(id))
  )
    throw Error(
      "Read every full source session before combining them. Preserve all reported sets and notes; never deduplicate equal weights/reps.",
    );
  if (
    (action.kind === "record_session" ||
      action.kind === "log_workout_progress") &&
    !covers(reads.trainingRanges, action.workout.date)
  )
    throw Error(
      "Read find_sessions for this workout date without an exercise filter first, so an existing workout is not split or duplicated.",
    );
  if (
    (action.kind === "record_session" ||
      action.kind === "log_workout_progress" ||
      action.kind === "merge_sessions" ||
      action.kind === "log_sets" ||
      action.kind === "finish_workout") &&
    !reads.draft
  )
    throw Error("Read the current workout first.");
}
