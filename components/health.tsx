"use client";
import { ImageLibrary } from "./image-library";
import { useState } from "react";
import {
  ArrowRight,
  Activity,
  Check,
  ChevronRight,
  Droplets,
  Dumbbell,
  HeartPulse,
  Moon,
  Plus,
  Scale,
  Sparkles,
  Utensils,
} from "lucide-react";
import type { JournalController } from "./journal";
import { today } from "@/lib/domain";
import {
  dailyHealth,
  formatSleepDuration,
  offsetDate,
  saveCheckin,
  type Checkin,
  type CheckinPatch,
} from "@/lib/health";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

const energyNames = ["Very low", "Low", "Okay", "Good", "Great"];
const sorenessNames = ["None", "Mild", "Moderate", "High", "Very high"];
export function CheckinDetails({ checkin }: { checkin: Checkin }) {
  const items = [
    checkin.sleepHours == null
      ? null
      : `${formatSleepDuration(checkin.sleepHours)} sleep`,
    checkin.energy == null ? null : `Energy ${checkin.energy}/5`,
    checkin.soreness == null ? null : `Soreness ${checkin.soreness}/5`,
    checkin.waterMl == null ? null : `${checkin.waterMl} ml water`,
    checkin.bodyweight == null ? null : `${checkin.bodyweight} kg`,
  ].filter(Boolean);
  return (
    <div className="checkin-details">
      <div className="checkin-values">
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      {checkin.notes && <p>{checkin.notes}</p>}
    </div>
  );
}
function CheckinForm({
  journal,
  date,
  onClose,
}: {
  journal: JournalController;
  date: string;
  onClose: () => void;
}) {
  const existing = (date: string) =>
    journal.state!.health.checkins.find((c) => c.date === date);
  const fields = (date: string): CheckinPatch => {
    const c = existing(date);
    return {
      date,
      sleepHours: c?.sleepHours ?? null,
      energy: c?.energy ?? null,
      soreness: c?.soreness ?? null,
      waterMl: c?.waterMl ?? null,
      bodyweight: c?.bodyweight ?? null,
      notes: c?.notes ?? "",
    };
  };
  const [draft, setDraft] = useState(() => fields(date)),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <form
      className="checkin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
          await journal.update((s) => {
            saveCheckin(s, draft, today());
          });
          onClose();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Could not save your check-in.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        Check-in date
        <input
          required
          type="date"
          max={today()}
          value={draft.date}
          onChange={(e) => {
            if (e.target.value) setDraft(fields(e.target.value));
          }}
        />
      </label>
      <div className="checkin-number-grid">
        {(
          [
            ["sleepHours", "Sleep last night", "hours", Moon, 0, 24, "any"],
            ["waterMl", "Water today", "ml total", Droplets, 0, 15000, 1],
            ["bodyweight", "Bodyweight", "kg", Scale, 20, 500, 0.1],
          ] as const
        ).map(([key, label, unit, Icon, min, max, step]) => (
          <label key={key}>
            <span>
              <Icon size={16} /> {label}
            </span>
            <div className="checkin-number">
              <input
                aria-label={label}
                type="number"
                min={min}
                max={max}
                step={step}
                placeholder="—"
                value={draft[key] ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [key]:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <span>{unit}</span>
            </div>
          </label>
        ))}
      </div>
      {(["energy", "soreness"] as const).map((key) => (
        <fieldset className="feeling-field" key={key}>
          <legend>
            {key === "energy" ? "Your energy" : "Muscle soreness"}
          </legend>
          <div className="feeling-scale">
            {(key === "energy" ? energyNames : sorenessNames).map(
              (label, index) => (
                <button
                  type="button"
                  key={label}
                  aria-label={`${key === "energy" ? "Energy" : "Soreness"} ${index + 1}: ${label}`}
                  aria-pressed={draft[key] === index + 1}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      [key]: draft[key] === index + 1 ? null : index + 1,
                    })
                  }
                >
                  <strong>{index + 1}</strong>
                  <span>{label}</span>
                </button>
              ),
            )}
          </div>
        </fieldset>
      ))}
      <label>
        Anything Coach should know?
        <textarea
          value={draft.notes ?? ""}
          maxLength={2000}
          rows={3}
          placeholder="How you feel, what’s on your mind, or what you want help with…"
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      <p className="fine-print">
        Fill in what you know. Leave anything you haven’t measured blank. This
        updates one check-in for the selected date.
      </p>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        <Check size={16} />
        {saving ? "Saving…" : "Save check-in"}
      </Button>
    </form>
  );
}
export function CheckinDialog({
  journal,
  date,
  onClose,
}: {
  journal: JournalController;
  date: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(date)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="How are you today?"
      description="A moment to check in. Your answers help Coach put the day in context."
    >
      {date && (
        <CheckinForm
          key={date}
          journal={journal}
          date={date}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

export function DailyOverview({
  journal,
  onCheckin,
  onAsk,
  go,
  busy,
}: {
  journal: JournalController;
  onCheckin: () => void;
  onAsk: (question: string) => void;
  go: (route: string) => void;
  busy: boolean;
}) {
  const state = journal.state!,
    current = today(),
    view = dailyHealth(state, current);
  const weekStart = offsetDate(
    current,
    -((new Date(`${current}T12:00:00`).getDay() + 6) % 7),
  );
  const subtitle = view.recoveryFocus
    ? "You’ve reported low energy or high soreness. Let’s put recovery into today’s plan."
    : view.checkin
      ? "Your check-in is saved. Bring your training, nutrition and recovery together."
      : "A few small entries. A clearer picture of your training, nutrition and recovery.";
  const metrics = [
    {
      title: "Sleep",
      icon: Moon,
      value:
        view.checkin?.sleepHours == null
          ? "—"
          : Math.round(view.checkin.sleepHours * 100) / 100,
      unit: "hours",
      detail:
        view.checkin?.sleepHours != null
          ? `${formatSleepDuration(view.checkin.sleepHours)} logged for last night`
          : "Add last night’s sleep",
      route: "coach/sleep",
      color: "lilac",
    },
    {
      title: "Nutrition",
      icon: Utensils,
      value: view.mealCount ? view.nutrients.calories : "—",
      unit: "kcal",
      detail: view.mealCount
        ? `${view.nutrients.protein} g protein · ${view.mealCount} ${view.mealCount === 1 ? "meal" : "meals"}`
        : "Your food journal starts here",
      route: "food",
      color: "peach",
    },
    {
      title: "Water",
      icon: Droplets,
      value: view.checkin?.waterMl == null ? "—" : view.checkin.waterMl / 1000,
      unit: "litres",
      detail:
        view.checkin?.waterMl != null
          ? "Total you’ve logged today"
          : "Add what you’ve had today",
      route: "checkin",
      color: "sky",
    },
    {
      title: "Training",
      icon: Dumbbell,
      value: view.sessionsThisWeek,
      unit: view.sessionsThisWeek === 1 ? "session" : "sessions",
      detail: "Recorded in the last 7 days",
      route: "history",
      color: "sage",
    },
  ];
  return (
    <section className="daily-overview" aria-label="Your daily health overview">
      <div className="daily-heading">
        <div>
          <div className="eyebrow">
            <span className="coach-dot" /> YOUR DAILY COACH
          </div>
          <h1>Your day, in focus.</h1>
          <p>{subtitle}</p>
        </div>
        <div className="daily-heading-actions">
          <button className="health-history-link" onClick={() => go("images")}>
            Images & screenshots <ArrowRight size={16} />
          </button>
          <button className="health-history-link" onClick={() => go("health")}>
            Health history <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <div className="daily-hero">
        <div className="daily-hero-copy">
          <span className="hero-kicker">
            <Sparkles size={15} /> TRAIN · EAT · RECOVER
          </span>
          <h2>
            {view.recoveryFocus
              ? "Give recovery a place in your day."
              : "Let’s make a plan for today."}
          </h2>
          <p>
            Coach can connect your recent entries, explain what matters and help
            you choose your next step.
          </p>
          <div className="button-row">
            <Button
              disabled={busy}
              onClick={() =>
                onAsk(
                  "Build my plan for today. First read my health overview, recent training and nutrition. Give me up to three practical priorities with the logged evidence behind each. Separate facts from suggestions, mention missing information, and tell me one useful next step. Do not change my journal or invent targets.",
                )
              }
            >
              <Sparkles size={16} />
              {busy ? "Coach is thinking…" : "Plan my day"}
              <ArrowRight size={16} />
            </Button>
            <button className="hero-checkin" onClick={onCheckin}>
              {view.checkin ? <Check size={16} /> : <Plus size={16} />}
              {view.checkin ? "Update check-in" : "Daily check-in"}
            </button>
          </div>
        </div>
        <div className="daily-week">
          <div>
            <span>YOUR WEEK</span>
            <span>Entries, one day at a time</span>
          </div>
          <div className="daily-week-days">
            {Array.from({ length: 7 }, (_, i) => {
              const date = offsetDate(weekStart, i),
                hasCheckin = state.health.checkins.some((c) => c.date === date),
                hasFood = state.nutrition.meals.some((m) => m.date === date),
                hasTraining = state.sessions.some((s) => s.date === date);
              return (
                <div
                  role="group"
                  className={date === current ? "current" : ""}
                  key={date}
                  aria-label={`${date}: ${hasCheckin ? "check-in logged" : "no check-in"}, ${hasFood ? "food logged" : "no food"}, ${hasTraining ? "training logged" : "no training"}`}
                >
                  <small>{["M", "T", "W", "T", "F", "S", "S"][i]}</small>
                  <strong>{Number(date.slice(-2))}</strong>
                  <span className="daily-week-dots" aria-hidden="true">
                    <i className={hasCheckin ? "has-checkin" : ""} />
                    <i className={hasFood ? "has-food" : ""} />
                    <i className={hasTraining ? "has-training" : ""} />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="week-legend">
            <span>
              <i className="has-checkin" />
              Check-in
            </span>
            <span>
              <i className="has-food" />
              Food
            </span>
            <span>
              <i className="has-training" />
              Training
            </span>
          </div>
        </div>
      </div>
      <div className="daily-metrics">
        {metrics.map(
          ({ title, icon: Icon, value, unit, detail, route, color }) => (
            <button
              key={title}
              className={`daily-metric ${color}`}
              onClick={() => (route === "checkin" ? onCheckin() : go(route))}
            >
              <span className="metric-top">
                <span>{title}</span>
                <span className="metric-icon">
                  <Icon size={18} />
                </span>
              </span>
              <span className="metric-reading">
                <strong>{value}</strong>
                <span>{unit}</span>
              </span>
              <span className="metric-detail">
                {detail}
                <ChevronRight size={14} />
              </span>
            </button>
          ),
        )}
      </div>
      <div className="daily-section-heading">
        <div>
          <h2>A good next step</h2>
          <p>
            Useful starting points from your entries. Ask Coach to personalise
            the plan.
          </p>
        </div>
        <span className="source-label">FROM YOUR JOURNAL</span>
      </div>
      <div className="daily-priorities">
        {view.priorities.map((priority, index) => (
          <article className="priority-card" key={priority.id}>
            <div className="priority-top">
              <span>{priority.category}</span>
              <span>0{index + 1}</span>
            </div>
            <h3>{priority.title}</h3>
            <p>{priority.reason}</p>
            <button
              onClick={() =>
                priority.route === "checkin"
                  ? onCheckin()
                  : priority.route === "discuss-recovery"
                    ? onAsk(
                        "Read my health overview and help me decide how to adjust today around my reported energy and soreness. Explain what you know, what is uncertain, and a practical next step. Don’t change my workout without a proposal.",
                      )
                    : go(priority.route)
              }
              disabled={priority.route === "discuss-recovery" && busy}
            >
              {priority.action}
              <ArrowRight size={16} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HealthView({
  journal,
  go,
  onLogin,
}: {
  journal: JournalController;
  go: (route: string) => void;
  onLogin: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [deleting, setDeleting] = useState<string | null>(null),
    [error, setError] = useState("");
  const view = dailyHealth(journal.state!, today());
  const records = [...journal.state!.health.checkins].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const [limit, setLimit] = useState(14);
  return (
    <div className="health-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <HeartPulse size={15} /> YOUR HEALTH JOURNAL
          </div>
          <h1>Notice your patterns.</h1>
          <p className="lead">
            Sleep, energy and recovery, in your own words and numbers.
          </p>
        </div>
        <div className="button-row">
          <Button variant="secondary" onClick={() => go("coach/sleep")}>
            <Moon size={16} /> Log sleep with Coach
          </Button>
          <Button onClick={() => setEditing(today())}>
            <Plus size={16} /> Daily check-in
          </Button>
        </div>
      </div>
      <div className="health-summary-grid">
        <section className="panel">
          <Moon size={20} />
          <span>Sleep · last 14 days</span>
          <strong>
            {view.sleepAverage ?? "—"}
            <small>hours</small>
          </strong>
          <p>
            {view.sleepSamples
              ? `Average of ${view.sleepSamples} logged nights`
              : "Log sleep to build your picture"}
          </p>
        </section>
        <section className="panel">
          <Scale size={20} />
          <span>Latest bodyweight</span>
          <strong>
            {view.latestWeight?.value ?? "—"}
            <small>kg</small>
          </strong>
          <p>
            {view.latestWeight?.date ?? "No measurement in the last 14 days"}
          </p>
        </section>
        <section className="panel">
          <Activity size={20} />
          <span>Check-in rhythm</span>
          <strong>
            {view.recentCheckins.length}
            <small>/ 14 days</small>
          </strong>
          <p>Missing days are left unmeasured</p>
        </section>
      </div>
      <section className="panel sleep-chart">
        <div className="section-top">
          <h2>Your last 14 nights</h2>
          <span className="fine-print">Hours you reported</span>
        </div>
        <div className="sleep-bars">
          {Array.from({ length: 14 }, (_, index) => {
            const date = offsetDate(today(), index - 13),
              c = view.recentCheckins.find((c) => c.date === date);
            return (
              <button
                key={date}
                onClick={() => setEditing(date)}
                aria-label={`${date}: ${c?.sleepHours != null ? `${formatSleepDuration(c.sleepHours)} sleep` : "sleep not logged"}. Edit check-in.`}
              >
                <span className="sleep-bar-track">
                  <span
                    style={{
                      height:
                        c?.sleepHours != null
                          ? `${Math.max(2, (c.sleepHours / 24) * 100)}%`
                          : "2px",
                    }}
                    className={c?.sleepHours == null ? "missing" : ""}
                  />
                </span>
                <strong>
                  {c?.sleepHours == null
                    ? "—"
                    : Math.round(c.sleepHours * 10) / 10}
                </strong>
                <small>{date.slice(8)}</small>
              </button>
            );
          })}
        </div>
        <p className="fine-print">
          Select a day to add or edit it. The chart shows recorded hours only.
        </p>
      </section>
      <section className="panel health-records">
        <div className="section-top">
          <h2>Your check-ins</h2>
          <button className="text-link" onClick={() => go("coach")}>
            Talk with Coach <ArrowRight size={16} />
          </button>
        </div>
        {!records.length && (
          <div className="health-empty">
            <HeartPulse size={30} />
            <h3>Start with today.</h3>
            <p>
              A short check-in helps you and Coach notice patterns over time.
            </p>
            <Button variant="secondary" onClick={() => setEditing(today())}>
              Add your first check-in
            </Button>
          </div>
        )}
        {records.slice(0, limit).map((c) => (
          <article key={c.date}>
            <div className="section-top">
              <h3>
                {new Date(`${c.date}T12:00:00`).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </h3>
              <div className="button-row">
                <Button variant="ghost" onClick={() => setEditing(c.date)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setError("");
                    setDeleting(c.date);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            <CheckinDetails checkin={c} />
          </article>
        ))}
        {records.length > limit && (
          <Button variant="secondary" onClick={() => setLimit((n) => n + 14)}>
            Show earlier check-ins
          </Button>
        )}
      </section>
      <ImageLibrary
        key={journal.identity?.id ?? "guest"}
        accountId={journal.identity?.id}
        onLogin={onLogin}
        go={go}
        scope="health"
      />
      <p className="health-footnote">
        Your entries sync with your account and are included in journal backups.
        Coach supports everyday habits and training decisions; medical concerns
        belong with a qualified clinician.
      </p>
      <CheckinDialog
        journal={journal}
        date={editing}
        onClose={() => setEditing(null)}
      />
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this check-in?"
        description="This removes the selected day’s health entry. Your meals and workouts stay in your journal."
      >
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await journal.update((s) => {
                s.health.checkins = s.health.checkins.filter(
                  (c) => c.date !== deleting,
                );
              });
              setDeleting(null);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not delete check-in.",
              );
            }
          }}
        >
          Delete check-in
        </Button>
        {error && <p role="alert">{error}</p>}
      </Dialog>
    </div>
  );
}
