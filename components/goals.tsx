"use client";
import { useState } from "react";
import {
  applyGoals,
  babyWeeks,
  bodyGoalsRequestSchema,
  describePlan,
  describeSessions,
  energyQuestionsFor,
  energySigns,
  goalsForState,
  goalsHeading,
  planForState,
  planGoals,
  POSTPARTUM_WEEKS,
  savedTraining,
  splitGoals,
  type BodyGoalsInput,
} from "@/lib/body-goals";
import { latestBodyFat, type BodyFocus } from "@/lib/body-composition";
import {
  activeGoalsCheck,
  followUpGoals,
  goalsCheckClosedNote,
  goalsCheckDate,
  goalsCheckNote,
  goalsPlanChanges,
  takeTargetsProposal,
} from "@/lib/coaching";
import { today } from "@/lib/domain";
import { dailyTarget } from "@/lib/nutrition";
import { currentWeightKg, targetsInForce } from "@/lib/target-history";
import {
  keepCurrentTargets,
  targetsProposal,
  type TargetsProposal,
} from "@/lib/target-proposals";
import type { JournalController } from "./journal";
import { TargetsReview } from "./coach-proposal";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { ChevronRight, Mic, Sparkles, TrendingUp } from "./ui/icons";

// Today's goals row: the goal and the saved daily target, which is the one
// shown everywhere, or a way to set it up. When the plan, worked out again
// at the current weight, suggests new targets, a second row offers them
// for review; nothing changes until the athlete takes them.
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
  const [reviewing, setReviewing] = useState(false);
  const state = journal.state!;
  const body = state.profile.body;
  const date = today();
  const plan = planForState(state, date);
  const proposal = targetsProposal(state, date);
  const calories = dailyTarget(state.nutrition.targets.calories);
  // Targets the athlete set themselves, beside the plan's estimate.
  const own =
    targetsInForce(state).source === "manual" &&
    plan?.dailyTargets &&
    plan.calories !== calories;
  const suggested = proposal && dailyTarget(proposal.targets.calories);
  return (
    <>
      {body && plan ? (
        <section className="list-card today-records" aria-label="Your goals">
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
                {own &&
                  ` · your own target; the plan estimates about ${plan.calories.toLocaleString("en-GB")} kcal`}
              </small>
            </span>
            <span className="today-record-value">
              {calories != null ? (
                <>
                  {calories.toLocaleString("en-GB")} <small>kcal/day</small>
                </>
              ) : (
                <small>No daily target</small>
              )}
            </span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
          {proposal && (
            <button
              className="list-row today-record"
              onClick={() => setReviewing(true)}
            >
              <Sparkles size={22} />
              <span>
                <strong>{proposalTitle(proposal)}</strong>
                <small>Suggested by your goals plan</small>
              </span>
              <span className="today-record-value">
                {suggested != null ? (
                  <>
                    {suggested.toLocaleString("en-GB")} <small>kcal/day</small>
                  </>
                ) : (
                  <small>No daily target</small>
                )}
              </span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          )}
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
      <Dialog
        open={reviewing && proposal != null}
        onOpenChange={setReviewing}
        title={proposal ? proposalTitle(proposal) : "New daily targets"}
        description="Your goals plan suggests these. Nothing changes unless you take them."
      >
        {reviewing && proposal && (
          <ProposalReview
            journal={journal}
            proposal={proposal}
            onDone={() => setReviewing(false)}
          />
        )}
      </Dialog>
    </>
  );
}

const proposalTitle = (proposal: TargetsProposal) =>
  proposal.maintain ? "Hold your weight from here" : "New daily targets";

// The plan's suggestion: why, the targets now and suggested, the plan's
// notes, and the goals check that taking it agrees or closes, as the goals
// form says. Taking it saves the plan's targets; keeping the current ones
// means it isn't suggested again until the plan moves on.
function ProposalReview({
  journal,
  proposal,
  onDone,
}: {
  journal: JournalController;
  proposal: TargetsProposal;
  onDone: () => void;
}) {
  const state = journal.state!;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const checkFrom = goalsCheckDate(state, proposal.plan, today());
  const closes = goalsPlanChanges(proposal.plan)
    ? undefined
    : activeGoalsCheck(state);
  const choose = async (take: boolean) => {
    setSaving(true);
    setError("");
    try {
      await journal.update((s) => {
        if (take) takeTargetsProposal(s, today(), proposal.targets);
        else keepCurrentTargets(s, today(), proposal.targets);
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your choice.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="checkin-form goals-form">
      <div className="goals-plan" role="status">
        {proposal.reasons.map((reason) => (
          <strong key={reason}>{reason}</strong>
        ))}
        {proposal.plan.notes
          .filter((note) => !proposal.reasons.includes(note))
          .map((note) => (
            <p key={note} className="fine-print">
              {note}
            </p>
          ))}
        {checkFrom && <p className="fine-print">{goalsCheckNote(checkFrom)}</p>}
        {closes && (
          <p className="fine-print">
            {goalsCheckClosedNote(closes.followUpDate)}
          </p>
        )}
      </div>
      <TargetsReview after={proposal.targets} before={proposal.current} />
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <Button disabled={saving} onClick={() => void choose(true)}>
          Use these targets
        </Button>
        <Button
          variant="secondary"
          disabled={saving}
          onClick={() => void choose(false)}
        >
          Keep my current targets
        </Button>
      </div>
    </div>
  );
}

type Draft = Record<
  | keyof BodyGoalsInput
  | "focus"
  | "bodyFatPercent"
  | "targetBodyFatPercent"
  | "pregnancy"
  | "weeksSinceBirth"
  | "limitProtein"
  | "energySigns",
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
  const body = goalsForState(state);
  const training = savedTraining(state);
  const health = state.profile.goalHealth;
  // The baby's age in whole weeks today, from the day it was born. Sent
  // back unchanged, it keeps that day (applyGoals).
  const babyAge = babyWeeks(state, today());
  // The low-energy answers in force: sent back unchanged, they keep their
  // day, so saving again never stretches a no past 3 months.
  const signs = energySigns(state, today());
  // Sex and everyday activity are left for the athlete to choose: a default
  // would quietly change the plan.
  const [draft, setDraft] = useState<Draft>(() => ({
    age: String(body?.age ?? (state.profile.age || "")),
    sex: body?.sex ?? "",
    heightCm: String(body?.heightCm ?? ""),
    // The current weight: the last week's weigh-ins, or the weight last
    // given (currentWeightKg).
    weightKg: String(
      currentWeightKg(state, today()) ??
        body?.weightKg ??
        (state.profile.bodyweight || ""),
    ),
    targetWeightKg: String(body?.targetWeightKg ?? ""),
    targetDate: body?.targetDate ?? "",
    activity: body?.activity ?? "",
    trainingDays: String(
      body?.trainingDays ?? state.profile.lifting?.daysPerWeek ?? 3,
    ),
    sessionMinutes: String(training.sessionMinutes ?? 75),
    experience: training.experience ?? "developing",
    focus: state.profile.bodyTargets?.focus ?? "",
    bodyFatPercent: String(latestBodyFat(state, today())?.percent ?? ""),
    targetBodyFatPercent: String(
      state.profile.bodyTargets?.targetBodyFatPercent ?? "",
    ),
    pregnancy: state.profile.goalChecks?.pregnancy ?? "",
    weeksSinceBirth: babyAge == null ? "" : String(babyAge),
    limitProtein: health?.limitProtein ? "yes" : "",
    energySigns: signs == null ? "" : signs ? "yes" : "no",
  }));
  // The goal weight is a competition weight class, its weigh-in the date.
  const [weightClass, setWeightClass] = useState(
    body != null && state.profile.weighIn?.classKg === body.targetWeightKg,
  );
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
  // Asked of women and anyone who'd rather not say, up to 55, and kept
  // while it's set.
  const asksPregnancy =
    Boolean(draft.pregnancy) ||
    ((draft.sex === "female" || draft.sex === "unspecified") &&
      !(number(draft.age) > 55));
  // A weight class is a limit to make: asked when the goal weight is below
  // the current one, and kept while it is.
  const classOffered =
    number(draft.targetWeightKg) < number(draft.weightKg) ||
    Boolean(state.profile.weighIn);
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
    // Likewise an empty baby's age removes a saved one.
    weeksSinceBirth:
      draft.pregnancy !== "breastfeeding"
        ? undefined
        : draft.weeksSinceBirth.trim()
          ? Number(draft.weeksSinceBirth)
          : null,
    limitProtein:
      draft.limitProtein === "yes"
        ? true
        : draft.limitProtein === "no" || health?.limitProtein
          ? false
          : undefined,
    // "Prefer not to say" removes saved answers.
    energySigns:
      draft.energySigns === "yes"
        ? true
        : draft.energySigns === "no"
          ? false
          : state.profile.energyCheck
            ? null
            : undefined,
    weightClass: classOffered
      ? weightClass
      : state.profile.weighIn
        ? false
        : undefined,
    age: number(draft.age),
    heightCm: number(draft.heightCm),
    weightKg: number(draft.weightKg),
    targetWeightKg: number(draft.targetWeightKg),
    targetDate: draft.targetDate || null,
    trainingDays: number(draft.trainingDays),
    sessionMinutes: number(draft.sessionMinutes),
  });
  const split = parsed.success ? splitGoals(parsed.data) : null;
  // When only sex or everyday activity is left to choose, the form names
  // it: Save stays disabled, so the browser never points at the select.
  const unchosen = [
    ...(draft.sex ? [] : ["your sex"]),
    ...(draft.activity ? [] : ["how active you are outside training"]),
  ];
  const waiting =
    !parsed.success &&
    unchosen.length > 0 &&
    parsed.error.issues.every(
      (issue) => issue.path[0] === "sex" || issue.path[0] === "activity",
    )
      ? `Choose ${unchosen.join(" and ")} to see your daily plan.`
      : "Fill in the numbers to see your daily plan.";
  const preview =
    split &&
    ((lowWeightConfirmed: boolean, answered = true) =>
      planGoals(split.goals, today(), {
        focus: split.composition.focus,
        targetBodyFatPercent: split.composition.targetBodyFatPercent,
        bodyFatPercent: optional(draft.bodyFatPercent) ?? null,
        pregnancy:
          draft.pregnancy === "pregnant" || draft.pregnancy === "breastfeeding"
            ? draft.pregnancy
            : null,
        weeksSinceBirth: split.checks.weeksSinceBirth ?? null,
        limitProtein: draft.limitProtein === "yes",
        lowWeightConfirmed,
        energySigns: answered ? (split.checks.energySigns ?? null) : null,
        weightClass: split.checks.weightClass ?? false,
        // As the saved goals will head, so the preview's notes are the
        // saved plan's.
        heading: goalsHeading(split.goals, split.checks.weightClass ?? false),
      }));
  // A loss towards a weight just under the healthy range waits for the
  // athlete to confirm it.
  const asksConfirmation = preview ? preview(false).confirmToLose : false;
  const plan = preview ? preview(asksConfirmation && confirmed) : null;
  // Targets the athlete set themselves, which saving the goals replaces.
  const ownCalories =
    targetsInForce(state).source === "manual"
      ? dailyTarget(state.nutrition.targets.calories)
      : null;
  // Saved, a plan that changes weight agrees a check of the weight trend
  // about 3 weeks on, as with Coach, and one that doesn't closes an active
  // check (followUpGoals).
  const checkFrom = plan ? goalsCheckDate(state, plan, today()) : null;
  const closes =
    plan && !goalsPlanChanges(plan) ? activeGoalsCheck(state) : undefined;
  // The low-energy questions come before a plan that would cut or aim very
  // lean, and stay while there are answers to change or remove.
  const asksEnergy =
    Boolean(draft.energySigns) ||
    Boolean(state.profile.energyCheck) ||
    (preview
      ? preview(asksConfirmation && confirmed, false).energyCheckDue
      : false);
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
            const saved = applyGoals(
              s,
              {
                ...parsed.data,
                confirmLowWeight: asksConfirmation && confirmed,
              },
              today(),
            );
            followUpGoals(s, saved, today());
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
          <select required {...field("sex")}>
            <option value="" disabled>
              Choose
            </option>
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
          <select required {...field("activity")}>
            <option value="" disabled>
              Choose
            </option>
            <option value="low">Mostly sitting</option>
            <option value="moderate">On my feet some</option>
            <option value="high">Physical work</option>
            <option value="very_high">Heavy manual work</option>
          </select>
        </label>
        <label>
          Days I can train
          <input inputMode="numeric" required {...field("trainingDays")} />
        </label>
        <label>
          Session length (min)
          <input inputMode="numeric" required {...field("sessionMinutes")} />
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
        {asksPregnancy && draft.pregnancy === "breastfeeding" && (
          <label>
            Baby&rsquo;s age (weeks, optional)
            <input inputMode="numeric" {...field("weeksSinceBirth")} />
          </label>
        )}
        <label>
          Kidney disease, or told to limit protein
          <select {...field("limitProtein")}>
            <option value="">Prefer not to say</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
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
      {classOffered && (
        <label className="goals-check">
          <input
            type="checkbox"
            checked={weightClass}
            onChange={(e) => setWeightClass(e.target.checked)}
          />
          My goal weight is a competition weight class, and the date is the
          weigh-in
        </label>
      )}
      {asksEnergy && (
        <fieldset className="goals-questions">
          <legend>Before a deficit: a few health questions</legend>
          <ul>
            {energyQuestionsFor(
              draft.sex === "male" ? "male" : "unspecified",
              draft.pregnancy === "pregnant" ||
                draft.pregnancy === "breastfeeding"
                ? draft.pregnancy
                : null,
            ).map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
          <label>
            Yes to any of these
            <select {...field("energySigns")}>
              <option value="">Prefer not to say</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          <p className="fine-print">
            Optional, and not a diagnosis. Only a yes or no and the date are
            kept, so the plan stays safe: with a yes it holds your weight, and a
            sports doctor or sports dietitian can help you look into it. A no is
            asked again after 3 months while you&rsquo;re losing weight.
          </p>
        </fieldset>
      )}
      <p className="fine-print">
        {asksPregnancy
          ? `Optional. Kept with your goals only so the plan stays safe: no targets in pregnancy, no deficit while breastfeeding until your baby is ${POSTPARTUM_WEEKS} weeks old, and no protein target with kidney disease or a doctor's limit on protein. Choose No, Neither or Prefer not to say to remove them.`
          : "Optional. Kept with your goals only so the plan sets no protein target with kidney disease or a doctor's limit on protein; choose No or Prefer not to say to remove it."}
      </p>
      {plan && split ? (
        <div className="goals-plan" role="status">
          <strong>{describePlan(split.goals, plan)}</strong>
          {plan.notes.map((note) => (
            <p key={note} className="fine-print">
              {note}
            </p>
          ))}
          {checkFrom && (
            <p className="fine-print">{goalsCheckNote(checkFrom)}</p>
          )}
          {closes && (
            <p className="fine-print">
              {goalsCheckClosedNote(closes.followUpDate)}
            </p>
          )}
          {ownCalories != null && (
            <p className="fine-print">
              Saving replaces your own daily targets (
              {ownCalories.toLocaleString("en-GB")} kcal) with these.
            </p>
          )}
        </div>
      ) : (
        <p className="fine-print">{waiting}</p>
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
