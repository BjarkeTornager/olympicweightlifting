import { canonicalJson } from "./json";
import { APP_META, EXERCISES, PROGRAM_DEFINITION } from "../js/public-data.js";
import {
  planExercise,
  PROGRESSION_VERSION,
  PROGRAM_PROGRESSION_REVISION,
  isValidLoggedSet,
  upgradeProgramDraft,
} from "../js/progression.js";
import {
  journalSchema,
  type JournalState,
  type Workout,
  type ProgramDay,
  type Entry,
  type ProgramExercise,
} from "./model";
export { EXERCISES, APP_META };
export const PR_DEFINITIONS = [
  { exerciseId: "snatch", label: "Snatch" },
  { exerciseId: "clean_and_jerk", label: "Clean & jerk" },
  { exerciseId: "back_squat", label: "Back squat" },
  { exerciseId: "front_squat", label: "Front squat" },
  { exerciseId: "power_snatch", label: "Power snatch" },
  { exerciseId: "power_clean", label: "Power clean" },
  { exerciseId: "snatch_balance", label: "Snatch balance" },
  { exerciseId: "push_press", label: "Push press" },
  { exerciseId: "clean", label: "Clean" },
  { exerciseId: "clean_pull", label: "Clean pull / deadlift" },
] as const;
export const program = PROGRAM_DEFINITION;
export const days = PROGRAM_DEFINITION.days as ProgramDay[];
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const uid = () => crypto.randomUUID();
export const exerciseName = (id: string) =>
  EXERCISES.find((e) => e.id === id)?.name ?? id.replaceAll("_", " ");
