import type { z } from "zod";
import { appendWorkoutSets, mergeWorkoutSessions } from "../workout-continuity";
import { isValidLoggedSet } from "../../js/progression.js";
import {
  createWorkout,
  days,
  exerciseName,
  finishWorkout,
  uid,
} from "../domain";
import { sessionMinutes } from "../session-length";
import type { JournalState, Workout } from "../model";
import { plannedEntry, startTemplate, templateFromWorkout } from "../training";
import type { trainingInputSchema } from "./action-schema";
import type { ActionOf, PreparedChange } from "./actions";

export function requireNoDraft(next: JournalState) {
  if (next.activeWorkout)
    throw Error(
      "An unfinished workout already exists. Resume or finish it first.",
    );
}
function ownedSession(next: JournalState, id: string) {
  const w = next.sessions.find((s) => s.id === id);
  if (!w) throw Error("That session is not in your journal.");
  return w;
}
function buildWorkout(
  input: z.infer<typeof trainingInputSchema>,
  logged: boolean,
): Workout {
  return {
    id: uid(),
    title: input.title,
    date: input.date,
    programId: "personal",
    programDayId: input.category === "accessories" ? "gym_accessories" : "open",
    // Only a length the athlete stated; a session told afterwards has no clock.
    ...(logged ? { durationMinutes: input.durationMinutes ?? null } : {}),
    recovery: "auto",
    athleteNotes: input.notes ?? "",
    coachNotes: "",
    exercises: input.exercises.map((e) => ({
      id: uid(),
      exerciseId: e.exerciseId,
      loggingVersion: 1,
      completed: logged,
      athleteNotes: "",
      coachCue: "",
      prescribed: {},
      sets: e.sets.map((s) => ({
        id: uid(),
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe ?? "",
        result: logged ? s.result : "",
        logged,
        touched: logged,
      })),
    })),
  };
}
// Draft edits require a draft dated no later than the athlete's today.
function currentDraft(next: JournalState, currentDate: string) {
  const draft = next.activeWorkout;
  if (draft && draft.date > currentDate)
    throw Error("Check this workout’s future training date first.");
  return draft;
}

export function prepareMergeSessions(
  next: JournalState,
  action: ActionOf<"merge_sessions">,
): PreparedChange {
  const merged = mergeWorkoutSessions(
    next,
    action.sessionIds,
    action.name,
    action.completion,
  );
  Object.assign(next, merged.state);
  return {
    workout: merged.workout,
    workoutReview: { status: action.completion, sources: merged.sources },
    title: "Combine split workout entries",
    detail: `Replaces ${merged.sources.length} history entries with one ${action.completion === "ongoing" ? "ongoing workout in Train" : "completed workout in Train → History"}. Every set and note is kept, including repeated sets. Review the entries and result below. You can undo this change.`,
  };
}

export function prepareWorkoutProgress(
  next: JournalState,
  action: ActionOf<"log_workout_progress">,
  currentDate: string,
): PreparedChange {
  if (action.workout.date > currentDate)
    throw Error("Performed training cannot be dated in the future.");
  const existing = action.sessionId
    ? ownedSession(next, action.sessionId)
    : null;
  if (existing && existing.date !== action.workout.date)
    throw Error("Use the original workout date when adding sets.");
  if (existing && next.activeWorkout)
    throw Error(
      "An ongoing workout already exists. Resolve it in Train before changing a history session.",
    );
  if (
    !existing &&
    next.activeWorkout &&
    next.activeWorkout.date !== action.workout.date
  )
    throw Error(
      "The ongoing workout is on another date. Resolve it in Train before logging this workout.",
    );
  if (
    !existing &&
    !next.activeWorkout &&
    next.sessions.some((s) => s.date === action.workout.date) &&
    !action.separateSession
  )
    throw Error(
      "Training already exists on this date. Read the matching session and supply sessionId to add to it. Ask which workout if ambiguous; separateSession requires an explicitly separate workout.",
    );
  const draft = existing
    ? structuredClone(existing)
    : (next.activeWorkout ??
      buildWorkout({ ...action.workout, exercises: [] }, false));
  appendWorkoutSets(draft, action.workout.exercises);
  if (action.workout.notes && action.workout.notes !== draft.athleteNotes)
    draft.athleteNotes = [draft.athleteNotes, action.workout.notes]
      .filter(Boolean)
      .join("\n");
  if (existing) {
    next.sessions = next.sessions.filter((s) => s.id !== existing.id);
    // Sets added later keep the session's length.
    if (draft.durationMinutes === undefined)
      draft.durationMinutes = sessionMinutes(existing);
  }
  if (action.workout.durationMinutes != null)
    draft.durationMinutes = action.workout.durationMinutes;
  delete draft.finishedAt;
  next.activeWorkout = draft;
  let workout = draft;
  if (action.completion === "completed") {
    Object.assign(next, finishWorkout(next));
    workout = next.sessions.find(
      (s) => s.id === (draft.editingSessionId ?? draft.id),
    )!;
  }
  return {
    workout,
    workoutReview: { status: action.completion },
    title:
      action.completion === "ongoing"
        ? "Update your ongoing workout"
        : "Save this completed workout",
    detail:
      action.completion === "ongoing"
        ? "Adds only the newly reported sets to one ongoing workout. Earlier sets and planned exercises stay in place. Keep logging here or in Train; finish when your whole workout is done."
        : "Adds the newly reported sets to this workout and saves one completed history entry. Earlier sets are preserved; unlogged targets are left out.",
  };
}

