"use client";
import { useState } from "react";
import {
  applyGoals,
  bodyGoalsRequestSchema,
  describePlan,
  describeSessions,
  planForState,
  planGoals,
  splitGoals,
  type BodyGoalsInput,
} from "@/lib/body-goals";
import { latestBodyFat, type BodyFocus } from "@/lib/body-composition";
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
  const plan = planForState(journal.state!, today());
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
                {body.targetWeightKg} kg goal ·{" "}
                {describeSessions(plan.sessionsPerWeek).toLowerCase()}
              </small>
            </span>
            <span className="today-record-value">
              {plan.dailyTargets ? (
                <>
                  {plan.calories.toLocaleString("en-GB")}{" "}
                  <small>kcal/day</small>
                </>
              ) : (
                <small>No daily target</small>
              )}
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

type Draft = Record<
  | keyof BodyGoalsInput
  | "focus"
  | "bodyFatPercent"
  | "targetBodyFatPercent"
  | "pregnancy",
  string
>;
const focusLabels: Record<BodyFocus, string> = {
  lose_fat: "Lose fat",
  build_muscle: "Build muscle",
  recomposition: "Recomposition (lose fat, build muscle)",
  maintain: "Maintain",
};

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
    focus: state.profile.bodyTargets?.focus ?? "",
    bodyFatPercent: String(latestBodyFat(state, today())?.percent ?? ""),
    targetBodyFatPercent: String(
      state.profile.bodyTargets?.targetBodyFatPercent ?? "",
    ),
    pregnancy: state.profile.goalChecks?.pregnancy ?? "",
  }));
  // A loss towards a weight just under the healthy range, confirmed for
  // the saved goal weight.
  const [confirmed, setConfirmed] = useState(
    body != null &&
      state.profile.goalChecks?.lowWeightConfirmedKg === body.targetWeightKg,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const number = (v: string) => (v.trim() ? Number(v) : NaN);
  const optional = (v: string) => (v.trim() ? Number(v) : undefined);
  const knownFat = latestBodyFat(state, today())?.percent;
  // Under 18 the plan uses no body fat, so the form doesn't ask for it.
  const minor = number(draft.age) < 18;
  // Asked of anyone who isn't male, up to 55, and kept while it's set.
  const asksPregnancy =
    Boolean(draft.pregnancy) ||
    (draft.sex !== "male" && !(number(draft.age) > 55));
  const parsed = bodyGoalsRequestSchema.safeParse({
    ...draft,
    focus: draft.focus || undefined,
    // Record a body fat reading only when it changed.
    bodyFatPercent:
      minor || optional(draft.bodyFatPercent) === knownFat
        ? undefined
        : optional(draft.bodyFatPercent),
    targetBodyFatPercent: minor
      ? undefined
      : draft.targetBodyFatPercent.trim()
        ? Number(draft.targetBodyFatPercent)
        : null,
    // "Prefer not to say" keeps no status, so it removes a saved one, as
    // the preview shows.
    pregnancy:
      draft.pregnancy ||
      (state.profile.goalChecks?.pregnancy ? "neither" : undefined),
    age: number(draft.age),
    heightCm: number(draft.heightCm),
    weightKg: number(draft.weightKg),
    targetWeightKg: number(draft.targetWeightKg),
    targetDate: draft.targetDate || null,
    trainingDays: number(draft.trainingDays),
    sessionMinutes: number(draft.sessionMinutes),
  });
  const split = parsed.success ? splitGoals(parsed.data) : null;
  const preview =
    split &&
    ((lowWeightConfirmed: boolean) =>
      planGoals(split.goals, today(), {
        focus: split.composition.focus,
        targetBodyFatPercent: split.composition.targetBodyFatPercent,
        bodyFatPercent: optional(draft.bodyFatPercent) ?? null,
        pregnancy:
          draft.pregnancy === "pregnant" || draft.pregnancy === "breastfeeding"
            ? draft.pregnancy
            : null,
        lowWeightConfirmed,
      }));
  // A loss towards a weight just under the healthy range waits for the
  // athlete to confirm it.
  const asksConfirmation = preview ? preview(false).confirmToLose : false;
  const plan = preview ? preview(asksConfirmation && confirmed) : null;
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
            applyGoals(
              s,
              {
                ...parsed.data,
                confirmLowWeight: asksConfirmation && confirmed,
              },
              today(),
            );
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
          Focus
          <select {...field("focus")}>
            <option value="">From my goal weight</option>
            {(Object.keys(focusLabels) as BodyFocus[]).map((f) => (
              <option key={f} value={f}>
                {focusLabels[f]}
              </option>
            ))}
          </select>
        </label>
        {!minor && (
          <>
            <label>
              Body fat now (%, optional)
              <input inputMode="decimal" {...field("bodyFatPercent")} />
            </label>
            <label>
              Goal body fat (%, optional)
              <input inputMode="decimal" {...field("targetBodyFatPercent")} />
            </label>
          </>
        )}
        {asksPregnancy && (
          <label>
            Pregnant or breastfeeding
            <select {...field("pregnancy")}>
              <option value="">Prefer not to say</option>
              <option value="neither">Neither</option>
              <option value="pregnant">Pregnant</option>
              <option value="breastfeeding">Breastfeeding</option>
            </select>
          </label>
        )}
        <label>
          Experience
          <select {...field("experience")}>
            <option value="new">Learning the lifts</option>
            <option value="developing">Building consistency</option>
            <option value="experienced">Experienced</option>
          </select>
        </label>
      </div>
      {asksPregnancy && (
        <p className="fine-print">
          Optional. Kept with your goals only so the plan sets no targets in
          pregnancy and no deficit while breastfeeding; choose Neither or Prefer
          not to say to remove it.
        </p>
      )}
      {plan && split ? (
        <div className="goals-plan" role="status">
          <strong>{describePlan(split.goals, plan)}</strong>
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
      {asksConfirmation && (
        <label className="goals-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I still want to lose weight, slowly
        </label>
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