export function emptyJournal(): JournalState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    profile: { bodyweight: 0, age: 0, unit: "kg" },
    prs: Object.fromEntries(PR_DEFINITIONS.map((p) => [p.exerciseId, 0])),
    sessions: [],
    activeWorkout: null,
    templates: [],
    health: { checkins: [] },
    cardio: { sessions: [] },
    nutrition: {
      meals: [],
      targets: {
        goal: "maintain",
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
      },
    },
    program: {
      activeProgramId: program.id,
      programRevision: program.revision,
      customPrograms: [],
    },
    preferences: {},
  };
}
export function createEntry(
  ex: ProgramExercise,
  state: JournalState,
  dayId: string,
  date: string,
): Entry {
  const plan = planExercise(ex, {
    sessions: state.sessions,
    programId: program.id,
    dayId,
    date,
  });
  return {
    id: uid(),
    exerciseId: ex.exerciseId,
    loggingVersion: PROGRESSION_VERSION,
    completed: false,
    strongSets: false,
    athleteNotes: "",
    coachCue: "",
    prescribed: {
      ...ex,
      targetSets: plan.sets,
      targetReps: plan.reps,
      targetWeight: plan.weight,
      progression: plan,
    },
    sets: Array.from({ length: plan.sets }, () => ({
      id: uid(),
      weight: String(plan.weight ?? ""),
      reps: String(plan.reps),
      rpe: "",
      result: "",
      touched: false,
    })),
  };
}
export function createWorkout(
  state: JournalState,
  day: ProgramDay | undefined,
  date = today(),
): Workout {
  return {
    id: uid(),
    title: day?.title ?? "Open training",
    date,
    programId: program.id,
    programDayId: day?.id ?? "open",
    programRevision: program.revision,
    progressionRevision: PROGRAM_PROGRESSION_REVISION,
    startedAt: new Date().toISOString(),
    recovery: "auto",
    athleteNotes: "",
    coachNotes: "",
    exercises:
      day?.exercises.map((ex) => createEntry(ex, state, day.id, date)) ?? [],
  };
}
export function finishWorkout(state: JournalState): JournalState {
  const draft = state.activeWorkout;
  if (!draft) throw Error("No workout in progress");
  const exercises = draft.exercises
    .map((e) => ({
      ...e,
      sets: e.sets.filter(
        (s) =>
          isValidLoggedSet(s) ||
          (e.loggingVersion !== PROGRESSION_VERSION &&
            (e.completed || s.touched)),
      ),
    }))
    .filter((e) => e.sets.length);
  if (!exercises.length) throw Error("Log at least one set before finishing.");
  const session = {
    ...draft,
    id: draft.editingSessionId ?? draft.id,
    editingSessionId: null,
    exercises,
    finishedAt: new Date().toISOString(),
  };
  return {
    ...state,
    activeWorkout: null,
    sessions: [...state.sessions.filter((s) => s.id !== session.id), session],
  };
}
export function replanDraft(state: JournalState): void {
  const draft = state.activeWorkout;
  if (!draft) return;
  const day = days.find((d) => d.id === draft.programDayId);
  if (!day) return;
  draft.exercises.forEach((entry) => {
    const source = day.exercises.find((e) => e.exerciseId === entry.exerciseId);
    if (
      !source ||
      entry.sets.some(
        (s) =>
          s.touched ||
          s.logged ||
          s.result ||
          Object.values(s.edited ?? {}).some(Boolean),
      )
    )
      return;
    const plan = planExercise(source, {
      sessions: state.sessions,
      programId: draft.programId,
      dayId: day.id,
      date: draft.date,
      recovery: draft.recovery,
    });
    entry.prescribed = {
      ...entry.prescribed,
      targetSets: plan.sets,
      targetReps: plan.reps,
      targetWeight: plan.weight,
      progression: plan,
    };
    entry.sets.forEach((s) => {
      s.weight = String(plan.weight ?? "");
      s.reps = String(plan.reps);
    });
  });
}
export function parseLegacyBackup(raw: unknown): JournalState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Choose a Lift Journal JSON backup.");
  const root = raw as Record<string, unknown>;
  const source = (root.data ?? root) as Record<string, unknown>;
  const version = Number(root.schemaVersion ?? source.schemaVersion ?? 1);
  if (!Number.isInteger(version) || version < 1 || version > 2)
    throw Error("This backup version is not supported.");
  if (!Array.isArray(source.sessions))
    throw Error("The backup has no sessions list.");
  const defaults = emptyJournal();
  const state = journalSchema.parse({
    ...defaults,
    ...source,
    schemaVersion: 2,
    profile: {
      ...defaults.profile,
      ...(version === 1
        ? { bodyweight: source.bodyweight ?? 0, age: source.age ?? 0 }
        : {}),
      ...((source.profile as object) ?? {}),
    },
    program: { ...defaults.program, ...((source.program as object) ?? {}) },
    activeWorkout: source.activeWorkout ?? source.activeSession ?? null,
  });
  state.activeWorkout = upgradeProgramDraft(state.activeWorkout, {
    day: days.find((d) => d.id === state.activeWorkout?.programDayId),
    sessions: state.sessions,
  });
  return state;
}
export function mergeImport(
  current: JournalState,
  incoming: JournalState,
): JournalState {
  const sessions = new Map(current.sessions.map((s) => [s.id, s]));
  for (const s of incoming.sessions) {
    const old = sessions.get(s.id);
    if (old && canonicalJson(old) !== canonicalJson(s))
      throw Error(
        `A different version of “${s.title}” on ${s.date} already exists. Export both backups before resolving it.`,
      );
    sessions.set(s.id, s);
  }
  if (
    current.activeWorkout &&
    incoming.activeWorkout &&
    canonicalJson(current.activeWorkout) !==
      canonicalJson(incoming.activeWorkout)
  )
    throw Error(
      "Both accounts have an unfinished workout. Finish or export the current one before importing.",
    );
  const fresh =
    !current.sessions.length &&
    !current.cardio.sessions.length &&
    !current.nutrition.meals.length &&
    !current.health.checkins.length &&
    current.nutrition.targets.goal === "maintain" &&
    ["calories", "protein", "carbs", "fat"].every(
      (key) =>
        current.nutrition.targets[
          key as "calories" | "protein" | "carbs" | "fat"
        ] == null,
    ) &&
    !current.activeWorkout &&
    Object.values(current.prs).every((v) => v === 0);
  const templates = new Map((current.templates ?? []).map((t) => [t.id, t]));
  const cardio = new Map(current.cardio.sessions.map((s) => [s.id, s]));
  for (const activity of incoming.cardio.sessions) {
    const old = cardio.get(activity.id);
    if (old && canonicalJson(old) !== canonicalJson(activity))
      throw Error(
        `A different version of cardio activity on ${activity.date} already exists. Review both backups before importing.`,
      );
    cardio.set(activity.id, activity);
  }
  const meals = new Map(current.nutrition.meals.map((m) => [m.id, m]));
  const checkins = new Map(current.health.checkins.map((c) => [c.date, c]));
  for (const checkin of incoming.health.checkins) {
    const old = checkins.get(checkin.date);
    if (old && canonicalJson(old) !== canonicalJson(checkin))
      throw Error(
        `A different check-in for ${checkin.date} already exists. Review both backups before importing.`,
      );
    checkins.set(checkin.date, checkin);
  }
  for (const meal of incoming.nutrition.meals) {
    const old = meals.get(meal.id);
    if (old && canonicalJson(old) !== canonicalJson(meal))
      throw Error(`A different version of meal “${meal.name}” already exists.`);
    meals.set(meal.id, meal);
  }
  for (const template of incoming.templates ?? []) {
    const old = templates.get(template.id);
    if (old && canonicalJson(old) !== canonicalJson(template))
      throw Error(
        `A different version of template “${template.name}” already exists.`,
      );
    templates.set(template.id, template);
  }
  return journalSchema.parse({
    ...current,
    ...(fresh
      ? {
          profile: incoming.profile,
          prs: incoming.prs,
          program: incoming.program,
          preferences: incoming.preferences,
        }
      : {}),
    sessions: [...sessions.values()],
    templates: [...templates.values()],
    health: { checkins: [...checkins.values()] },
    cardio: { sessions: [...cardio.values()] },
    nutrition: {
      meals: [...meals.values()],
      targets: fresh ? incoming.nutrition.targets : current.nutrition.targets,
    },
    activeWorkout: current.activeWorkout ?? incoming.activeWorkout,
  });
}
export function backup(state: JournalState) {
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    app: {
      name: APP_META.name,
      programId: program.id,
      programRevision: program.revision,
    },
    data: state,
  };
}
