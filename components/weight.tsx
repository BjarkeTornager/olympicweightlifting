"use client";
import { today } from "@/lib/domain";
import { offsetDate } from "@/lib/health";
import { weighIns, weightTrend } from "@/lib/body-composition";
import { trendAgainstPlan, weightAlert } from "@/lib/weight-trend";
import type { JournalController } from "./journal";
import { ChevronRight, Scale } from "./ui/icons";

// The day of a weigh-in, said plainly: today, yesterday, or "Tue 30 Sep".
export function weighedOn(date: string, current: string) {
  if (date === current) return "Today";
  if (date === offsetDate(current, -1)) return "Yesterday";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Today's weight row: the latest weigh-in of the last 30 days with its day,
// the trend from four weeks of weigh-ins (weightTrend), how it compares
// with the goals plan once its targets have run 3 or 4 weeks, and a note
// on a fast loss or a low weight still coming down. Left out with no
// weigh-ins.
export function WeightRow({
  journal,
  go,
}: {
  journal: JournalController;
  go: (route: string) => void;
}) {
  const state = journal.state!;
  const date = today();
  const latest = weighIns(state, offsetDate(date, -30), date).at(-1);
  if (!latest) return null;
  const trend = weightTrend(state, date);
  const plan = trendAgainstPlan(state, date);
  const alert = weightAlert(state, date);
  return (
    <section className="list-card weight-row" aria-label="Your weight">
      <button className="list-row today-record" onClick={() => go("health")}>
        <Scale size={22} />
        <span>
          <strong>Weight</strong>
          <small>
            {weighedOn(latest.date, date)}
            {trend && ` · ${trend.summary}`}
          </small>
        </span>
        <span className="today-record-value">
          {latest.kg.toLocaleString("en-GB")} <small>kg</small>
        </span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
      {plan && <p className="fine-print">{plan.text}</p>}
      {alert && (
        <p className="notice warning" role="note" data-level={alert.level}>
          {alert.text}
        </p>
      )}
    </section>
  );
}
