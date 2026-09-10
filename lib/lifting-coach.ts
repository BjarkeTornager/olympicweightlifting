import type { JournalState, Workout } from "./model";
import { EXERCISES, exerciseName } from "./domain";
import { foodDate } from "./nutrition";
import { offsetDate } from "./health";
import { isValidLoggedSet } from "../js/progression.js";

export {
  liftingBriefInputSchema,
  liftingBriefSchema,
  experienceLabels,
  type LiftingBriefInput,
  type LiftingBrief,
} from "./lifting-brief";
const olympicIds = new Set([
  "snatch",
  "power_snatch",
  "snatch_pull",
  "snatch_balance",
  "overhead_squat",
  "clean",
  "pause_clean",
  "power_clean",
  "clean_pull",
  "clean_and_jerk",
  "jerk",
  "back_squat",
  "front_squat",
]);

function measured(workouts: Workout[]) {
  const sets = workouts.flatMap((w) =>
    w.exercises.flatMap((e) => e.sets.filter(isValidLoggedSet)),
  );
  const explicit = sets.filter(
    (s) => s.result === "success" || s.result === "miss",
  );
  const rpes = sets.flatMap((s) =>
    s.rpe !== "" && s.rpe != null && Number(s.rpe) >= 1 && Number(s.rpe) <= 10
      ? [Number(s.rpe)]
      : [],
  );
  return {
    loggedSets: sets.length,
    madeSets: explicit.filter((s) => s.result === "success").length,
    missedSets: explicit.filter((s) => s.result === "miss").length,
    unratedSets: sets.length - explicit.length,
    rpeSets: rpes.length,
    averageReportedRpe: rpes.length
      ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10
      : null,
  };
}

// The page and the model use the same deterministic, owner-scoped evidence.
// No ratios, estimated maxes, readiness scores or technical diagnoses.
export function liftingReview(
  state: JournalState,
  endDate: string,
  exerciseId?: string,
) {
  foodDate.parse(endDate);
  const from = offsetDate(endDate, -27);
  const sessions = state.sessions
    .filter((s) => s.date >= from && s.date <= endDate)
    .map((s) => ({
      ...s,
      exercises: s.exercises.filter(
        (e) => !exerciseId || e.exerciseId === exerciseId,
      ),
    }))
    .filter((s) => s.exercises.some((e) => e.sets.some(isValidLoggedSet)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const ids = [
    ...new Set(
      sessions.flatMap((s) =>
        s.exercises
          .filter((e) => e.sets.some(isValidLoggedSet))
          .map((e) => e.exerciseId),
      ),
    ),
  ];
  const exercises = ids
    .map((id) => {
      const workouts = sessions
        .map((s) => ({
          ...s,
          exercises: s.exercises.filter((e) => e.exerciseId === id),
        }))
        .filter((s) => s.exercises.length);
      const successful = workouts
        .flatMap((w) =>
          w.exercises.flatMap((e) =>
            e.sets
              .filter((s) => isValidLoggedSet(s) && s.result !== "miss")
              .map((s) => ({
                sessionId: w.id,
                date: w.date,
                weight: Number(s.weight),
                reps: Number(s.reps),
              })),
          ),
        )
        .sort(
          (a, b) =>
            b.weight - a.weight ||
            b.reps - a.reps ||
            b.date.localeCompare(a.date),
        );
      const catalogue = EXERCISES.find((e) => e.id === id);
      return {
        exerciseId: id,
        name: exerciseName(id),
        olympic: olympicIds.has(id),
        ...measured(workouts),
        sessions: workouts.length,
        bestRecordedSet: successful[0] ?? null,
        loggingNotes:
          catalogue?.loggingNotes ??
          "Check the implement and load convention before comparing.",
      };
    })
    .sort(
      (a, b) =>
        Number(b.olympic) - Number(a.olympic) ||
        b.loggedSets - a.loggedSets ||
        a.name.localeCompare(b.name),
    );
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const to = offsetDate(endDate, -(3 - i) * 7),
      start = offsetDate(to, -6);
    const records = sessions.filter((s) => s.date >= start && s.date <= to);
    const checkins = state.health.checkins.filter(
      (c) => c.date >= start && c.date <= to,
    );
    const sleep = checkins.flatMap((c) =>
      c.sleepHours == null ? [] : [c.sleepHours],
    );
    return {
      from: start,
      to,
      sessions: records.length,
      ...measured(records),
      sleepNights: sleep.length,
      averageSleepHours: sleep.length
        ? Math.round((sleep.reduce((a, b) => a + b, 0) / sleep.length) * 10) /
          10
        : null,
    };
  });
  const latest = sessions[0];
  return {
    from,
    to: endDate,
    brief: state.profile.lifting ?? null,
    recordedSessions: sessions.length,
    ...measured(sessions),
    weeks,
    exercises: exercises.slice(0, 30),
    totalExercises: exercises.length,
    recentSessions: sessions.slice(0, 5).map((s) => ({
      id: s.id,
      title: s.title.slice(0, 180),
      date: s.date,
      ...measured([s]),
      reportedNotes: s.athleteNotes.slice(0, 1000),
      exerciseNotes: s.exercises
        .filter((e) => e.athleteNotes)
        .slice(0, 8)
        .map((e) => ({
          exerciseId: e.exerciseId,
          name: exerciseName(e.exerciseId),
          reportedNotes: e.athleteNotes.slice(0, 500),
        })),
    })),
    latestSessionId: latest?.id ?? null,
    activeWorkout:
      state.activeWorkout && state.activeWorkout.date <= endDate
        ? {
            id: state.activeWorkout.id,
            title: state.activeWorkout.title.slice(0, 180),
            date: state.activeWorkout.date,
            ...measured([state.activeWorkout]),
          }
        : null,
    evidenceLimits: [
      "Only valid logged sets in completed history enter the four-week comparison. The ongoing workout is shown separately; pending targets and future-dated sessions are excluded.",
      "Made/missed are explicit set outcomes, not an assessed technique score. Unrated means no made/miss outcome was supplied. A multi-rep set is one outcome, not several attempts.",
      "Best recorded sets are observations with their actual reps, date and source session, not tested or estimated 1RMs. Compare the same exercise, implement, reps and load convention.",
      "Sleep and RPE use reported samples only. Missing records are unmeasured, not inactivity or zero. Volume, missed sets and recovery observations do not diagnose a technical fault, injury or overtraining.",
      "A photo can support a visible position observation, not a full movement, bar-speed or timing assessment. The app cannot upload or analyse a lifting video as continuous motion.",
      "These summaries do not replace full current_workout, read_session or training_library reads before editing records or programs.",
    ],
  };
}

export function liftingPrompt(intent: string) {
  const prompts: Record<string, string> = {
    plan: "Build me an Olympic weightlifting program around my saved goal, time and equipment. Review my training first, then prepare an editable plan with a clear priority and a way to check progress.",
    review:
      "Review my last four weeks of lifting. What does the recorded evidence show, what is still unknown, and what is one useful adjustment to discuss?",
    session:
      "Help me prepare for my next lifting session. Use my brief and program to suggest one focus, a practical warm-up and a clear check for how it is going.",
    debrief:
      "Help me debrief my latest lifting session against my current priority. Ask how it felt and whether the cue helped before suggesting what to keep or change.",
    technique:
      "Help me work on a lifting technique issue. Ask what lift and load, what happened and what I have tried. I can describe it or attach a photo of a position.",
  };
  return prompts[intent] ?? prompts.review;
}
