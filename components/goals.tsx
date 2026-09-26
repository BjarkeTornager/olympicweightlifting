"use client";
import { useState } from "react";
import {
  applyGoals,
  bodyGoalsInputSchema,
  describePlan,
  planGoals,
  type BodyGoalsInput,
} from "@/lib/body-goals";
import { today } from "@/lib/domain";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { ChevronRight, Mic, TrendingUp } from "./ui/icons";

// Today's goals row: the plan at a glance, or a way to set it up.
export function GoalsCard({
  journal,
  go,
  voiceEnabled,
}: {
  journal: JournalController;
  go: (route: string) => void;
  voiceEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const body = journal.state!.profile.body;
  const plan = body ? planGoals(body, today()) : null;
  return (
    <>
      {body && plan ? (
        <section className="list-card" aria-label="Your goals">
          <button
            className="list-row today-record"
            onClick={() => setOpen(true)}
          >
            <TrendingUp size={22} />
            <span>
              <strong>Goals</strong>
              <small>
                {body.targetWeightKg} kg goal · {plan.sessionsPerWeek} sessions
                a week
              </small>
            </span>
            <span className="today-record-value">
              {plan.calories.toLocaleString("en-GB")} <small>kcal/day</small>
            </span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </section>
      ) : (
        <section className="panel goals-start" aria-label="Your goals">
          <h2>Set your goals</h2>
          <p className="muted">
            Your weight, height and goal weight give you a daily calorie target
            and how often to train.
          </p>
          <div className="button-row">
            {voiceEnabled && (
              <Button onClick={() => go("coach/voice/goals")}>
                <Mic size={18} /> Set up with Coach
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Fill in yourself
            </Button>
          </div>
        </section>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Your goals"
        description="Coach uses these for your daily calories and training."
      >
        {open && <GoalsForm journal={journal} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

type Draft = Record<keyof BodyGoalsInput, string>;

function GoalsForm({
  journal,
  onDone,
}: {
  journal: JournalController;
  onDone: () => void;
}) {
  const state = journal.state!;
  const body = state.profile.body;
  const [draft, setDraft] = useState<Draft>(() => ({
    age: String(body?.age ?? (state.profile.age || "")),
    sex: body?.sex ?? "unspecified",
    heightCm: String(body?.heightCm ?? ""),
    weightKg: String(body?.weightKg ?? (state.profile.bodyweight || "")),
    targetWeightKg: String(body?.targetWeightKg ?? ""),
    targetDate: body?.targetDate ?? "",
    activity: body?.activity ?? "moderate",
    trainingDays: String(
      body?.trainingDays ?? state.profile.lifting?.daysPerWeek ?? 3,
    ),
    sessionMinutes: String(
      body?.sessionMinutes ?? state.profile.lifting?.minutesPerSession ?? 75,
    ),
    experience: body?.experience ?? "developing",
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const number = (v: string) => (v.trim() ? Number(v) : NaN);
  const parsed = bodyGoalsInputSchema.safeParse({
    ...draft,
    age: number(draft.age),
    heightCm: number(draft.heightCm),
    weightKg: number(draft.weightKg),
    targetWeightKg: number(draft.targetWeightKg),
    targetDate: draft.targetDate || null,
    trainingDays: number(draft.trainingDays),
    sessionMinutes: number(draft.sessionMinutes),
  });
  const plan = parsed.success ? planGoals(parsed.data, today()) : null;
  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value })),
  });
  return (
    <form
      className="checkin-form goals-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!parsed.success) return;
        setSaving(true);
        setError("");
        try {
          await journal.update((s) => {
            applyGoals(s, parsed.data, today());
          });
          onDone();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Could not save your goals.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="checkin-number-grid">
        <label>
          Age
          <input inputMode="numeric" required {...field("age")} />
        </label>
        <label>
          Height (cm)
          <input inputMode="decimal" required {...field("heightCm")} />
        </label>
        <label>
          Sex
          <select {...field("sex")}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="unspecified">Prefer not to say</option>
          </select>
        </label>
        <label>
          Weight now (kg)
          <input inputMode="decimal" required {...field("weightKg")} />
        </label>
        <label>
          Goal weight (kg)
          <input inputMode="decimal" required {...field("targetWeightKg")} />
        </label>
        <label>
          By (optional)
          <input type="date" min={today()} {...field("targetDate")} />
        </label>
        <label>
          Active outside training
          <select {...field("activity")}>
            <option value="low">Mostly sitting</option>
            <option value="moderate">On my feet some</option>
            <option value="high">Physical work</option>
          </select>
        </label>
        <label>
          Days I can train
          <input inputMode="numeric" required {...field("trainingDays")} />
        </label>
        <label>
          Experience
          <select {...field("experience")}>
            <option value="new">Learning the lifts</option>
            <option value="developing">Building consistency</option>
            <option value="experienced">Experienced</option>
          </select>
        </label>
      </div>
      {plan && parsed.success ? (
        <div className="goals-plan" role="status">
          <strong>{describePlan(parsed.data, plan)}</strong>
          {plan.notes.map((note) => (
            <p key={note} className="fine-print">
              {note}
            </p>
          ))}
        </div>
      ) : (
        <p className="fine-print">
          Fill in the numbers to see your daily plan.
        </p>
      )}
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!plan || saving}>
        {saving ? "Saving…" : "Save goals"}
      </Button>
    </form>
  );
}
