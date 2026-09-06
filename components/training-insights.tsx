"use client";
import { useState } from "react";
import type { JournalState } from "@/lib/model";
import { exerciseName } from "@/lib/domain";
import {
  formatSet,
  trainingSummary,
  weeklyVolume,
  workoutTotals,
} from "@/lib/training";
export function TrainingInsights({ state }: { state: JournalState }) {
  const summary = trainingSummary(state),
    weeks = weeklyVolume(state);
  const sessions = [...state.sessions].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const [left, setLeft] = useState(sessions[0]?.id ?? ""),
    [right, setRight] = useState(sessions[1]?.id ?? "");
  return (
    <div className="insights-stack">
      <section className="panel">
        <h2>Weekly training volume</h2>
        <p className="muted">
          Successful sets × weight × repetitions. Bodyweight work contributes
          sets and reps, with no added load.
        </p>
        {weeks.length ? (
          <div className="table-scroll">
            <table className="training-table">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th>Sessions</th>
                  <th>Sets</th>
                  <th>Volume · kg</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.week}>
                    <th>{w.week}</th>
                    <td>{w.sessions}</td>
                    <td>{w.sets}</td>
                    <td>{w.volume.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Your weekly totals will appear after your first session.</p>
        )}
      </section>
      <section className="panel">
        <h2>Rep records</h2>
        <p className="muted">
          The heaviest successful set at each rep count in your recorded
          history.
        </p>
        <div className="record-grid">
          {summary.records.map((r) => (
            <div key={`${r.exerciseId}:${r.reps}`}>
              <strong>{exerciseName(r.exerciseId)}</strong>
              <span>{formatSet(r.weight, r.reps)}</span>
              <small>{r.date}</small>
            </div>
          ))}
        </div>
        {!summary.records.length && (
          <p>Log a successful set to start tracking records.</p>
        )}
      </section>
      <section className="panel">
        <h2>Compare two sessions</h2>
        <div className="comparison-grid">
          {[
            { label: "First session", id: left, set: setLeft },
            { label: "Second session", id: right, set: setRight },
          ].map((side) => {
            const w = sessions.find((s) => s.id === side.id),
              totals = w ? workoutTotals(w) : null;
            return (
              <div key={side.label}>
                <label>
                  {side.label}
                  <select
                    value={side.id}
                    onChange={(e) => side.set(e.target.value)}
                  >
                    <option value="">Choose a session</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.date} · {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                {w && totals && (
                  <>
                    <p>
                      <strong>
                        {totals.sets} sets · {totals.volume.toLocaleString()} kg
                        volume
                      </strong>
                    </p>
                    {w.exercises.map((e) => (
                      <p key={e.id}>
                        <strong>{exerciseName(e.exerciseId)}</strong>
                        <br />
                        {e.sets
                          .map(
                            (s) =>
                              `${formatSet(s.weight, s.reps)}${s.result === "miss" ? " (miss)" : ""}`,
                          )
                          .join(" · ")}
                      </p>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
