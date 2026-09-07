"use client";
import { useState, useId } from "react";
import { ArrowRight, ChevronDown, Sparkles } from "@/components/ui/icons";
import { coachSuggestion, coachingSchema } from "@/lib/coaching";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";

export function CoachOpening({
  journal,
  date,
  compact = false,
  disabled,
  onDiscuss,
}: {
  journal: JournalController;
  date: string;
  compact?: boolean;
  disabled: boolean;
  onDiscuss: (prompt: string) => void;
}) {
  const detailId = useId();
  const account = journal.identity?.id;
  const key = `lift-coach:${account}`;
  const [hiddenDate, setHiddenDate] = useState(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const [open, setOpen] = useState(!compact);
  if (
    !account ||
    !journal.state ||
    hiddenDate === date ||
    journal.state.profile.coaching?.initiative === "on-request"
  )
    return null;
  const suggestion = coachSuggestion(journal.state, date);
  if (compact && suggestion.id === "get-to-know-you") return null;
  return (
    <aside
      className={`coach-opening ${compact ? "compact" : ""}`}
      aria-label="A thought from Coach"
    >
      <button
        className="coach-opening-toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen(!open)}
      >
        <Sparkles size={17} aria-hidden="true" />
        <span>
          <small>A THOUGHT FOR TODAY</small>
          <strong>{suggestion.title}</strong>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      <div id={detailId} hidden={!open}>
        <p>{suggestion.observation}</p>
        <p className="coach-opening-invitation">{suggestion.invitation}</p>
        <div className="coach-opening-actions">
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => onDiscuss(suggestion.prompt)}
          >
            Talk it through <ArrowRight size={15} />
          </Button>
          <button
            title="Hide this suggestion for today on this device"
            onClick={() => {
              setHiddenDate(date);
              try {
                localStorage.setItem(key, date);
              } catch {
                /* In-memory dismissal still works. */
              }
            }}
          >
            Hide for today
          </button>
        </div>
        <small className="coach-opening-source">
          {suggestion.id === "get-to-know-you"
            ? "Start with what matters"
            : "From your journal"}{" "}
          · At your pace
        </small>
      </div>
    </aside>
  );
}

export function CoachPreferences({
  journal,
  disabled,
}: {
  journal: JournalController;
  disabled: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const preferences = journal.state?.profile.coaching;
  return (
    <form
      className="coach-preferences form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSaving(true);
        setNotice("");
        setError("");
        try {
          const coaching = coachingSchema.parse({
            initiative: data.get("initiative"),
            focus: data.get("focus"),
          });
          await journal.update((state) => {
            state.profile.coaching = { ...state.profile.coaching, ...coaching };
          });
          setNotice("Coaching preferences saved with your journal.");
        } catch {
          setError("Your preferences could not be saved. Please try again.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <h3>Coaching that fits you</h3>
      <label>
        How Coach helps
        <select
          name="initiative"
          defaultValue={preferences?.initiative ?? "gentle"}
          disabled={disabled || saving}
        >
          <option value="gentle">Gentle suggestions</option>
          <option value="on-request">Advice only when I ask</option>
        </select>
      </label>
      <label>
        <span>
          What matters to you right now? <small>(optional)</small>
        </span>
        <textarea
          name="focus"
          maxLength={300}
          rows={3}
          defaultValue={preferences?.focus ?? ""}
          placeholder="For example: feel stronger while leaving energy for family life."
          disabled={disabled || saving}
        />
      </label>
      <p className="fine-print">
        Saved privately with your account and used when you chat. Change or
        clear your focus whenever it no longer fits.
      </p>
      <Button type="submit" disabled={disabled || saving}>
        {saving ? "Saving…" : "Save coaching preferences"}
      </Button>
      {notice && (
        <p role="status" className="fine-print">
          {notice}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