export function prepareSession(
  next: JournalState,
  action: ActionOf<"record_session" | "plan_workout" | "update_session">,
  currentDate: string,
): PreparedChange {
  const planned = action.kind === "plan_workout";
  if (!planned && action.workout.date > currentDate)
    throw Error(
      "Completed sessions cannot be dated in the future. Prepare a workout draft instead.",
    );
  if (planned) requireNoDraft(next);
  if (action.kind === "record_session") {
    // An unfinished workout from another day does not block recording a
    // finished session; one on the same day is where these sets belong.
    if (next.activeWorkout?.date === action.workout.date)
      throw Error(
        "An ongoing workout exists on this date. Read current_workout and use log_workout_progress or finish_workout; do not split it into another history entry.",
      );
    if (
      next.sessions.some((s) => s.date === action.workout.date) &&
      !action.separateSession
    )
      throw Error(
        "Training already exists on this date. Read it and use log_workout_progress with sessionId to append, or update_session to correct it. Only an explicitly separate workout permits separateSession=true.",
      );
  }
  const built = buildWorkout(action.workout, !planned);
  if (action.kind === "update_session") {
    const existing = ownedSession(next, action.sessionId);
    if (next.activeWorkout?.editingSessionId === existing.id)
      throw Error("Finish editing this session in Train first.");
    const workout: Workout = {
      ...existing,
      title: built.title,
      date: built.date,
      programDayId:
        action.workout.category === "accessories"
          ? "gym_accessories"
          : existing.programDayId,
      athleteNotes: action.workout.notes ?? existing.athleteNotes,
      durationMinutes:
        action.workout.durationMinutes ?? existing.durationMinutes,
      exercises: built.exercises.map((entry) => {
        const original = existing.exercises.find(
          (e) => e.exerciseId === entry.exerciseId,
        );
        return original
          ? { ...original, sets: entry.sets, completed: true }
          : entry;
      }),
    };
    next.sessions = next.sessions.map((s) =>
      s.id === existing.id ? workout : s,
    );
    return {
      workout,
      title: "Replace session details",
      detail:
        "This replaces every exercise and set in the selected session. Review the complete session below.",
    };
  }
  if (planned) {
    next.activeWorkout = built;
    return {
      workout: built,
      title: "Start a workout draft",
      detail:
        "Every set starts unlogged. Your history stays as it is until you finish.",
    };
  }
  next.sessions.push(built);
  return {
    workout: built,
    title: "Log a completed session",
    detail: next.sessions.some(
      (s) => s.id !== built.id && s.date === built.date,
    )
      ? "You already have training on this date. This creates an additional session."
      : "Adds this session to your training history.",
  };
}

