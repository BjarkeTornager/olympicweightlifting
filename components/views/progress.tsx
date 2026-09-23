"use client";
import { CardioProgress } from "../cardio";
import { useState } from "react";
import { TrendingUp } from "@/components/ui/icons";
import { exerciseName, PR_DEFINITIONS, today } from "@/lib/domain";
import { isValidLoggedSet } from "@/js/progression.js";
import type { JournalState } from "@/lib/model";
import type { JournalController } from "../journal";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { TrainingInsights } from "../training-insights";
type Props = {
  state: JournalState;
  update: JournalController["update"];
  notify: (message: string) => void;
};
export function ProgressView({ state, update, notify }: Props) {
  const [lift, setLift] = useState("snatch"),
    [range, setRange] = useState("90"),
    [editing, setEditing] = useState(false);
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - Number(range));
  const points = [...state.sessions]
    .filter(
      (s) =>
        s.date <= today() &&
        (range === "all" || new Date(s.date + "T12:00:00") >= minDate),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((s) => {
      const weights = s.exercises
        .filter((e) => e.exerciseId === lift)
        .flatMap((e) =>
          e.sets
            .filter((set) => isValidLoggedSet(set) && set.result !== "miss")
            .map((set) => Number(set.weight)),
        );
      return weights.length
        ? [{ date: s.date, weight: Math.max(...weights) }]
        : [];
    });
  const max = Math.max(1, ...points.map((p) => p.weight)) * 1.15,
    min = 0;
  const positions = points.map((p, i) => ({
    x: 50 + (points.length === 1 ? 0.5 : i / (points.length - 1)) * 680,
    y: 240 - ((p.weight - min) / (max - min)) * 210,
    ...p,
  }));
  const total = (state.prs.snatch ?? 0) + (state.prs.clean_and_jerk ?? 0);
  return (
    <>
      <div className="page-heading compact">
        <div>
          <h1>See your progress.</h1>
          <p className="lead">
            Your strength records and cardio activity, in one place.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit personal bests
        </Button>
      </div>
      <CardioProgress state={state} compact />
      <TrainingInsights state={state} />
      <div className="stats-grid">
        {[
          { label: "SNATCH", value: state.prs.snatch },
          { label: "CLEAN & JERK", value: state.prs.clean_and_jerk },
          { label: "TOTAL", value: total },
        ].map((item, i) => (
          <div
            className={`stat-card ${["blue", "red", "gold"][i]}`}
            key={item.label}
          >
            <span className="eyebrow">{item.label}</span>
            <div className="stat-number">
              {item.value || "—"}
              <span>kg</span>
            </div>
            <span className="muted">Personal best</span>
          </div>
        ))}
      </div>
      <section className="panel chart-panel">
        <div className="section-top">
          <div>
            <h2>Training load</h2>
            <p className="muted">Heaviest successful set in each session</p>
          </div>
          <TrendingUp size={20} />
        </div>
        <div className="picker-bar">
          <label>
            Lift
            <select value={lift} onChange={(e) => setLift(e.target.value)}>
              {PR_DEFINITIONS.slice(0, 6).map((p) => (
                <option key={p.exerciseId} value={p.exerciseId}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented">
            {[
              ["30", "30 days"],
              ["90", "90 days"],
              ["all", "All time"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={range === id}
                onClick={() => setRange(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {points.length ? (
          <>
            <svg
              className="progress-chart"
              viewBox="0 0 780 290"
              role="img"
              aria-label={`${exerciseName(lift)} training load: ${points.map((p) => `${p.date}: ${p.weight} kg`).join(", ")}`}
            >
              {[0, 1, 2, 3, 4].map((n) => (
                <g key={n}>
                  <line
                    x1="50"
                    x2="740"
                    y1={240 - n * 52.5}
                    y2={240 - n * 52.5}
                    stroke="#dde3e2"
                    strokeDasharray="4 6"
                  />
                  <text x="5" y={244 - n * 52.5} fill="#62717a" fontSize="13">
                    {Math.round((max * n) / 4)}
                  </text>
                </g>
              ))}
              <polyline
                points={positions.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#245d77"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              {positions.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="5"
                    fill="#245d77"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <title>
                    {p.date}: {p.weight} kg
                  </title>
                </g>
              ))}
              <text x="50" y="275" fill="#62717a" fontSize="13">
                {points[0].date}
              </text>
              <text
                x="730"
                y="275"
                textAnchor="end"
                fill="#62717a"
                fontSize="13"
              >
                {points.at(-1)?.date}
              </text>
            </svg>
            <details>
              <summary>View recorded values</summary>
              {points.map((p, i) => (
                <div className="load-row" key={i}>
                  <span>{p.date}</span>
                  <strong>{p.weight} kg</strong>
                </div>
              ))}
            </details>
          </>
        ) : (
          <div className="empty-inline">
            <TrendingUp size={36} />
            <h3>Your progress will take shape here.</h3>
            <p>
              Log successful sets for {exerciseName(lift).toLowerCase()} to
              begin.
            </p>
          </div>
        )}
      </section>
      <div className="section-top spaced">
        <h2>Personal bests</h2>
      </div>
      <div className="pr-list">
        {PR_DEFINITIONS.map((p) => (
          <div className="panel pr-row" key={p.exerciseId}>
            <span>{p.label}</span>
            <strong>
              {state.prs[p.exerciseId] || "—"}
              <small> kg</small>
            </strong>
          </div>
        ))}
      </div>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title="Your personal bests"
        description="Enter the lifts you have achieved. Leaving a field blank records no PR."
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await update((s) => {
              for (const p of PR_DEFINITIONS)
                s.prs[p.exerciseId] = Number(form.get(p.exerciseId) || 0);
            });
            setEditing(false);
            notify("Personal bests updated.");
          }}
        >
          <div className="form-grid">
            {PR_DEFINITIONS.map((p) => (
              <label key={p.exerciseId}>
                {p.label} · kg
                <input
                  name={p.exerciseId}
                  type="number"
                  min="0"
                  max="100000"
                  step="any"
                  defaultValue={state.prs[p.exerciseId] || ""}
                />
              </label>
            ))}
          </div>
          <Button type="submit" className="full">
            Save personal bests
          </Button>
        </form>
      </Dialog>
    </>
  );
}
