import { uid } from "./domain";
import { journalSchema, type JournalState, type Workout } from "./model";

export type WorkoutStatus = "ongoing" | "completed";
export type ReportedExercise = {
  exerciseId: string;
  sets: {
    weight: number;
    reps: number;
    result: "success" | "miss";
    rpe?: number;
  }[];
};

// These are newly reported sets, not a replacement or cumulative recap.
// Identical loads/reps may be intentional; never deduplicate by their values.
export function appendWorkoutSets(
  workout: Workout,
  exercises: ReportedExercise[],
) {
  for (const reported of exercises) {
    const matches = workout.exercises.filter(
      (e) => e.exerciseId === reported.exerciseId,
    );
    if (matches.length > 1)
      throw Error(
        "This movement appears more than once. Edit the intended exercise in Train before adding sets.",
      );
    let entry = matches[0];
    if (!entry) {
      entry = {
        id: uid(),
        exerciseId: reported.exerciseId,
        loggingVersion: 1,
        completed: false,
        athleteNotes: "",
        coachCue: "",
        prescribed: {},
        sets: [],
      };
      workout.exercises.push(entry);
    }
    for (const set of reported.sets) {
      const pending = entry.sets.findIndex((s) => !s.logged && !s.result);
      const value = {
        ...(pending >= 0 ? entry.sets[pending] : {}),
        id: pending >= 0 ? entry.sets[pending].id : uid(),
        ...set,
        rpe: set.rpe ?? "",
        logged: true,
        touched: true,
      };
      if (pending >= 0) entry.sets[pending] = value;
      else entry.sets.push(value);
    }
    entry.completed = entry.sets.every((s) => Boolean(s.logged || s.result));
  }
}

export function mergeWorkoutSessions(
  state: JournalState,
  sessionIds: string[],
  title: string,
  status: WorkoutStatus,
) {
  if (
    sessionIds.length < 2 ||
    sessionIds.length > 10 ||
    new Set(sessionIds).size !== sessionIds.length
  )
    throw Error("Choose between two and ten different sessions to combine.");
  const sources = sessionIds.map((id) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!session)
      throw Error(
        "A selected session is no longer in your journal. Refresh and review again.",
      );
    return session;
  });
  if (new Set(sources.map((s) => s.date)).size !== 1)
    throw Error("Only combine entries from the same training date.");
  if (
    state.activeWorkout &&
    (status === "ongoing" ||
      sessionIds.includes(state.activeWorkout.editingSessionId ?? ""))
  )
    throw Error(
      "Finish or discard the current draft before combining these sessions.",
    );
  const merged = structuredClone(sources[0]);
  merged.title = title.trim();
  merged.editingSessionId = null;
  // Keep exercise blocks intact: their cues, prescriptions, ordering and notes
  // can differ even when they refer to the same movement.
  merged.exercises = sources.flatMap((s) => structuredClone(s.exercises));
  const entryIds = new Set<string>();
  for (const entry of merged.exercises) {
    if (entryIds.has(entry.id)) entry.id = uid();
    entryIds.add(entry.id);
  }
  for (const field of ["athleteNotes", "coachNotes"] as const) {
    merged[field] = sources
      .filter((s) => s[field])
      .map((s) => `${s.title}:\n${s[field]}`)
      .join("\n\n");
  }
  merged.mergedSessionIds = [
    ...new Set(
      sources.flatMap((s) => [
        s.id,
        ...(Array.isArray(s.mergedSessionIds)
          ? s.mergedSessionIds.filter(
              (id): id is string => typeof id === "string",
            )
          : []),
      ]),
    ),
  ];
  const finished = sources
    .flatMap((s) => (s.finishedAt ? [s.finishedAt] : []))
    .sort();
  if (status === "ongoing") delete merged.finishedAt;
  else if (finished.length) merged.finishedAt = finished.at(-1);
  const next = structuredClone(state);
  next.sessions = next.sessions.filter((s) => !sessionIds.includes(s.id));
  if (status === "ongoing") next.activeWorkout = merged;
  else next.sessions.push(merged);
  return {
    state: journalSchema.parse(next),
    workout: merged,
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      date: s.date,
      sets: s.exercises.reduce((n, e) => n + e.sets.length, 0),
    })),
  };
}