export function prepareSetCorrection(
  next: JournalState,
  action: ActionOf<"correct_workout_set">,
  currentDate: string,
): PreparedChange {
  const draft = next.activeWorkout;
  if (!draft || draft.id !== action.workoutId)
    throw Error(
      "That ongoing workout is not in your journal. Read current_workout again.",
    );
  currentDraft(next, currentDate);
  const entries = draft.exercises.filter((e) => e.id === action.entryId);
  const matches =
    entries.length === 1
      ? entries[0].sets.filter((s) => s.id === action.setId)
      : [];
  // Say which id is wrong: a miscopied id is the usual cause, and "read it
  // again" alone sends the model round in circles.
  if (entries.length !== 1)
    throw Error(
      "No exercise with that entryId in the workout in progress. Copy entryId exactly as current_workout returned it.",
    );
  if (matches.length !== 1)
    throw Error(
      "No set with that setId in this exercise. Copy setId exactly as current_workout returned it.",
    );
  if (!isValidLoggedSet(matches[0]))
    throw Error(
      "That set is planned, not logged, so it can't be corrected. Log it with log_sets instead.",
    );
  Object.assign(matches[0], action.setChanges);
  // The complete journal schema also validates the resulting reps/result
  // combination. IDs, sibling sets, prescriptions and completion stay intact.
  return {
    workout: draft,
    title: "Correct an ongoing set",
    detail:
      "Updates only the requested set fields. All other sets and targets are kept, and the workout stays ongoing.",
  };
}

export function prepareLogSets(
  next: JournalState,
  action: ActionOf<"log_sets">,
  currentDate: string,
): PreparedChange {
  const draft = next.activeWorkout;
  if (!draft)
    throw Error(
      "Read current_workout and use log_workout_progress to start one ongoing workout with the reported sets.",
    );
  currentDraft(next, currentDate);
  appendWorkoutSets(draft, [
    { exerciseId: action.exerciseId, sets: action.sets },
  ]);
  return {
    workout: draft,
    title: `Log ${action.sets.length} ${exerciseName(action.exerciseId)} sets`,
    detail:
      "Fills the next unlogged sets, then adds extra sets if needed. Previously logged sets are preserved. The workout stays ongoing until you finish it.",
  };
}

