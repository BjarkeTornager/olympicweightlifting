import type { SavedVideoReview } from "./types";
import type { GuidedCoaching } from "./coaching";

// Callers must supply only reviews selected for the authenticated owner. Do not
// infer improvement from a stored cue: it is context, not paired image evidence.
export function previousVideoFocus(
  reviews: SavedVideoReview[],
  current: { id: string; createdAt: string; lift: string | null },
): GuidedCoaching["previousFocus"] {
  const currentTime = Date.parse(current.createdAt);
  if (!current.lift || !Number.isFinite(currentTime)) return;
  for (const review of [...reviews].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )) {
    const age = currentTime - Date.parse(review.createdAt);
    if (
      review.id === current.id ||
      review.status !== "ready" ||
      !(age > 0 && age <= 30 * 86400000)
    )
      continue;
    const analysis = review.analysis;
    const coaching =
      analysis?.attempts?.find((a) => a.identification.lift === current.lift)
        ?.coaching ??
      (analysis?.identification?.lift === current.lift
        ? analysis?.coaching
        : undefined);
    const moment = coaching?.moments.find(
      (m) => m.certainty === "clear" && m.issue && m.issue !== "other",
    );
    if (moment)
      return {
        reviewId: review.id,
        date: review.date,
        title: moment.title,
        cue: moment.cue,
        check: moment.check,
      };
  }
}
