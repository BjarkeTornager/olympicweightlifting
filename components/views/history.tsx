"use client";
import { CombineSessions } from "../combine-sessions";
import { useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Download,
  Dumbbell,
  Trash2,
} from "@/components/ui/icons";
import { backup, EXERCISES, exerciseName } from "@/lib/domain";
import type { JournalState, Workout } from "@/lib/model";
import type { JournalController } from "../journal";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { formatSet, startTemplate, templateFromWorkout } from "@/lib/training";
import { downloadBackup } from "@/lib/download-backup";
type Props = {
  state: JournalState;
  update: JournalController["update"];
  notify: (message: string) => void;
};
export function HistoryView({
  state,
  update,
  go,
  notify,
  sessionId,
}: Props & { go: (route: string) => void; sessionId?: string }) {
  const [filter, setFilter] = useState("all"),
    [date, setDate] = useState(
      () => state.sessions.find((s) => s.id === sessionId)?.date ?? "",
    ),
    [remove, setRemove] = useState<Workout | null>(null);
  const sessions = [...state.sessions]
    .filter(
      (s) =>
        (!date || s.date === date) &&
        (filter === "all" || s.exercises.some((e) => e.exerciseId === filter)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <div className="page-heading compact">
        <div>
          <h1>Training history</h1>
          <p className="lead">
            {state.sessions.length} saved strength sessions. Every one counts.
          </p>
        </div>
      </div>
      {state.activeWorkout && (
        <div className="history-resume">
          <Button onClick={() => go("workout")}>
            Resume ongoing workout <ArrowRight size={17} />
          </Button>
        </div>
      )}
      <div className="history-toolbar">
        <CombineSessions
          state={state}
          update={update}
          go={go}
          notify={notify}
        />
        <details className="history-filters">
          <summary>
            Filter history{date || filter !== "all" ? " •" : ""}
          </summary>
          <div className="picker-bar">
            <label>
              Exercise
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All exercises</option>
                {EXERCISES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Training date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <Button
              variant="ghost"
              onClick={() => {
                setDate("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          </div>
          <div className="button-row">
            <Button
              variant="ghost"
              onClick={() => downloadBackup(backup(state))}
            >
              <Download size={17} />
              Export journal
            </Button>
            <a className="text-link" href="#cardio">
              Cardio activity history <ArrowRight size={16} />
            </a>
          </div>
        </details>
      </div>
      {sessions.length ? (
        <div className="history-list">
          {sessions.map((s) => (
            <details
              className="panel history-detail"
              key={s.id}
              open={s.id === sessionId || undefined}
            >
              <summary>
                <span className="date-tile">
                  <strong>{s.date.slice(8)}</strong>
                  <small>
                    {new Date(s.date + "T12:00:00").toLocaleDateString(
                      "en-GB",
                      { month: "short" },
                    )}
                  </small>
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>
                    {s.date} ·{" "}
                    {s.exercises.reduce((n, e) => n + e.sets.length, 0)} sets ·{" "}
                    {s.recovery === "limited"
                      ? "Limited recovery"
                      : "Completed"}
                  </small>
                </span>
                <ChevronDown size={20} aria-hidden="true" />
              </summary>
              <div className="history-content">
                {s.exercises.map((e) => (
                  <div key={e.id} className="history-exercise">
                    <h3>{exerciseName(e.exerciseId)}</h3>
                    <div className="set-chips">
                      {e.sets.map((set) => (
                        <span
                          key={set.id}
                          className={set.result === "miss" ? "missed" : ""}
                        >
                          {formatSet(set.weight, set.reps)}
                          {set.result === "miss" ? " · miss" : ""}
                          {set.rpe ? ` · RPE ${set.rpe}` : ""}
                        </span>
                      ))}
                    </div>
                    {e.athleteNotes && <p>{e.athleteNotes}</p>}
                    {e.coachCue && (
                      <p className="muted">Coach cue: {e.coachCue}</p>
                    )}
                  </div>
                ))}
                {s.athleteNotes && (
                  <p>
                    <strong>Your notes:</strong> {s.athleteNotes}
                  </p>
                )}
                {s.coachNotes && (
                  <p>
                    <strong>Coach notes:</strong> {s.coachNotes}
                  </p>
                )}
                <div className="button-row">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (state.activeWorkout) {
                        notify(
                          "Finish or discard your current draft before editing another session.",
                        );
                        return;
                      }
                      await update((current) => {
                        current.activeWorkout = {
                          ...structuredClone(s),
                          id: crypto.randomUUID(),
                          editingSessionId: s.id,
                        };
                      });
                      go("workout");
                    }}
                  >
                    Edit session
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await update((current) => {
                          if (current.activeWorkout)
                            throw Error(
                              "Resume your unfinished workout first.",
                            );
                          current.activeWorkout = startTemplate(
                            templateFromWorkout(s),
                          );
                        });
                        go("workout");
                      } catch (e) {
                        notify(
                          e instanceof Error
                            ? e.message
                            : "Could not repeat session.",
                        );
                      }
                    }}
                  >
                    Repeat session
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await update((current) => {
                        current.templates = [
                          ...(current.templates ?? []),
                          templateFromWorkout(s),
                        ];
                      });
                      notify(
                        "Routine saved. Find it in Train → Your routines.",
                      );
                    }}
                  >
                    Save as routine
                  </Button>
                  <Button variant="danger" onClick={() => setRemove(s)}>
                    <Trash2 size={16} />
                    Delete
                  </Button>
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="panel empty">
          <Dumbbell size={36} />
          <h2>
            {state.sessions.length
              ? "No sessions match these filters."
              : "Your training story starts here."}
          </h2>
          <p>Start a session or import your existing journal from Settings.</p>
          <Button onClick={() => go("workout/choose")}>
            Choose a programme <ArrowRight size={18} />
          </Button>
        </div>
      )}
      <Dialog
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title="Delete this session?"
        description={`${remove?.title ?? ""} · ${remove?.date ?? ""}. This also changes the history used for future load targets. Export a backup first if you want a recovery copy.`}
      >
        <div className="button-row">
          <Button
            variant="danger"
            onClick={async () => {
              await update((s) => {
                s.sessions = s.sessions.filter((w) => w.id !== remove?.id);
              });
              setRemove(null);
              notify("Session deleted.");
            }}
          >
            Delete session
          </Button>
          <Button variant="secondary" onClick={() => setRemove(null)}>
            Keep session
          </Button>
        </div>
      </Dialog>
    </>
  );
}
