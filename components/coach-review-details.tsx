"use client";
import type { PreviewEntry } from "@/lib/agent/actions";
import { formatSleepDuration } from "@/lib/health";
import { formatDuration } from "@/lib/cardio";
import { totalNutrients } from "@/lib/nutrition";
import { exerciseName } from "@/lib/domain";
import { MealDetails } from "./views/food";
import { CheckinDetails } from "./health";
import { CardioDetails } from "./cardio";
import { TrainingReviewDetails } from "./training-programs";

export function coachEntrySummary(entry: PreviewEntry) {
  if (entry.training) return entry.training.after.name;
  if (entry.meal)
    return `${entry.meal.date} · ${totalNutrients(entry.meal.items).calories} kcal${entry.meal.estimated ? " · estimated" : ""}`;
  if (entry.checkin)
    return `${entry.checkin.date}${entry.checkin.sleepHours == null ? "" : ` · ${formatSleepDuration(entry.checkin.sleepHours)} sleep`}`;
  if (entry.cardio)
    return `${entry.cardio.date} · ${formatDuration(entry.cardio.durationSeconds)}${entry.cardio.distanceKm == null ? "" : ` · ${entry.cardio.distanceKm} km`}`;
  return entry.workout
    ? `${entry.workout.date} · ${entry.workout.exercises.length} exercises`
    : "";
}
export function CoachEntryDetails({ entry }: { entry: PreviewEntry }) {
  return (
    <>
      {entry.training && <TrainingReviewDetails review={entry.training} />}
      {entry.meal && <MealDetails meal={entry.meal} />}
      {entry.checkin && (
        <>
          <p>{entry.checkin.date} · Check-in</p>
          <CheckinDetails checkin={entry.checkin} />
        </>
      )}
      {entry.cardio && <CardioDetails entry={entry.cardio} />}
      {entry.workout && (
        <>
          <p>
            <strong>{entry.workout.title}</strong> · {entry.workout.date}
          </p>
          {entry.workoutReview && (
            <p>
              <strong>
                {entry.workoutReview.status === "ongoing"
                  ? "Ongoing · continue in Train"
                  : "Completed · training history"}
              </strong>
            </p>
          )}
          {entry.workout.exercises.map((e) => (
            <div key={e.id}>
              <h3>{exerciseName(e.exerciseId)}</h3>
              <p>
                {e.sets
                  .map(
                    (s) =>
                      `${s.weight} kg × ${s.reps}${s.result === "miss" ? " (miss)" : ""}${s.rpe ? ` · RPE ${s.rpe}` : ""}`,
                  )
                  .join(" · ")}
              </p>
            </div>
          ))}
          {entry.workout.athleteNotes && <p>{entry.workout.athleteNotes}</p>}
        </>
      )}
      {entry.memory && (
        <div className="coach-review-context">
          <span className="eyebrow">{entry.memory.category}</span>
          <p>{entry.memory.text}</p>
        </div>
      )}
      {entry.plan && (
        <div className="coach-review-context">
          <h3>{entry.plan.title}</h3>
          <p>{entry.plan.notes}</p>
          <p>
            Follow-up from {entry.plan.followUpDate} · {entry.plan.status}
          </p>
          {entry.plan.outcome && <p>Outcome: {entry.plan.outcome}</p>}
        </div>
      )}
    </>
  );
}
