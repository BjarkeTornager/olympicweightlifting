"use client";
import { useState } from "react";
import { today } from "@/lib/domain";
import { weeklyReview } from "@/lib/weekly-review";
import { formatSleepDuration, offsetDate } from "@/lib/health";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { CoachEntryDetails } from "./coach-review-details";

export function WeeklyReview({
  journal,
  onAsk,
  busy,
}: {
  journal: JournalController;
  onAsk: (question: string) => void;
  busy: boolean;
}) {
  const [endDate, setEndDate] = useState(today());
  const [evidenceDate, setEvidenceDate] = useState<string | null>(null);
  const report = weeklyReview(journal.state!, endDate);
  const { current: week, previous } = report;
  const evidence = [...week.days, ...previous.days].find(
    (d) => d.date === evidenceDate,
  );
  const activity = week.strengthSessions + week.cardioSessions;
  const sleepChange = report.changes.sleepHours;
  return (
    <section className="weekly-review" aria-label="Your weekly review">
      <div className="coach-section-title">
        <div>
          <span className="eyebrow">A MOMENT TO REFLECT</span>
          <h2>Your week, with perspective.</h2>
        </div>
      </div>
      <div className="week-navigation">
        <Button
          variant="ghost"
          aria-label="Previous week"
          onClick={() => setEndDate(offsetDate(endDate, -7))}
        >
          ←
        </Button>
        <span>
          {week.from} – {week.to}
        </span>
        <Button
          variant="ghost"
          aria-label="Next week"
          disabled={endDate >= today()}
          onClick={() =>
            setEndDate(
              offsetDate(endDate, 7) > today()
                ? today()
                : offsetDate(endDate, 7),
            )
          }
        >
          →
        </Button>
      </div>
      <article className="week-reflection">
        <span className="eyebrow">WHAT YOU BUILT</span>
        <h3>
          {activity
            ? `${activity} recorded ${activity === 1 ? "session" : "sessions"} to build on.`
            : week.sleepNights || week.foodLoggedDays
              ? "Your entries are making the week easier to see."
              : "Your first entries will tell the story."}
        </h3>
        <p>
          {activity
            ? `${week.strengthSessions} strength and ${week.cardioSessions} cardio sessions in this window. Take a moment to notice what you enjoyed.`
            : "You can reflect on what felt good even when not everything made it into your journal."}
        </p>
      </article>
      <div className="week-stats">
        <article>
          <span>Sleep</span>
          <strong>
            {week.averageSleepHours == null
              ? "Not recorded"
              : formatSleepDuration(week.averageSleepHours)}
          </strong>
          <small>{week.sleepNights}/7 nights logged · average</small>
        </article>
        <article>
          <span>Food</span>
          <strong>
            {week.averageCalories == null
              ? "No complete days"
              : `${Math.round(week.averageCalories)} kcal`}
          </strong>
          <small>
            {week.completeFoodDays}/7 days marked complete ·{" "}
            {week.averageCalories == null ? "no intake average" : "average"}
          </small>
        </article>
        <article>
          <span>Training</span>
          <strong>{activity} logged</strong>
          <small>
            {week.strengthSessions} strength · {week.cardioSessions} cardio
          </small>
        </article>
      </div>
      <section className="week-changes">
        <h3>What changed</h3>
        <p>
          Compared with {previous.from} – {previous.to}.
        </p>
        <ul>
          <li>
            {sleepChange == null
              ? "There aren’t logged nights in both weeks to compare sleep."
              : `${formatSleepDuration(Math.abs(sleepChange))} ${sleepChange >= 0 ? "more" : "less"} sleep on average across logged nights (${week.sleepNights} this week; ${previous.sleepNights} before).`}
          </li>
          <li>
            {activity} recorded sessions this week;{" "}
            {previous.strengthSessions + previous.cardioSessions} in the
            previous window. Unlogged activity is unknown.
          </li>
          <li>
            {report.changes.calories == null
              ? "A food intake comparison needs explicitly complete days in both weeks."
              : `${Math.round(Math.abs(report.changes.calories))} kcal ${report.changes.calories >= 0 ? "higher" : "lower"} average across complete days (${week.completeFoodDays} this week; ${previous.completeFoodDays} before).`}
          </li>
        </ul>
        <p className="fine-print">
          Food is logged on {week.foodLoggedDays}/7 days. Partial days are
          excluded from intake averages.{" "}
          {week.estimatedCompleteDays > 0
            ? `${week.estimatedCompleteDays} complete days contain estimates. `
            : ""}
          Different coverage limits comparisons; changes alone do not explain
          why.
        </p>
      </section>
      <article className="week-next">
        <span className="eyebrow">ONE OPTIONAL ADJUSTMENT</span>
        <h3>Keep what fits. Change one thing.</h3>
        <p>
          {journal.state?.profile.coaching?.focus
            ? `Use your focus — ${journal.state.profile.coaching.focus} — to choose one manageable adjustment.`
            : "Pick one part of the week you’d like to make easier. Coach can help you choose a small experiment from your actual entries."}
        </p>
        <Button
          disabled={busy}
          onClick={() =>
            onAsk(
              `Review my seven days ending ${endDate} using weekly_review. Tell me one thing that went well, one meaningful change if the evidence supports it, and suggest ONE concrete, optional adjustment that fits my approved preferences and focus. Show the supporting dates, explain missing coverage once, and do not save a plan unless I agree.`,
            )
          }
        >
          Reflect with Coach
        </Button>
      </article>
      <details className="week-evidence">
        <summary>See the records behind this review</summary>
        <p className="fine-print">
          Open a date to see the source entries. Missing entries mean unknown,
          not zero.
        </p>
        {[week, previous].map((period) => (
          <div key={period.from}>
            <h3>
              {period.from} – {period.to}
            </h3>
            {period.days.map((day) => (
              <button
                className="week-evidence-row"
                key={day.date}
                onClick={() => setEvidenceDate(day.date)}
              >
                <strong>{day.date}</strong>
                <span>
                  {day.meals.length} meals ·{" "}
                  {day.foodComplete ? "complete" : "partial / unknown"}
                  <br />
                  {day.checkin?.sleepHours == null
                    ? "Sleep not recorded"
                    : formatSleepDuration(day.checkin.sleepHours)}{" "}
                  · {day.strength.length + day.cardio.length} sessions
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        ))}
      </details>
      <Dialog
        open={Boolean(evidence)}
        onOpenChange={(open) => {
          if (!open) setEvidenceDate(null);
        }}
        title={`Source records · ${evidenceDate ?? ""}`}
      >
        {evidence && (
          <div className="week-source-records">
            <p>
              Food day:{" "}
              {evidence.foodComplete ? "marked complete" : "partial or unknown"}
            </p>
            {evidence.meals.map((meal) => (
              <article key={meal.id}>
                <CoachEntryDetails
                  entry={{ title: meal.name, detail: "", workout: null, meal }}
                />
              </article>
            ))}
            {evidence.checkin && (
              <article>
                <CoachEntryDetails
                  entry={{
                    title: "Check-in",
                    detail: "",
                    workout: null,
                    checkin: evidence.checkin,
                  }}
                />
              </article>
            )}
            {evidence.strength.map((workout) => (
              <article key={workout.id}>
                <CoachEntryDetails
                  entry={{ title: workout.title, detail: "", workout }}
                />
              </article>
            ))}
            {evidence.cardio.map((cardio) => (
              <article key={cardio.id}>
                <CoachEntryDetails
                  entry={{ title: "Cardio", detail: "", workout: null, cardio }}
                />
              </article>
            ))}
            {!evidence.meals.length &&
              !evidence.checkin &&
              !evidence.strength.length &&
              !evidence.cardio.length && <p>No records for this date.</p>}
          </div>
        )}
      </Dialog>
    </section>
  );
}
