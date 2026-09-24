"use client";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Plus,
} from "@/components/ui/icons";
import { LogbookIcon, TickedLogIcon, WhistleIcon } from "../ui/journal-icons";
import { days, today, program, exerciseName } from "@/lib/domain";
import { planProgramDay } from "@/js/progression.js";
import type { JournalState } from "@/lib/model";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { NextSession } from "../next-session";
import { Templates } from "../templates";
import { LiftingCoach } from "../lifting-coach";
import { TrainingPrograms } from "../training-programs";
import { ActivityPhotoUpload } from "../activity-photo-upload";
import { ActiveWorkout } from "../active-workout";
import { Technique } from "../technique";
type Update = (
  fn: (state: JournalState) => JournalState | void,
) => Promise<void>;
type Props = {
  accountId: string;
  state: JournalState;
  update: Update;
  route: string;
  go: (route: string) => void;
  onStart: (id: string, date?: string) => Promise<void>;
  notify: (message: string) => void;
};

export function Workouts(props: Props) {
  const { state, route, onStart, go, notify } = props;
  const [date, setDate] = useState(today),
    [filter, setFilter] = useState("all");
  const [finishedPrs, setFinishedPrs] = useState<[string, number][] | null>(
    null,
  );
  const settlingPrs = useRef(false);
  const parameter = route.split("/")[1];
  const day = days.find((d) => d.id === parameter);
  const settlePrs = async (usePrs: boolean) => {
    const candidates = finishedPrs;
    if (settlingPrs.current || !candidates?.length) return;
    settlingPrs.current = true;
    setFinishedPrs(null);
    try {
      if (usePrs)
        await props.update((current) => {
          for (const [id, weight] of candidates) current.prs[id] = weight;
        });
      go("history");
      notify(
        usePrs
          ? "Workout finished. Personal bests updated."
          : "Workout finished.",
      );
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Could not update personal bests.",
      );
      go("history");
    } finally {
      settlingPrs.current = false;
    }
  };
  const prDialog = (
    <Dialog
      open={Boolean(finishedPrs?.length)}
      onOpenChange={(open) => {
        if (!open && finishedPrs?.length) void settlePrs(false);
      }}
      title="Workout finished"
      description="Your logged sets are in History. Confirm any new personal bests."
    >
      <div>
        {(finishedPrs ?? []).map(([id, weight]) => (
          <div className="load-row" key={id}>
            <span>{exerciseName(id)}</span>
            <strong>{weight} kg</strong>
          </div>
        ))}
      </div>
      <div className="button-row">
        <Button onClick={() => void settlePrs(true)}>
          Update personal bests
        </Button>
        <Button variant="secondary" onClick={() => void settlePrs(false)}>
          Keep current PRs
        </Button>
      </div>
    </Dialog>
  );
  if (parameter === "coaching")
    return <LiftingCoach state={state} update={props.update} go={go} />;
  if (state.activeWorkout && !parameter)
    return (
      <>
        <ActiveWorkout
          key={state.activeWorkout.id}
          {...props}
          onFinished={(prs) => {
            if (prs.length) setFinishedPrs(prs);
            else {
              go("history");
              notify("Workout finished.");
            }
          }}
        />
        {prDialog}
      </>
    );
  if (!parameter) {
    return (
      <>
        <section className="training-start" aria-label="Start training">
          <div className="page-heading compact">
            <div>
              <h1>Train</h1>
              <p className="lead">Your next session, ready when you are.</p>
            </div>
          </div>
          <NextSession state={state} update={props.update} go={go} />
          <div className="training-start-links">
            <Button variant="secondary" onClick={() => void onStart("open")}>
              <Plus size={18} /> Start empty workout
            </Button>
          </div>
          <div className="list-card">
            {(
              [
                ["workout/choose", "Your programs & routines", LogbookIcon],
                ["workout/coaching", "Lifting brief & video", WhistleIcon],
                ["history", "Training history", TickedLogIcon],
              ] as const
            ).map(([route, label, Icon]) => (
              <button
                key={route}
                className="list-row"
                onClick={() => go(route)}
              >
                <Icon size={22} />
                <span>{label}</span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
          <details className="training-other-activity">
            <summary>
              Log a walk, run or ride <ChevronDown size={17} />
            </summary>
            <ActivityPhotoUpload
              accountId={props.accountId}
              go={go}
              showCoachLink
            />
          </details>
        </section>
        {prDialog}
      </>
    );
  }
  if (day) {
    const plan = planProgramDay(day, {
      sessions: state.sessions,
      programId: program.id,
      date,
    });
    return (
      <>
        <button
          className="text-link back-link"
          onClick={() => go("workout/choose")}
        >
          <ArrowLeft size={17} />
          All programmes
        </button>
        <div className="page-heading compact">
          <div>
            <div className="eyebrow">
              {day.id === "saturday" ? "With your coach" : "On your own"} ·{" "}
              {day.exercises.length} exercises
            </div>
            <h1>{day.title}</h1>
            <p className="lead">{day.focus}</p>
          </div>
        </div>
        {state.activeWorkout ? (
          <div className="notice">
            <div>
              <strong>{state.activeWorkout.title} is in progress.</strong>
              <p>
                View this programme freely. Finish or discard your saved workout
                before starting another.
              </p>
            </div>
            <Button onClick={() => go("workout")}>Resume workout</Button>
          </div>
        ) : (
          <div className="picker-bar">
            <label>
              Training date
              <input
                aria-label="Training date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || today())}
              />
            </label>
            <Button onClick={() => void onStart(day.id, date)}>
              Start this programme
            </Button>
          </div>
        )}
        {day.sessionPrompt && (
          <details className="panel guidance">
            <summary>Session guidance</summary>
            <p>{day.sessionPrompt}</p>
          </details>
        )}
        <div className="program-exercises">
          {day.exercises.map((ex, i) => {
            const target = plan.exercises[i];
            return (
              <article className="panel prescription" key={ex.exerciseId}>
                <div className="prescription-heading">
                  <span className="program-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h2>{exerciseName(ex.exerciseId)}</h2>
                    <p>
                      {target.sets} sets × {target.reps} reps
                    </p>
                  </div>
                  <strong className="prescription-load">
                    {target.weight !== "" && target.weight != null
                      ? `${target.weight} kg`
                      : "Choose load"}
                  </strong>
                </div>
                <p className="muted">{ex.notes}</p>
                <div className="section-top">
                  <span
                    className={`pill ${target.status === "increase" ? "success" : ""}`}
                  >
                    {target.status === "increase"
                      ? `+${target.step} kg next time`
                      : target.status === "manual"
                        ? "Manual load"
                        : target.status === "choose"
                          ? "Choose your starting load"
                          : "Your next prescription"}
                  </span>
                  <Technique exerciseId={ex.videoRef ?? ex.exerciseId} />
                </div>
                <details className="plan-reason">
                  <summary>Why this load?</summary>
                  <p>{target.reason}</p>
                  {plan.trainedToday && (
                    <p>
                      Available from {plan.availableFrom}. Repeating today uses
                      today’s prescription.
                    </p>
                  )}
                </details>
              </article>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="page-heading compact">
        <div>
          <h1>Choose your session.</h1>
          <p className="lead">
            Build a gym routine, start an open workout or follow your programme.
          </p>
        </div>
        <div className="button-row">
          <Button asChild variant="ghost">
            <a href="#library">Exercise library</a>
          </Button>
          <Button
            variant="secondary"
            onClick={() => void onStart("open", date)}
          >
            <Plus size={18} /> Start empty workout
          </Button>
        </div>
      </div>
      {state.activeWorkout ? (
        <div className="notice ongoing-workout-card">
          <div>
            <span className="eyebrow">Ongoing workout</span>
            <strong>{state.activeWorkout.title}</strong>
            <p>
              {state.activeWorkout.date} ·{" "}
              {state.activeWorkout.exercises.reduce(
                (n, e) => n + e.sets.filter((s) => s.logged || s.result).length,
                0,
              )}{" "}
              sets logged
            </p>
          </div>
          <Button onClick={() => go("workout")}>Resume workout</Button>
        </div>
      ) : null}
      <Templates
        state={state}
        update={props.update}
        date={date}
        go={go}
        notify={props.notify}
      />
      <TrainingPrograms
        state={state}
        update={props.update}
        date={date}
        go={go}
        notify={props.notify}
      />

      <div className="picker-bar">
        <label>
          Training date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || today())}
          />
        </label>
        <Button variant="ghost" onClick={() => setDate(today())}>
          Today
        </Button>
        <div className="segmented" aria-label="Programme filter">
          {[
            ["all", "All programmes"],
            ["solo", "On my own"],
            ["coach", "With my coach"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="picker-grid">
        {days
          .filter(
            (d) =>
              filter === "all" ||
              (filter === "coach" ? d.id === "saturday" : d.id !== "saturday"),
          )
          .map((d, i) => {
            const plan = planProgramDay(d, {
              sessions: state.sessions,
              programId: program.id,
              date,
            });
            return (
              <article className="panel picker-card" key={d.id}>
                <div className="section-top">
                  <span className="program-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="pill">
                    {d.id === "saturday"
                      ? "COACHED"
                      : d.id === "gym_accessories"
                        ? "ANY DAY"
                        : "SOLO"}
                  </span>
                </div>
                <h2>{d.title}</h2>
                <p className="muted">{d.focus}</p>
                <details>
                  <summary>Preview {d.exercises.length} exercises</summary>
                  {plan.exercises.map((e) => (
                    <div className="load-row" key={e.exerciseId}>
                      <span>{exerciseName(e.exerciseId)}</span>
                      <strong>
                        {e.weight !== "" && e.weight != null
                          ? `${e.weight} kg`
                          : "Manual"}
                      </strong>
                    </div>
                  ))}
                </details>
                <div className="button-row">
                  <Button
                    onClick={() =>
                      state.activeWorkout
                        ? go(`workout/${d.id}`)
                        : void onStart(d.id, date)
                    }
                  >
                    {state.activeWorkout ? "View programme" : "Start session"}
                  </Button>
                  {!state.activeWorkout && (
                    <Button
                      variant="ghost"
                      onClick={() => go(`workout/${d.id}`)}
                    >
                      Details
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
    </>
  );
}
