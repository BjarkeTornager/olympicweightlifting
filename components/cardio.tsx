"use client";
import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bike,
  Check,
  Footprints,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { today } from "@/lib/domain";
import { offsetDate } from "@/lib/health";
import {
  cardioActivities,
  cardioLabels,
  cardioTitle,
  cardioRate,
  cardioSummary,
  formatDuration,
  saveCardio,
  type CardioEntry,
  type CardioActivity,
} from "@/lib/cardio";
import type { JournalState } from "@/lib/model";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function CardioDetails({ entry }: { entry: CardioEntry }) {
  const rate = cardioRate(entry);
  const values = [
    ["Duration", formatDuration(entry.durationSeconds)],
    ["Distance", entry.distanceKm == null ? null : `${entry.distanceKm} km`],
    [
      entry.activity === "cycling" ||
      entry.activity === "elliptical" ||
      entry.activity === "other"
        ? "Average speed"
        : "Average pace",
      rate,
    ],
    [
      "Average heart rate",
      entry.averageHeartRate == null ? null : `${entry.averageHeartRate} bpm`,
    ],
    [
      "Maximum heart rate",
      entry.maxHeartRate == null ? null : `${entry.maxHeartRate} bpm`,
    ],
    ["Effort", entry.effort == null ? null : `${entry.effort}/10`],
    [
      "Elevation gain",
      entry.elevationGainM == null ? null : `${entry.elevationGainM} m`,
    ],
    [
      "Reported activity energy",
      entry.caloriesKcal == null ? null : `${entry.caloriesKcal} kcal`,
    ],
  ].filter(([, value]) => value != null);
  return (
    <div className="cardio-details">
      {entry.title && <strong>{entry.title}</strong>}
      <p className="fine-print">
        {cardioLabels[entry.activity]} · {entry.date}
        {entry.durationType !== "unspecified"
          ? ` · ${entry.durationType} time`
          : ""}
      </p>
      <dl>
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {entry.notes && <p className="cardio-notes">{entry.notes}</p>}
    </div>
  );
}
function ActivityForm({
  journal,
  entry,
  onClose,
}: {
  journal: JournalController;
  entry: CardioEntry | null;
  onClose: () => void;
}) {
  const [activity, setActivity] = useState<CardioActivity>(
    entry?.activity ?? "running",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const seconds = entry?.durationSeconds ?? 0;
  return (
    <form
      className="form-stack cardio-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setSaving(true);
        const data = new FormData(e.currentTarget);
        const number = (name: string) => {
          const value = String(data.get(name) ?? "").trim();
          return value ? Number(value) : null;
        };
        const distance = number("distance"),
          unit = data.get("distanceUnit");
        const input = {
          activity,
          title: String(data.get("title") ?? ""),
          date: String(data.get("date")),
          durationSeconds:
            (number("hours") ?? 0) * 3600 +
            (number("minutes") ?? 0) * 60 +
            (number("seconds") ?? 0),
          distanceKm:
            distance == null
              ? null
              : Math.round(
                  distance *
                    (unit === "mi" ? 1.609344 : unit === "m" ? 0.001 : 1) *
                    1000000,
                ) / 1000000,
          durationType: String(data.get("durationType") ?? "unspecified"),
          averageHeartRate: number("averageHeartRate"),
          maxHeartRate: number("maxHeartRate"),
          effort: number("effort"),
          elevationGainM: number("elevationGainM"),
          caloriesKcal: number("caloriesKcal"),
          notes: String(data.get("notes") ?? ""),
        };
        try {
          if (!input.durationSeconds)
            throw Error("Enter the activity duration.");
          await journal.update((state) => {
            saveCardio(state, input, today(), entry?.id);
          });
          onClose();
        } catch (e) {
          setError(
            e instanceof Error && e.name !== "ZodError"
              ? e.message
              : "Check the duration, date and measurements. Maximum heart rate must be at least the average.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="form-grid">
        <label>
          Activity
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value as CardioActivity)}
          >
            {cardioActivities.map((a) => (
              <option key={a} value={a}>
                {cardioLabels[a]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Activity date
          <input
            type="date"
            name="date"
            required
            max={today()}
            defaultValue={entry?.date ?? today()}
          />
        </label>
      </div>
      <fieldset>
        <legend>Duration</legend>
        <div className="cardio-duration">
          <label>
            Hours
            <input
              name="hours"
              type="number"
              inputMode="numeric"
              min="0"
              max="168"
              step="1"
              placeholder="0"
              defaultValue={seconds >= 3600 ? Math.floor(seconds / 3600) : ""}
            />
          </label>
          <label>
            Minutes
            <input
              name="minutes"
              type="number"
              inputMode="numeric"
              min="0"
              max="59"
              step="1"
              placeholder="0"
              defaultValue={seconds ? Math.floor((seconds % 3600) / 60) : ""}
            />
          </label>
          <label>
            Seconds
            <input
              name="seconds"
              type="number"
              inputMode="numeric"
              min="0"
              max="59"
              step="1"
              placeholder="0"
              defaultValue={seconds % 60 || ""}
            />
          </label>
        </div>
      </fieldset>
      <div className="cardio-distance">
        <label>
          Distance · optional
          <input
            name="distance"
            type="number"
            inputMode="decimal"
            min="0"
            max="10000000"
            step="any"
            placeholder="—"
            defaultValue={entry?.distanceKm ?? ""}
          />
        </label>
        <label>
          Distance unit
          <select name="distanceUnit" defaultValue="km">
            <option value="km">km</option>
            <option value="mi">miles</option>
            <option value="m">metres</option>
          </select>
        </label>
      </div>
      <details className="cardio-more">
        <summary>
          More details{" "}
          <span className="fine-print">Heart rate, effort and notes</span>
        </summary>
        <div className="form-stack">
          <label>
            Activity name · optional
            <input
              name="title"
              maxLength={120}
              defaultValue={entry?.title ?? ""}
              placeholder="Morning ride, easy run…"
            />
          </label>
          <label>
            Time recorded
            <select
              name="durationType"
              defaultValue={entry?.durationType ?? "unspecified"}
            >
              <option value="unspecified">Not specified</option>
              <option value="moving">Moving time</option>
              <option value="elapsed">Elapsed time</option>
            </select>
          </label>
          <div className="form-grid">
            {(
              [
                ["averageHeartRate", "Average heart rate · bpm", 30, 300, "1"],
                ["maxHeartRate", "Maximum heart rate · bpm", 30, 300, "1"],
                ["effort", "Effort · 1–10", 1, 10, "0.5"],
                ["elevationGainM", "Elevation gain · m", 0, 30000, "any"],
                [
                  "caloriesKcal",
                  "Reported activity energy · kcal",
                  0,
                  50000,
                  "any",
                ],
              ] as const
            ).map(([name, label, min, max, step]) => (
              <label key={name}>
                {label}
                <input
                  type="number"
                  inputMode="decimal"
                  name={name}
                  min={min}
                  max={max}
                  step={step}
                  placeholder="—"
                  defaultValue={entry?.[name] ?? ""}
                />
              </label>
            ))}
          </div>
          <label>
            Notes
            <textarea
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={entry?.notes ?? ""}
              placeholder="Route, intervals, weather, how it felt…"
            />
          </label>
          <p className="fine-print">
            Enter measured or reported values. Activity energy stays separate
            from food intake; the app does not estimate calories burned.
          </p>
        </div>
      </details>
      <p className="fine-print">
        Pace or speed is calculated when you add a distance. Your activity syncs
        with your private health journal.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        <Check size={17} />
        {saving ? "Saving…" : entry ? "Save activity changes" : "Save activity"}
      </Button>
    </form>
  );
}
export function CardioProgress({
  state,
  compact = false,
}: {
  state: JournalState;
  compact?: boolean;
}) {
  const current = today(),
    from = offsetDate(current, -6),
    summary = cardioSummary(state, from, current);
  const previous = cardioSummary(
    state,
    offsetDate(current, -13),
    offsetDate(current, -7),
  );
  const difference = summary.durationSeconds - previous.durationSeconds;
  return (
    <section className="panel cardio-progress" aria-label="Cardio progress">
      <div className="cardio-section-heading">
        <div>
          <div className="eyebrow">MOVEMENT · LAST 7 DAYS</div>
          <h2>Cardio at a glance</h2>
        </div>
        <Activity size={22} aria-hidden="true" />
      </div>
      <dl className="cardio-totals">
        <div>
          <dt>Activities logged</dt>
          <dd>{summary.sessions}</dd>
        </div>
        <div>
          <dt>Time logged</dt>
          <dd>
            {summary.sessions ? formatDuration(summary.durationSeconds) : "—"}
          </dd>
        </div>
        <div>
          <dt>Distance recorded</dt>
          <dd>
            {summary.distanceKm == null ? "—" : `${summary.distanceKm} km`}
          </dd>
        </div>
      </dl>
      {!compact && (
        <>
          <div className="cardio-week" aria-label="Daily activity duration">
            {Array.from({ length: 7 }, (_, i) => {
              const date = offsetDate(from, i),
                day = summary.daily.find((d) => d.date === date),
                maximum = Math.max(
                  1,
                  ...summary.daily.map((d) => d.durationSeconds),
                );
              return (
                <div
                  key={date}
                  aria-label={`${date}: ${day ? formatDuration(day.durationSeconds) + " logged" : "No activity logged"}`}
                >
                  <span>
                    {day ? Math.round(day.durationSeconds / 60) + " min" : "—"}
                  </span>
                  <div className="cardio-bar-track" aria-hidden="true">
                    <i
                      style={{
                        height: day
                          ? `${Math.max(3, (day.durationSeconds / maximum) * 100)}%`
                          : 0,
                      }}
                    />
                  </div>
                  <small>
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: "short",
                    }).format(new Date(date + "T12:00:00"))}
                  </small>
                </div>
              );
            })}
          </div>
          {summary.byActivity.length > 0 && (
            <ul className="cardio-breakdown">
              {summary.byActivity.map((a) => (
                <li key={a.activity}>
                  <strong>{a.label}</strong>
                  <span>
                    {a.sessions} logged · {formatDuration(a.durationSeconds)}
                    {a.distanceKm == null ? "" : ` · ${a.distanceKm} km`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="fine-print">
            {summary.sessions && previous.sessions
              ? `${formatDuration(Math.abs(difference))} ${difference < 0 ? "less" : "more"} time logged than the previous 7 days. `
              : ""}
            Logged entries only. Blank days are unrecorded; this is not a target
            or a readiness score.
          </p>
        </>
      )}
      {compact && (
        <a className="text-link" href="#cardio">
          Open cardio & movement <ArrowRight size={16} />
        </a>
      )}
    </section>
  );
}
export function CardioView({
  journal,
  go,
}: {
  journal: JournalController;
  go: (route: string) => void;
}) {
  const [editing, setEditing] = useState<CardioEntry | "new" | null>(null),
    [removing, setRemoving] = useState<CardioEntry | null>(null),
    [error, setError] = useState("");
  const [activity, setActivity] = useState<CardioActivity | "all">("all"),
    [period, setPeriod] = useState("30"),
    [limit, setLimit] = useState(20),
    [removingBusy, setRemovingBusy] = useState(false);
  const state = journal.state!;
  const from =
    period === "all" ? "0001-01-01" : offsetDate(today(), -Number(period) + 1);
  const entries = cardioSummary(
    state,
    from,
    today(),
    activity === "all" ? undefined : activity,
  ).entries;
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">YOUR ACTIVE LIFE</div>
          <h1>Cardio & movement</h1>
          <p className="lead">
            Your runs, rides, walks and everything in between.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus size={18} />
          Log activity
        </Button>
      </div>
      <div className="cardio-start panel">
        <div className="cardio-start-icons" aria-hidden="true">
          <Footprints size={24} />
          <Bike size={25} />
          <Activity size={24} />
        </div>
        <div>
          <h2>Tell Coach what you did.</h2>
          <p>
            “I ran 5 km in 28 minutes today.” Add an activity screenshot or
            describe the session, then review before saving.
          </p>
        </div>
        <Button variant="secondary" onClick={() => go("coach/cardio")}>
          <Sparkles size={17} />
          Log with Coach
        </Button>
      </div>
      <CardioProgress state={state} />
      <section aria-label="Activity history">
        <div className="cardio-section-heading">
          <h2>Activity history</h2>
          <span className="fine-print">{entries.length} in this view</span>
        </div>
        <div className="picker-bar cardio-filters">
          <label>
            Activity type
            <select
              value={activity}
              onChange={(e) => {
                setActivity(e.target.value as CardioActivity | "all");
                setLimit(20);
              }}
            >
              <option value="all">All activities</option>
              {cardioActivities.map((a) => (
                <option value={a} key={a}>
                  {cardioLabels[a]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setLimit(20);
              }}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </label>
        </div>
        {!entries.length ? (
          <div className="panel empty">
            <Activity size={30} />
            <h3>
              {state.cardio.sessions.length
                ? "No activities in this view"
                : "Your movement belongs here"}
            </h3>
            <p>
              {state.cardio.sessions.length
                ? "Try another activity or date range."
                : "Start with the activity and duration. Add other details when you know them."}
            </p>
            <Button variant="secondary" onClick={() => setEditing("new")}>
              Log an activity
            </Button>
          </div>
        ) : (
          <div className="history-list">
            {entries.slice(0, limit).map((entry) => (
              <details className="panel cardio-history" key={entry.id}>
                <summary>
                  <div>
                    <strong>{cardioTitle(entry)}</strong>
                    <span>
                      {entry.date} · {formatDuration(entry.durationSeconds)}
                      {entry.distanceKm == null
                        ? ""
                        : ` · ${entry.distanceKm} km`}
                    </span>
                  </div>
                  <span className="cardio-rate">
                    {cardioRate(entry) ?? "Details"}
                  </span>
                </summary>
                <CardioDetails entry={entry} />
                <div className="button-row">
                  <Button variant="secondary" onClick={() => setEditing(entry)}>
                    Edit activity
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError("");
                      setRemoving(entry);
                    }}
                  >
                    <Trash2 size={16} />
                    Delete activity
                  </Button>
                </div>
              </details>
            ))}
          </div>
        )}
        {entries.length > limit && (
          <Button variant="secondary" onClick={() => setLimit((n) => n + 20)}>
            Show more activities
          </Button>
        )}
      </section>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing === "new" ? "Log a cardio activity" : "Edit cardio activity"
        }
      >
        {editing && (
          <ActivityForm
            key={editing === "new" ? "new" : editing.id}
            journal={journal}
            entry={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !removingBusy) setRemoving(null);
        }}
        title="Delete this activity?"
        description="This removes only the selected cardio entry. Other training, food and health records are kept."
      >
        {removing && (
          <p>
            {cardioTitle(removing)} · {removing.date} ·{" "}
            {formatDuration(removing.durationSeconds)}
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <Button
          disabled={removingBusy}
          onClick={async () => {
            if (!removing) return;
            setRemovingBusy(true);
            try {
              await journal.update((s) => {
                s.cardio.sessions = s.cardio.sessions.filter(
                  (a) => a.id !== removing.id,
                );
              });
              setRemoving(null);
            } catch {
              setError("Could not delete the activity. Try again.");
            } finally {
              setRemovingBusy(false);
            }
          }}
        >
          {removingBusy ? "Deleting…" : "Confirm delete"}
        </Button>
      </Dialog>
    </>
  );
}
