"use client";
import { ArrowRight, Check, ChevronDown, Undo2 } from "@/components/ui/icons";
import type { ActionPreview } from "@/lib/agent/actions";
import { exerciseName } from "@/lib/domain";
import { formatSet } from "@/lib/training";
import { Button } from "./ui/button";
import { MealDetails } from "./views/food";
import { CardioDetails } from "./cardio";
import { CheckinDetails } from "./health";
import { CoachEntryDetails, coachEntrySummary } from "./coach-review-details";

export const proposalExpired = (p: ActionPreview, now: number) =>
  new Date(p.expiresAt).getTime() < now;
export const proposalNeedsReview = (p: ActionPreview, now: number) =>
  !p.status && new Date(p.expiresAt).getTime() > now;

// Where "Open …" sends the athlete to see the entry this proposal changes.
function proposalRoute(p: ActionPreview) {
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
function proposalRouteLabel(p: ActionPreview) {
  if (p.liftingBrief !== undefined) return "Open lifting coach";
  if (p.training) return "Open Train";
  if (p.workoutReview?.status === "ongoing") return "Open ongoing workout";
  if (p.workoutReview) return "Open training history";
  return "Open journal";
}
function bundleEntryTitle(
  entry: NonNullable<ActionPreview["entries"]>[number],
) {
  if (entry.meal) return `${entry.meal.name} · ${entry.meal.type}`;
  if (entry.checkin) return `${entry.title} · ${entry.checkin.date}`;
  if (entry.cardio) return entry.title;
  return entry.workout?.title ?? entry.title;
}

export function CoachProposal({
  proposal: p,
  accountId,
  now,
  ready,
  pending,
  busy,
  acting,
  onApply,
  onOpenMemories,
  go,
}: {
  proposal: ActionPreview;
  accountId?: string;
  now: number;
  ready: boolean;
  pending: boolean;
  busy: boolean;
  acting: string | null;
  onApply: (proposal: ActionPreview, undo?: boolean) => void;
  onOpenMemories: (tab: "memories" | "plans") => void;
  go: (route: string) => void;
}) {
  return (
    <section
      className={`agent-proposal ${p.status ?? "pending"}`}
      aria-label={
        p.status === "saved" && p.automatic
          ? "Saved journal entry"
          : "Review journal change"
      }
      data-needs-review={proposalNeedsReview(p, now)}
    >
      <details
        key={`${p.id}-${p.status ?? "pending"}`}
        open={p.status ? undefined : true}
      >
        <summary className="proposal-summary">
          <span className="eyebrow">
            {p.status === "saved"
              ? "SAVED"
              : p.status === "undone"
                ? "UNDONE"
                : "REVIEW BEFORE SAVING"}
          </span>
          <h2>{p.title}</h2>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="proposal-body">
          <p>{p.detail}</p>
          {p.entries && (
            <div className="coach-bundle">
              {p.entries.map((entry, i) => (
                <details key={i} className="coach-bundle-entry">
                  <summary>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{bundleEntryTitle(entry)}</strong>
                      <small>{coachEntrySummary(entry)}</small>
                    </div>
                    <ChevronDown size={16} />
                  </summary>
                  <div>
                    <p className="fine-print">{entry.detail}</p>
                    <CoachEntryDetails entry={entry} accountId={accountId} />
                  </div>
                </details>
              ))}
            </div>
          )}
          {(p.memory ||
            p.plan ||
            p.training ||
            p.liftingBrief !== undefined) && (
            <CoachEntryDetails
              entry={{
                title: p.title,
                detail: p.detail,
                workout: null,
                memory: p.memory,
                plan: p.plan,
                training: p.training,
                liftingBrief: p.liftingBrief,
              }}
            />
          )}
          {p.cardio && <CardioDetails entry={p.cardio} accountId={accountId} />}
          {p.checkin && (
            <>
              <p className="proposal-date">Check-in · {p.checkin.date}</p>
              <CheckinDetails checkin={p.checkin} />
            </>
          )}
          {p.meal && <MealDetails meal={p.meal} />}
          {p.targets && (
            <div className="meal-details">
              <p>Goal: {p.targets.goal} weight</p>
              {(["calories", "protein", "carbs", "fat"] as const).map((key) => (
                <p key={key}>
                  {key}: {p.targets![key] ?? "No target"}
                  {p.targets![key] != null
                    ? key === "calories"
                      ? " kcal"
                      : " g"
                    : ""}
                </p>
              ))}
            </div>
          )}
          {p.workout && (
            <>
              <div className="proposal-date">
                <strong>{p.workout.title}</strong>
                <span>{p.workout.date}</span>
              </div>
              {p.workoutReview && (
                <p className="workout-review-status">
                  <strong>
                    {p.workoutReview.status === "ongoing"
                      ? "Ongoing · continue in Train"
                      : "Completed · training history"}
                  </strong>
                </p>
              )}
              {p.workoutReview?.sources && (
                <div className="workout-merge-sources">
                  <strong>Entries being combined</strong>
                  <ul>
                    {p.workoutReview.sources.map((source) => (
                      <li key={source.id}>
                        {source.title} · {source.date} · {source.sets} sets
                      </li>
                    ))}
                  </ul>
                  <p>
                    All sets and notes are retained. These entries become one
                    workout.
                  </p>
                </div>
              )}
              {p.workout.exercises.map((e) => (
                <div className="proposal-exercise" key={e.id}>
                  <h3>{exerciseName(e.exerciseId)}</h3>
                  <div className="set-chips">
                    {e.sets.map((s) => (
                      <span key={s.id}>
                        {formatSet(s.weight, s.reps)}
                        {s.result === "miss"
                          ? " · miss"
                          : s.result
                            ? " · made"
                            : " · planned"}
                        {s.rpe ? ` · RPE ${s.rpe}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {p.workout.athleteNotes && <p>{p.workout.athleteNotes}</p>}
            </>
          )}
          <div className="button-row">
            {!p.status && (
              <Button
                disabled={
                  !ready || Boolean(acting) || busy || proposalExpired(p, now)
                }
                onClick={() => onApply(p)}
              >
                <Check size={17} />
                {acting === p.id
                  ? "Saving…"
                  : p.entries
                    ? `Save all ${p.entries.length} entries`
                    : "Save this change"}
              </Button>
            )}
            {p.status === "saved" && !p.automatic && (
              <Button
                variant="secondary"
                disabled={pending || Boolean(acting) || busy}
                onClick={() => onApply(p, true)}
              >
                <Undo2 size={17} />
                {p.entries ? "Undo all entries" : "Undo this change"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                p.memory || p.plan
                  ? onOpenMemories(p.plan ? "plans" : "memories")
                  : go(proposalRoute(p))
              }
            >
              {proposalRouteLabel(p)} <ArrowRight size={17} />
            </Button>
          </div>
          <p className="fine-print">
            {p.status
              ? "Undo is available for 24 hours while no later journal change has been saved."
              : `Proposal expires ${new Date(p.expiresAt).toLocaleString()}. A newer journal change requires a fresh proposal.`}
          </p>
        </div>
      </details>
      {p.status === "saved" && p.automatic && (
        <div className="button-row coach-saved-actions">
          <span className="fine-print">Saved to your account</span>
          <Button
            variant="ghost"
            disabled={
              pending || Boolean(acting) || busy || proposalExpired(p, now)
            }
            onClick={() => onApply(p, true)}
          >
            <Undo2 size={17} />
            {acting === p.id
              ? "Undoing…"
              : p.entries
                ? "Undo all entries"
                : "Undo"}
          </Button>
        </div>
      )}
      {p.status === "saved" && p.workoutReview && (
        <Button
          className="saved-workout-link"
          variant="ghost"
          onClick={() =>
            go(p.workoutReview!.status === "ongoing" ? "workout" : "history")
          }
        >
          {p.workoutReview.status === "ongoing"
            ? "Continue workout"
            : "View training history"}{" "}
          <ArrowRight size={17} />
        </Button>
      )}
    </section>
  );
}
