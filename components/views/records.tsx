"use client";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Dumbbell,
  FileUp,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  backup,
  EXERCISES,
  exerciseName,
  mergeImport,
  parseLegacyBackup,
  PR_DEFINITIONS,
  today,
} from "@/lib/domain";
import { getLocal } from "@/lib/local";
import { isValidLoggedSet } from "@/js/progression.js";
import type { JournalState, Workout } from "@/lib/model";
import type { JournalController } from "../journal";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Technique } from "./workouts";
type Props = {
  state: JournalState;
  update: JournalController["update"];
  notify: (message: string) => void;
};
export function downloadBackup(value: unknown, label = "backup") {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lift-journal-${label}-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function HistoryView({
  state,
  update,
  go,
  notify,
}: Props & { go: (route: string) => void }) {
  const [filter, setFilter] = useState("all"),
    [date, setDate] = useState(""),
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
          <div className="eyebrow">YOUR TRAINING STORY</div>
          <h1>Work you can build on.</h1>
          <p className="lead">
            {state.sessions.length} saved sessions. Every one counts.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => downloadBackup(backup(state))}
        >
          <Download size={17} />
          Export journal
        </Button>
      </div>
      <div className="picker-bar">
        <label>
          Exercise
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
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
      {sessions.length ? (
        <div className="history-list">
          {sessions.map((s) => (
            <details className="panel history-detail" key={s.id}>
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
                <ArrowUpRight size={20} />
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
                          {set.weight} kg × {set.reps}
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
          <div className="eyebrow">PROGRESS, SESSION BY SESSION</div>
          <h1>See your strength grow.</h1>
          <p className="lead">
            Your recorded lifts, personal bests and next milestones.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit personal bests
        </Button>
      </div>
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
            {p.target && (
              <span className="muted">Next target: {p.target} kg</span>
            )}
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
export function LibraryView() {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all");
  const items = EXERCISES.filter(
    (e) =>
      (category === "all" || e.category === category) &&
      `${e.name} ${e.purpose}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">MOVE WITH INTENT</div>
          <h1>Your technique library.</h1>
          <p className="lead">
            Demonstrations and cues for every part of your training.
          </p>
        </div>
      </div>
      <div className="picker-bar">
        <label className="search-field">
          <Search size={19} />
          <input
            aria-label="Search exercises"
            placeholder="Find an exercise…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All exercises</option>
            {[...new Set(EXERCISES.map((e) => e.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="library-grid">
        {items.map((e, i) => (
          <article className="panel library-card" key={e.id}>
            <div className="section-top">
              <span className={`program-index index-${i % 4}`}>
                <Dumbbell size={22} />
              </span>
              <span className="pill">{e.category}</span>
            </div>
            <h2>{e.name}</h2>
            <p className="muted">{e.purpose}</p>
            <ul className="cues">
              {e.cues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="section-top">
              <Technique exerciseId={e.id} />
              {e.sourceUrl && (
                <a
                  className="text-link"
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Source <ArrowUpRight size={16} />
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="empty">
          <h2>No exercises found.</h2>
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setCategory("all");
            }}
          >
            Clear search
          </Button>
        </div>
      )}
    </>
  );
}
export function SettingsView({
  journal,
  onLogin,
  notify,
}: {
  journal: JournalController;
  onLogin: () => void;
  notify: (message: string) => void;
}) {
  const { state, identity, update } = journal;
  const [incoming, setIncoming] = useState<JournalState | null>(null),
    [importError, setImportError] = useState("");
  if (!state) return null;
  const prepare = (raw: unknown) => {
    try {
      const parsed = parseLegacyBackup(raw);
      mergeImport(state, parsed);
      setIncoming(parsed);
      setImportError("");
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : "This backup could not be imported.",
      );
    }
  };
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">YOUR JOURNAL, YOURS TO KEEP</div>
          <h1>Make yourself at home.</h1>
          <p className="lead">Your profile, account and training backups.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <h2>Your account</h2>
          <p>
            {identity
              ? identity.email
              : "Training is saved on this device. Sign in to sync across devices."}
          </p>
          {identity ? (
            <div className="button-row">
              <Button variant="secondary" onClick={() => void journal.sync()}>
                <RefreshCw size={16} />
                Sync now
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  void journal.signOut().catch((e) => notify(e.message))
                }
              >
                <LogOut size={16} />
                Sign out
              </Button>
            </div>
          ) : (
            <Button onClick={onLogin}>
              <LogIn size={18} />
              Sign in
            </Button>
          )}
          <p className="fine-print">
            {identity
              ? `Last saved: ${new Date(state.updatedAt).toLocaleString()}`
              : "Export a backup before clearing browser data or changing devices."}
          </p>
          <a href="/privacy" className="fine-print underline underline-offset-4">
            Privacy and your data
          </a>
        </section>
        <section className="panel">
          <h2>Athlete profile</h2>
          <form
            key={[
              identity?.id,
              state.profile.name,
              state.profile.bodyweight,
              state.profile.age,
            ].join("|")}
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              await update((s) => {
                s.profile = {
                  ...s.profile,
                  name: String(form.get("name")),
                  bodyweight: Number(form.get("bodyweight") || 0),
                  age: Number(form.get("age") || 0),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                };
              });
              notify("Profile saved.");
            }}
          >
            <label>
              Name
              <input
                name="name"
                maxLength={120}
                defaultValue={state.profile.name ?? identity?.name ?? ""}
              />
            </label>
            <div className="form-grid">
              <label>
                Bodyweight · kg
                <input
                  name="bodyweight"
                  type="number"
                  min="0"
                  max="1000"
                  step="any"
                  defaultValue={state.profile.bodyweight || ""}
                />
              </label>
              <label>
                Age
                <input
                  name="age"
                  type="number"
                  min="0"
                  max="130"
                  step="1"
                  defaultValue={state.profile.age || ""}
                />
              </label>
            </div>
            <Button variant="secondary" type="submit">
              Save profile
            </Button>
          </form>
        </section>
        <section className="panel backup-panel">
          <span className="program-index">
            <Download size={24} />
          </span>
          <h2>A copy you can keep.</h2>
          <p className="muted">
            Export your sessions, personal bests, notes and unfinished workout
            in one portable JSON file.
          </p>
          <Button
            variant="secondary"
            onClick={() => downloadBackup(backup(state))}
          >
            <Download size={17} />
            Export backup
          </Button>
        </section>
        <section className="panel">
          <span className="program-index index-1">
            <FileUp size={24} />
          </span>
          <h2>Bring your training with you.</h2>
          <p className="muted">
            Import a Lift Journal backup from the original website or another
            device. You’ll review it before anything is saved.
          </p>
          <label className="file-button">
            Choose JSON backup
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  setImportError("Choose a backup smaller than 5 MB.");
                  return;
                }
                try {
                  prepare(JSON.parse(await file.text()));
                } catch {
                  setImportError("That file is not valid JSON.");
                }
                e.target.value = "";
              }}
            />
          </label>
          {identity && (
            <Button
              variant="ghost"
              onClick={async () => prepare((await getLocal("guest")).state)}
            >
              Import this device’s unsigned journal
            </Button>
          )}
          {importError && (
            <p className="error-text" role="alert">
              {importError}
            </p>
          )}
        </section>
        <section className="panel">
          <h2>App & offline access</h2>
          <p className="muted">
            On iPhone, open this site in Safari and choose Share → Add to Home
            Screen. Open it online once before training offline. Technique
            videos need an internet connection.
          </p>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const registration =
                  await navigator.serviceWorker?.getRegistration();
                await registration?.update();
                if (registration?.waiting) {
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => location.reload(),
                    { once: true },
                  );
                  registration.waiting.postMessage({ type: "ACTIVATE" });
                } else location.reload();
              } catch {
                notify("Reconnect to check for an app update.");
              }
            }}
          >
            <RefreshCw size={17} />
            Refresh app
          </Button>
        </section>
        <section className="panel">
          <h2>Privacy</h2>
          <p className="muted">
            Your training stays on this device until you sign in and sync.
            Signed-in journals are stored privately in PostgreSQL. Technique
            videos connect to YouTube only when you open them.
          </p>
          <p className="muted">
            Keep your own exports for long-term recovery. Contact the app owner
            to request account deletion during the private pilot.
          </p>
        </section>
      </div>
      <Dialog
        open={Boolean(incoming)}
        onOpenChange={(open) => {
          if (!open) setIncoming(null);
        }}
        title="Review your backup"
        description="Existing sessions with identical IDs are skipped. Conflicting versions are stopped for review. Importing keeps your current journal and adds missing sessions."
      >
        <div className="import-counts">
          <strong>
            {incoming?.sessions.length ?? 0}
            <span>sessions</span>
          </strong>
          <strong>
            {incoming?.sessions.reduce(
              (n, w) => n + w.exercises.reduce((n, e) => n + e.sets.length, 0),
              0,
            ) ?? 0}
            <span>sets</span>
          </strong>
          <strong>
            {incoming?.activeWorkout ? 1 : 0}
            <span>active draft</span>
          </strong>
        </div>
        <p className="muted">
          {state.sessions.length
            ? "Your current profile and PRs will be kept."
            : "An empty journal also takes the backup’s profile and personal bests."}
        </p>
        <div className="button-row">
          <Button
            onClick={async () => {
              if (!incoming) return;
              try {
                await update((current) => mergeImport(current, incoming));
                setIncoming(null);
                notify("Backup imported and saved on this device.");
              } catch (e) {
                setImportError(
                  e instanceof Error ? e.message : "Import failed.",
                );
                setIncoming(null);
              }
            }}
          >
            Import backup
          </Button>
          <Button variant="secondary" onClick={() => setIncoming(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </>
  );
}
