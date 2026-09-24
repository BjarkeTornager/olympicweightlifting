import type { ActionPreview } from "./agent/actions";

export const proposalExpired = (p: ActionPreview, now: number) =>
  new Date(p.expiresAt).getTime() < now;
export const proposalNeedsReview = (p: ActionPreview, now: number) =>
  !p.status && new Date(p.expiresAt).getTime() > now;

// Where "Open …" sends the athlete to see the entry this proposal changes.
export function proposalRoute(p: ActionPreview) {
  if (p.entries) return "today";
  if (p.liftingBrief !== undefined) return "workout/coaching";
  if (p.training) return "workout/choose";
  if (p.cardio) return "cardio";
  if (p.checkin) return "health";
  if (p.meal || p.targets) return "food";
  if (p.workoutReview)
    return p.workoutReview.status === "ongoing" ? "workout" : "history";
  return p.workout?.exercises.some((e) => e.sets.some((s) => !s.result))
    ? "workout"
    : "history";
}
export function proposalRouteLabel(p: ActionPreview) {
  if (p.liftingBrief !== undefined) return "Open lifting coach";
  if (p.training) return "Open Train";
  if (p.workoutReview?.status === "ongoing") return "Open ongoing workout";
  if (p.workoutReview) return "Open training history";
  return "Open journal";
}
