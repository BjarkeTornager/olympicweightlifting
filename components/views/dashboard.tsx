"use client";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  Dumbbell,
  Flame,
  TrendingUp,
} from "lucide-react";
import type { JournalState } from "@/lib/model";
import { days, today, exerciseName, program } from "@/lib/domain";
import { planProgramDay } from "@/js/progression.js";
import { Button } from "../ui/button";
export function Dashboard({
  state,
  onStart,
  go,
}: {
  state: JournalState;
  onStart: (id: string, date?: string) => Promise<void>;
  go: (path: string) => void;
}) {
  const day =
    days.find((d) => d.weekday === new Date().getDay()) ??
    days.find((d) => d.id === "monday")!;
  const active = state.activeWorkout,
    selected = active
      ? (days.find((d) => d.id === active.programDayId) ?? day)
      : day;
  const plan = planProgramDay(selected, {
    sessions: state.sessions,
    programId: program.id,
    date: today(),
  });
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const weekCount = state.sessions.filter(
    (s) => new Date(s.date + "T12:00:00") >= monday && s.date <= today(),
  ).length;
  const recent = [...state.sessions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const stats = [
    { label: "SNATCH", value: state.prs.snatch, colour: "blue" },
    { label: "CLEAN & JERK", value: state.prs.clean_and_jerk, colour: "red" },
    {
      label: "COMPETITION TOTAL",
      value: (state.prs.snatch ?? 0) + (state.prs.clean_and_jerk ?? 0),
      colour: "gold",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PLATFORM</div>
          <h1>
            Every session
            <br />
            <em>moves you forward.</em>
          </h1>
        </div>
        <span className="heading-note">
          <Flame size={18} />
          {weekCount} {weekCount === 1 ? "session" : "sessions"} this week
        </span>
      </div>
      <div className="dashboard-grid">
        <section className="training-card">
          <div className="card-top">
            <span className="eyebrow">
              {active ? "PICK UP WHERE YOU LEFT OFF" : "ON THE PROGRAMME"}
            </span>
            <span className="pill dark">
              {selected.id === "saturday" ? "COACHED" : "SOLO"}
            </span>
          </div>
          <h2>{active?.title ?? day.title}</h2>
          <p>
            {active
              ? `${active.exercises.reduce((n, e) => n + e.sets.filter((s) => s.logged || s.result).length, 0)} sets logged · ${active.date}`
              : day.focus}
          </p>
          <div className="training-meta">
            <span>
              <Dumbbell size={16} />
              {(active?.exercises ?? day.exercises).length} exercises
            </span>
            <span>
              <CalendarDays size={16} />
              {active ? "Workout in progress" : "Train on any day"}
            </span>
          </div>
          <Button
            variant="gold"
            onClick={() => (active ? go("workout") : void onStart(day.id))}
          >
            {active ? "Resume workout" : "Start workout"}
            <ArrowUpRight size={20} />
          </Button>
          <div className="plate-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
        <section className="week-card">
          <div className="section-top">
            <h2>This week</h2>
            <CalendarDays size={19} />
          </div>
          <p className="muted">Build a rhythm that works for you.</p>
          <div className="week-track">
            {Array.from({ length: 7 }, (_, i) => {
              const date = new Date(monday);
              date.setDate(date.getDate() + i);
              const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
              const trained = state.sessions.some((s) => s.date === iso);
              return (
                <div key={i}>
                  <span>{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
                  <span
                    className={`week-day ${trained ? "done" : ""} ${iso === today() ? "today" : ""}`}
                  >
                    {trained ? <Check size={17} /> : date.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="week-total">
            <strong>
              {weekCount}
              <span>/ 4</span>
            </strong>
            <span>usual weekly sessions</span>
          </div>
          <button className="text-link" onClick={() => go("history")}>
            View your training <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <div className="section-top spaced">
        <h2>Your numbers</h2>
        <a className="text-link" href="#progress">
          View progress <ArrowUpRight size={16} />
        </a>
      </div>
      <div className="stats-grid">
        {stats.map((s) => (
          <div className={`stat-card ${s.colour}`} key={s.label}>
            <div className="stat-label">
              <span>{s.label}</span>
              <TrendingUp size={18} />
            </div>
            <div className="stat-number">
              {s.value || "—"}
              <span>kg</span>
            </div>
            <span className="muted">
              {s.value ? "Personal best" : "Add your personal best"}
            </span>
          </div>
        ))}
      </div>
      <div className="section-top spaced">
        <h2>Find your next session</h2>
        <a className="text-link" href="#workout/choose">
          All programmes <ArrowUpRight size={16} />
        </a>
      </div>
      <div className="program-grid">
        {days
          .filter((d) => d.id !== "saturday")
          .map((d, i) => (
            <a className="program-card" href={`#workout/${d.id}`} key={d.id}>
              <span className={`program-index index-${i}`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <small>
                  {d.id === "gym_accessories"
                    ? "ANY DAY · NORMAL GYM"
                    : `${d.name.toUpperCase()} · SOLO`}
                </small>
                <h3>{d.title}</h3>
                <p>{d.exercises.length} exercises</p>
              </div>
              <ArrowUpRight size={20} />
            </a>
          ))}
      </div>
      <div className="bottom-grid">
        <section className="panel">
          <div className="section-top">
            <h2>Recent training</h2>
            <a className="text-link" href="#history">
              View all <ArrowRight size={16} />
            </a>
          </div>
          {recent.length ? (
            recent.map((s) => (
              <div className="history-row" key={s.id}>
                <span className="history-icon">
                  <Dumbbell size={20} />
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <p>
                    {new Date(s.date + "T12:00:00").toLocaleDateString(
                      "en-GB",
                      { day: "numeric", month: "short" },
                    )}{" "}
                    · {s.exercises.length} exercises
                  </p>
                </div>
                <Check size={18} />
              </div>
            ))
          ) : (
            <div className="empty-inline">
              <Dumbbell size={27} />
              <h3>Your first session starts here.</h3>
              <p>Finish a workout to begin your training history.</p>
            </div>
          )}
        </section>
        <section className="panel next-loads">
          <div className="section-top">
            <h2>Next session loads</h2>
            <TrendingUp size={19} />
          </div>
          <p className="muted">{selected.title}</p>
          {plan.exercises.slice(0, 3).map((e) => (
            <div className="load-row" key={e.exerciseId}>
              <span>{exerciseName(e.exerciseId)}</span>
              <strong>
                {e.weight !== "" && e.weight != null
                  ? `${e.weight} kg`
                  : "Choose load"}
              </strong>
            </div>
          ))}
          <p className="fine-print">
            {plan.trainedToday
              ? `Next increase available from ${plan.availableFrom}.`
              : "Targets follow your completed training."}
          </p>
        </section>
      </div>
    </>
  );
}