// An exercise added to the workout in progress with targets still to do,
// nothing logged. One already in the workout gets the new sets after its own.
// The note, such as tempo or a superset, goes with the target, as a
// programme's does, so Train and Coach show it.
export function prepareAddExercise(
  next: JournalState,
  action: ActionOf<"add_workout_exercise">,
): PreparedChange {
  if (!next.activeWorkout)
    throw Error(
      "There is no workout in progress to add to. Use plan_workout to start a workout draft with this exercise, or log_workout_progress for sets already done.",
    );
  const draft = inProgress(next, action.workoutId);
  const matches = draft.exercises.filter(
    (e) => e.exerciseId === action.exerciseId,
  );
  if (matches.length > 1)
    throw Error(
      "This movement appears more than once. Edit the intended exercise in Train before adding sets.",
    );
  const planned = plannedEntry({
    exerciseId: action.exerciseId,
    sets: action.plannedSets.map((s) => ({
      weight: s.weight ?? "",
      reps: s.reps,
    })),
  });
  const added = planned.sets;
  const entry = matches[0] ?? { ...planned, sets: [], prescribed: {} };
  if (!matches.length) draft.exercises.push(entry);
  entry.sets.push(...added);
  entry.completed = false;
  extendTarget(entry, added);
  const notes = entry.prescribed.notes ?? "";
  if (action.note && !notes.includes(action.note))
    entry.prescribed.notes = [notes.replace(/[.\s]+$/, ""), action.note]
      .filter(Boolean)
      .join(". ");
  const name = exerciseName(action.exerciseId);
  return {
    workout: draft,
    title: matches.length
      ? `Add ${added.length} ${name} set${added.length === 1 ? "" : "s"} to your workout`
      : `Add ${name} to your workout`,
    detail: [
      "Adds planned sets to the workout in progress. Nothing is logged until you do them, and sets you have logged stay as they are.",
      action.note && `Note: ${action.note}`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// The target Train and the iPhone show, such as 4 × 8–10 · 15 kg. Sets
// added to an exercise with a target raise its count, widen its reps and
// keep its load only while the new sets share it. An exercise without a
// target gets one from all its sets, with the load only when they share it.
function extendTarget(
  entry: Workout["exercises"][number],
  added: Workout["exercises"][number]["sets"],
) {
  const target = entry.prescribed;
  const had = target.targetSets != null;
  target.targetSets = had
    ? Number(target.targetSets) + added.length
    : entry.sets.length;
  const was = String(target.reps ?? target.targetReps ?? "");
  const range = /^(\d+)(?:\s*[–-]\s*(\d+))?$/.exec(was);
  // A target such as "AMRAP" stays as written.
  if (!had || !was || range) {
    const reps = (had && range ? added : entry.sets)
      .map((s) => Number(s.reps))
      .filter((n) => n > 0);
    if (had && range) reps.push(Number(range[1]), Number(range[2] ?? range[1]));
    const [low, high] = [Math.min(...reps), Math.max(...reps)];
    target.reps = low === high ? String(low) : `${low}–${high}`;
    delete target.targetReps;
  }
  const load = target.targetWeight;
  if (load == null || load === "") {
    const loads = new Set(entry.sets.map((s) => String(s.weight)));
    const [only] = loads;
    if (!had && loads.size === 1 && only !== "")
      target.targetWeight = Number(only);
  } else if (
    added.some((s) => s.weight === "" || Number(s.weight) !== Number(load))
  )
    delete target.targetWeight;
}

// A workoutId from current_workout must name the workout in progress.
function inProgress(next: JournalState, workoutId?: string) {
  const draft = next.activeWorkout;
  if (!draft) throw Error("There is no unfinished workout.");
  if (workoutId && workoutId !== draft.id)
    throw Error(
      "That isn't the workout in progress. Read current_workout and use its workoutId, or leave workoutId out.",
    );
  return draft;
}

export function prepareFinishWorkout(
  next: JournalState,
  currentDate: string,
  workoutId?: string,
): PreparedChange {
  inProgress(next, workoutId);
  currentDraft(next, currentDate);
  Object.assign(next, finishWorkout(next));
  return {
    workout: next.sessions.at(-1) ?? null,
    title: "Finish your workout",
    detail: "Saves logged sets to History. Unlogged planned sets are left out.",
  };
}

// Clears an abandoned draft. Only a draft without logged sets can go;
// anything performed must be finished into history instead.
export function prepareDiscardWorkout(
  next: JournalState,
  workoutId?: string,
): PreparedChange {
  const draft = inProgress(next, workoutId);
  if (draft.exercises.some((e) => e.sets.some(isValidLoggedSet)))
    throw Error(
      "This unfinished workout has logged sets. Use finish_workout to keep them in History instead.",
    );
  next.activeWorkout = null;
  return {
    workout: null,
    title: "Clear an unfinished workout",
    detail: `Removes “${draft.title}” from ${draft.date}. It had no logged sets, so nothing performed is lost.`,
  };
}

export function prepareStartProgramme(
  next: JournalState,
  action: ActionOf<"start_programme">,
): PreparedChange {
  requireNoDraft(next);
  const day = days.find((d) => d.id === action.dayId);
  if (!day) throw Error("Choose a programme day from the site catalogue.");
  const workout = createWorkout(next, day, action.date);
  next.activeWorkout = workout;
  return {
    workout,
    title: "Start your programme",
    detail:
      "Targets use the site’s progression rules and your recorded history. Sets start unlogged.",
  };
}

export function prepareRepeatSession(
  next: JournalState,
  action: ActionOf<"repeat_session">,
): PreparedChange {
  requireNoDraft(next);
  const workout = startTemplate(
    templateFromWorkout(ownedSession(next, action.sessionId)),
    action.date,
  );
  next.activeWorkout = workout;
  return {
    workout,
    title: "Repeat a session",
    detail:
      "Copies exercises, weights and reps into a fresh draft with every set unlogged.",
  };
}

export function prepareSaveRoutine(
  next: JournalState,
  action: ActionOf<"save_routine">,
): PreparedChange {
  const template = templateFromWorkout(
    ownedSession(next, action.sessionId),
    action.name,
  );
  next.templates = [...(next.templates ?? []), template];
  return {
    training: { kind: "routine", after: template },
    title: "Save a routine",
    detail: `“${template.name}” will be available in Train → Your routines.`,
  };
}
