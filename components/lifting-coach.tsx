"use client";
import { useState } from "react";
import { ArrowRight, Dumbbell, Sparkles } from "./ui/icons";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { LiftingBriefDetails } from "./lifting-brief";
import { today } from "@/lib/domain";
import {
  liftingReview,
  liftingBriefInputSchema,
  experienceLabels,
  type LiftingBriefInput,
} from "@/lib/lifting-coach";
import type { JournalState } from "@/lib/model";

type Update = (
  fn: (state: JournalState) => JournalState | void,
) => Promise<void>;
const emptyBrief: LiftingBriefInput = {
  goal: "",
  why: "",
  experience: "unknown",
  daysPerWeek: null,
  minutesPerSession: null,
  equipment: "",
  constraints: "",
  priority: "",
  targetDate: null,
};
function BriefForm({
  state,
  update,
  onDone,
}: {
  state: JournalState;
  update: Update;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<LiftingBriefInput>(() =>
    state.profile.lifting
      ? (Object.fromEntries(
          Object.keys(emptyBrief).map((key) => [
            key,
            state.profile.lifting![key as keyof LiftingBriefInput],
          ]),
        ) as LiftingBriefInput)
      : emptyBrief,
  );
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  async function save(clear = false) {
    setError("");
    const parsed = clear ? null : liftingBriefInputSchema.safeParse(draft);
    if (parsed && !parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    try {
      const brief = parsed?.success
        ? { ...parsed.data, updatedAt: new Date().toISOString() }
        : null;
      await update((s) => {
        s.profile.lifting = brief;
      });
      onDone();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save your brief. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  const textField = (
    key: "goal" | "why" | "equipment" | "constraints" | "priority",
    label: string,
    placeholder: string,
    maxLength = 300,
  ) => (
    <label>
      {label}
      <textarea
        aria-label={label}
        value={draft[key]}
        placeholder={placeholder}
        required={key === "goal"}
        maxLength={maxLength}
        rows={2}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  );
  return (
    <form
      className="lifting-brief-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="muted">
        Start with a goal. The other details are optional and can change with
        your life.
      </p>
      {textField(
        "goal",
        "Your lifting goal",
        "What would you like to work towards?",
      )}
      {textField(
        "why",
        "Why it matters to you",
        "Confidence, competition, enjoying training…",
      )}
      <label>
        Experience
        <select
          value={draft.experience}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              experience: e.target.value as LiftingBriefInput["experience"],
            }))
          }
        >
          {Object.entries(experienceLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Days per week
          <input
            type="number"
            min={1}
            max={7}
            step={1}
            value={draft.daysPerWeek ?? ""}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                daysPerWeek:
                  e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          />
        </label>
        <label>
          Minutes per session
          <input
            type="number"
            min={10}
            max={240}
            step={1}
            value={draft.minutesPerSession ?? ""}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                minutesPerSession:
                  e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          />
        </label>
      </div>
      {textField(
        "equipment",
        "Available equipment",
        "Barbell, plates, rack, blocks…",
        500,
      )}
      {textField(
        "constraints",
        "Schedule & constraints",
        "Travel, short sessions, movements you want to avoid…",
        500,
      )}
      {textField(
        "priority",
        "Current priority",
        "One thing you want help with, if you know",
      )}
      <label>
        Target date, if you have one
        <input
          type="date"
          value={draft.targetDate ?? ""}
          onChange={(e) =>
            setDraft((d) => ({ ...d, targetDate: e.target.value || null }))
          }
        />
      </label>
      <p className="fine-print">
        Private to your account. Coach can use this brief when you ask about
        lifting. Relevant details are shared with your assistant provider.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="button-row">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save lifting brief"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
      {state.profile.lifting && (
        <details>
          <summary>Clear saved brief</summary>
          <p className="fine-print">
            Removes these details from your profile. Earlier chats, approved
            memories, programs and sessions remain.
          </p>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => void save(true)}
          >
            Clear lifting brief
          </Button>
        </details>
      )}
    </form>
  );
}

const conversations = [
  ["plan", "Build my plan", "A practical program around your goal and week."],
  [
    "session",
    "Prepare for a session",
    "One focus and a clear way to check it.",
  ],
  [
    "debrief",
    "Review my last session",
    "What helped, what to keep, what to adjust.",
  ],
  [
    "technique",
    "Work on technique",
    "Describe the lift, or discuss a visible position in a photo.",
  ],
] as const;
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
export function LiftingCoach({
  state,
  update,
  go,
}: {
  state: JournalState;
  update: Update;
  go: (route: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const report = liftingReview(state, today());
  return (
    <div className="lifting-coach-page">
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">
            <Dumbbell size={16} /> YOUR LIFTING
          </div>
          <h1>A clear focus. A plan that fits.</h1>
          <p className="lead">
            Understand your training, work on one thing, then see what helps.
          </p>
        </div>
      </div>
      {report.activeWorkout && (
        <div className="lifting-active">
          <div>
            <span className="eyebrow">Ongoing workout</span>
            <strong>{report.activeWorkout.title}</strong>
            <span>
              {report.activeWorkout.loggedSets} sets logged ·{" "}
              {shortDate(report.activeWorkout.date)}
            </span>
          </div>
          <Button variant="secondary" onClick={() => go("workout")}>
            Continue <ArrowRight size={17} />
          </Button>
        </div>
      )}
      <div className="lifting-coach-layout">
        <section
          className="panel lifting-brief-panel"
          aria-labelledby="lifting-brief-title"
        >
          <div className="lifting-section-heading">
            <h2 id="lifting-brief-title">Your training brief</h2>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {state.profile.lifting ? "Edit brief" : "Add your brief"}
            </Button>
          </div>
          {state.profile.lifting ? (
            <>
              <p className="lifting-goal">{state.profile.lifting.goal}</p>
              <p className="muted">
                {state.profile.lifting.priority ||
                  "Choose a focus with Coach when you’re ready."}
              </p>
              <details>
                <summary>View your details</summary>
                <LiftingBriefDetails brief={state.profile.lifting} />
              </details>
            </>
          ) : (
            <p className="muted">
              Tell Coach what you’re working towards and how training fits your
              week. Start with what you know.
            </p>
          )}
          <p className="fine-print">
            Your own goals and constraints, saved privately with your journal.
          </p>
        </section>
        <section className="lifting-conversations" aria-label="Lift with Coach">
          {conversations.map(([intent, title, description]) => (
            <button key={intent} onClick={() => go(`coach/lifting/${intent}`)}>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
        </section>
      </div>
      <section
        className="panel lifting-evidence"
        aria-labelledby="lifting-evidence-title"
      >
        <div className="lifting-section-heading">
          <div>
            <span className="eyebrow">
              {shortDate(report.from)} – {shortDate(report.to)}
            </span>
            <h2 id="lifting-evidence-title">Your last four weeks</h2>
          </div>
          <Button
            variant="secondary"
            onClick={() => go("coach/lifting/review")}
          >
            <Sparkles size={16} /> Review with Coach
          </Button>
        </div>
        <p className="muted">
          {report.recordedSessions
            ? `${report.recordedSessions} recorded session${report.recordedSessions === 1 ? "" : "s"} · ${report.loggedSets} logged set${report.loggedSets === 1 ? "" : "s"}`
            : "No completed training recorded in this period. Start with your goal or log a session to build your picture."}
        </p>
        {report.recordedSessions > 0 && (
          <>
            <div
              className="lifting-table-scroll"
              role="region"
              aria-label="Weekly training evidence"
              tabIndex={0}
            >
              <table>
                <caption>
                  Logged training and reported sleep. Unlogged days are unknown.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Week ending</th>
                    <th scope="col">Sessions</th>
                    <th scope="col">Sets</th>
                    <th scope="col">Reported effort</th>
                    <th scope="col">Sleep</th>
                  </tr>
                </thead>
                <tbody>
                  {report.weeks.map((w) => (
                    <tr key={w.to}>
                      <th scope="row">{shortDate(w.to)}</th>
                      <td>{w.sessions || "No logs"}</td>
                      <td>{w.loggedSets || "—"}</td>
                      <td>
                        {w.rpeSets
                          ? `${w.averageReportedRpe}/10 · ${w.rpeSets} sets`
                          : "Not reported"}
                      </td>
                      <td>
                        {w.sleepNights
                          ? `${w.averageSleepHours} h · ${w.sleepNights} night${w.sleepNights === 1 ? "" : "s"}`
                          : "Not reported"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="lifting-record-details">
              <summary>Recorded lifts & set outcomes</summary>
              <p className="fine-print">
                Made and missed are reported set outcomes, including multi-rep
                sets. These aren’t technique scores or tested maximums.
              </p>
              <ul className="lifting-records">
                {report.exercises.map((e) => (
                  <li key={e.exerciseId}>
                    <div>
                      <strong>{e.name}</strong>
                      <span>
                        {e.madeSets} made · {e.missedSets} missed ·{" "}
                        {e.unratedSets} without an outcome
                      </span>
                    </div>
                    {e.bestRecordedSet ? (
                      <a href={`#history/${e.bestRecordedSet.sessionId}`}>
                        {e.bestRecordedSet.weight === 0
                          ? "Bodyweight"
                          : `${e.bestRecordedSet.weight} kg`}{" "}
                        × {e.bestRecordedSet.reps}
                        <small>
                          {shortDate(e.bestRecordedSet.date)} · recorded set
                        </small>
                      </a>
                    ) : (
                      <span>No made or unrated set recorded</span>
                    )}
                  </li>
                ))}
              </ul>
              {report.totalExercises > report.exercises.length && (
                <p>
                  Showing {report.exercises.length} of {report.totalExercises}{" "}
                  exercises. See History for every record.
                </p>
              )}
            </details>
          </>
        )}
        <div className="button-row">
          <Button variant="ghost" onClick={() => go("history")}>
            Training history <ArrowRight size={16} />
          </Button>
          <Button variant="ghost" onClick={() => go("workout/choose")}>
            Your programs <ArrowRight size={16} />
          </Button>
        </div>
      </section>
      <section
        className="lifting-method"
        aria-label="How lifting coaching works"
      >
        <h2>Make each change useful.</h2>
        <ol>
          <li>
            <strong>Understand</strong>
            <span>Your goal, training and available time.</span>
          </li>
          <li>
            <strong>Try one thing</strong>
            <span>A clear priority, with a reason and a check.</span>
          </li>
          <li>
            <strong>Reflect & adjust</strong>
            <span>Keep what helps. Simplify what doesn’t.</span>
          </li>
        </ol>
        <p className="fine-print">
          Coach uses your reports and journal. Photos can show a position; full
          lifting-video analysis isn’t available here. Technique questions that
          need movement assessment are best reviewed with a qualified coach in
          person.
        </p>
      </section>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title="Your lifting brief"
        description="Training that fits your goals and your life."
      >
        {editing && (
          <BriefForm
            state={state}
            update={update}
            onDone={() => setEditing(false)}
          />
        )}
      </Dialog>
    </div>
  );
}
