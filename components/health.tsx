"use client";
import { CoachOpening } from "./coach-opening";
import { AgreedPlans } from "./coach-memory";
import { CardioProgress } from "./cardio";
import { ImageLibrary } from "./image-library";
import { useState } from "react";
import {
  ArrowRight,
  Activity,
  Check,
  Droplets,
  Dumbbell,
  HeartPulse,
  Moon,
  Plus,
  Scale,
  Sparkles,
  Utensils,
} from "@/components/ui/icons";
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
  onMemories,
}: {
  journal: JournalController;
  onCheckin: () => void;
  onAsk: (question: string) => void;
  go: (route: string) => void;
  busy: boolean;
  onMemories: () => void;
}) {
  const state = journal.state!,
    current = today(),
    view = dailyHealth(state, current);
  const training =
    state.sessions.filter((s) => s.date === current).length +
    state.cardio.sessions.filter((s) => s.date === current).length;
  return (
    <section className="today-focus" aria-label="Your daily health overview">
      <div className="coach-section-title">
        <div>
          <span className="eyebrow">YOUR DAILY COACH</span>
          <h2>A little direction for today.</h2>
          <p className="muted">Your next step, with room to live your day.</p>
        </div>
      </div>
      <CoachOpening
        journal={journal}
        date={current}
        compact={false}
        disabled={busy}
        onDiscuss={onAsk}
      />
      <div className="today-main-actions">
        <Button
          disabled={busy}
          onClick={() =>
            onAsk(
              "Help me choose one useful next step for today from my health overview, approved preferences and agreed plans. Explain the logged observation behind it; ask what matters if the journal is empty. Keep it manageable and don’t save a plan unless I agree.",
            )
          }
        >
          <Sparkles size={17} /> Plan my day
        </Button>
        <Button variant="secondary" onClick={onCheckin}>
          {view.checkin ? "Update check-in" : "Daily check-in"}
        </Button>
      </div>
      {state.activeWorkout && (
        <button className="today-workout" onClick={() => go("workout")}>
          <Dumbbell size={22} />
          <span>
            <small>YOUR WORKOUT</small>
            <strong>{state.activeWorkout.title}</strong>
            <span>{state.activeWorkout.date} · Continue your draft</span>
          </span>
          <ArrowRight size={18} />
        </button>
      )}
      <div className="today-summaries" aria-label="Today’s logged entries">
        <button onClick={() => go("history")}>
          <Dumbbell size={21} />
          <span>Training</span>
          <strong>
            {training ? `${training} logged` : "No entries today"}
          </strong>
          <small>Strength & cardio</small>
        </button>
        <button onClick={() => go("food")}>
          <Utensils size={21} />
          <span>Food</span>
          <strong>
            {view.mealCount
              ? `${view.nutrients.calories} kcal`
              : "No entries today"}
          </strong>
          <small>
            {view.mealCount} {view.mealCount === 1 ? "meal" : "meals"} ·{" "}
            {state.nutrition.completeDays?.includes(current)
              ? "complete"
              : "partial / unknown"}
          </small>
        </button>
        <button onClick={() => go("coach/sleep")}>
          <Moon size={21} />
          <span>Sleep</span>
          <strong>
            {view.checkin?.sleepHours == null
              ? "Not recorded"
              : formatSleepDuration(view.checkin.sleepHours)}
          </strong>
          <small>Last night</small>
        </button>
      </div>
      <AgreedPlans
        journal={journal}
        onAsk={onAsk}
        disabled={busy || Boolean(journal.record?.conflict)}
        onManage={onMemories}
      />
      <details className="today-more">
        <summary>More from your journal</summary>
        {view.checkin && <CheckinDetails checkin={view.checkin} />}
        <div className="button-row">
          <Button variant="secondary" onClick={() => go("cardio")}>
            Cardio & movement
          </Button>
          <Button variant="secondary" onClick={() => go("health")}>
            Health history
          </Button>
          <Button variant="secondary" onClick={() => go("images")}>
            Images & screenshots
          </Button>
        </div>
      </details>
      <button className="text-link" onClick={onMemories}>
        What Coach remembers →
      </button>
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
      <CardioProgress state={journal.state!} compact />
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
