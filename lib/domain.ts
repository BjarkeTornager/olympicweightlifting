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
  type Plan,
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
// A journal date as it reads in a sentence, like the masthead: "30
// September", with the year only when it is not this year. Day and month
// never part at a line break.
export const dateInProse = (date: string, now = today()) =>
  new Date(`${date}T12:00:00`)
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      ...(date.slice(0, 4) === now.slice(0, 4) ? {} : { year: "numeric" }),
    })
    .replaceAll(" ", "\u00a0");
export const uid = () => crypto.randomUUID();
export const exerciseName = (id: string) =>
  EXERCISES.find((e) => e.id === id)?.name ??
  (id.startsWith("custom:") ? id.slice(7) : id.replaceAll("_", " "));
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
// Age in whole years for the load rules, from the goals when set, else the
// profile; 0 means unknown.
export const athleteAge = (state: JournalState) =>
  state.profile.body?.age || state.profile.age || 0;
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
    age: athleteAge(state),
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
      age: athleteAge(state),
      techniqueChecked: draft.techniqueChecked === true,
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
function openWorkout(state: JournalState) {
  const draft = state.activeWorkout;
  if (!draft) throw Error("There is no unfinished workout.");
  return draft;
}
// Limited recovery repeats previous loads. Changing it plans the untouched
// exercises again; entered work is kept.
export function setWorkoutRecovery(
  state: JournalState,
  recovery: Workout["recovery"],
) {
  openWorkout(state).recovery = recovery;
  replanDraft(state);
}
// Under 18, a load increase waits until a coach has checked technique; the
// confirmation holds for this workout only.
export function setTechniqueChecked(state: JournalState, checked: boolean) {
  openWorkout(state).techniqueChecked = checked;
  replanDraft(state);
}
// A workout on a day of the built-in programme, whose loads follow the
// progression rules; other workouts repeat their planned weights.
export const followsProgramme = (workout: Workout) =>
  workout.programId === program.id &&
  days.some((d) => d.id === workout.programDayId);
// The reset a plan proposes, while no set of the exercise is logged.
export function proposedReset(entry: Entry) {
  const reset = Number(
    (entry.prescribed.progression as Plan | undefined)?.resetWeight,
  );
  return Number.isFinite(reset) &&
    reset > 0 &&
    !entry.sets.some((s) => s.logged || s.result)
    ? reset
    : undefined;
}
// Take a proposed reset before logging the exercise: its target and sets
// drop to the reset load, marked as the athlete's choice so replanning
// leaves them alone.
export function takeReset(entry: Entry) {
  const plan = entry.prescribed.progression as Plan | undefined;
  const reset = Number(plan?.resetWeight);
  if (!plan || !Number.isFinite(reset) || reset <= 0)
    throw Error("This exercise has no reset to take.");
  if (entry.sets.some((s) => s.logged || s.result))
    throw Error(
      "Sets of this exercise are already logged. Change the remaining weights directly.",
    );
  const { resetWeight: _taken, ...rest } = plan;
  void _taken;
  entry.prescribed = {
    ...entry.prescribed,
    targetWeight: reset,
    progression: {
      ...rest,
      weight: reset,
      status: "reset",
      reason: `Reset to ${reset} kg from ${plan.weight} kg after two sessions in a row with a miss or a hard set, a common coaching convention. Build back up from here.`,
    },
  };
  entry.sets.forEach((s) => {
    s.weight = String(reset);
    s.edited = { ...s.edited, weight: true };
  });
}
export function takeLoadReset(state: JournalState, entryId: string) {
  const entry = openWorkout(state).exercises.find((e) => e.id === entryId);
  if (!entry) throw Error("That exercise is not in the workout in progress.");
  takeReset(entry);
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
    age: athleteAge(state),
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
    !current.templates.length &&
    !current.program.customPrograms.length &&
    !current.sessions.length &&
    !current.cardio.sessions.length &&
    !current.nutrition.meals.length &&
    !current.health.checkins.length &&
    !current.profile.coaching?.memories?.length &&
    !current.profile.coaching?.plans?.length &&
    !current.nutrition.favourites?.length &&
    !current.nutrition.completeDays?.length &&
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
  const mergeRecords = <T extends { id: string }>(
    a: T[] | undefined,
    b: T[] | undefined,
    label: string,
  ): T[] | undefined => {
    if (!a && !b) return undefined;
    const records = new Map((a ?? []).map((r) => [r.id, r]));
    for (const record of b ?? []) {
      const old = records.get(record.id);
      if (old && canonicalJson(old) !== canonicalJson(record))
        throw Error(
          `A different ${label} already exists. Review both backups before importing.`,
        );
      records.set(record.id, record);
    }
    return [...records.values()];
  };
  const memories = mergeRecords(
    current.profile.coaching?.memories,
    incoming.profile.coaching?.memories,
    "Coach memory",
  );
  const plans = mergeRecords(
    current.profile.coaching?.plans,
    incoming.profile.coaching?.plans,
    "agreed plan",
  );
  const favourites = mergeRecords(
    current.nutrition.favourites,
    incoming.nutrition.favourites,
    "favourite meal",
  );
  const profile = fresh ? incoming.profile : current.profile;
  const customPrograms = [...current.program.customPrograms];
  for (const value of incoming.program.customPrograms) {
    const getId = (v: unknown) =>
      v && typeof v === "object" && "id" in v ? v.id : undefined;
    const old = customPrograms.find(
      (p) => getId(value) != null && getId(p) === getId(value),
    );
    if (old && canonicalJson(old) !== canonicalJson(value))
      throw Error(
        "A different version of a training program already exists. Review both backups before importing.",
      );
    if (!customPrograms.some((p) => canonicalJson(p) === canonicalJson(value)))
      customPrograms.push(value);
  }
  const coaching = profile.coaching ?? incoming.profile.coaching;
  const completeDays =
    current.nutrition.completeDays || incoming.nutrition.completeDays
      ? [
          ...new Set([
            ...(current.nutrition.completeDays ?? []),
            ...(incoming.nutrition.completeDays ?? []),
          ]),
        ].filter((date) => {
          const mergedIds = [...meals.values()]
            .filter((m) => m.date === date)
            .map((m) => m.id)
            .sort()
            .join(",");
          return [current, incoming].some(
            (source) =>
              source.nutrition.completeDays?.includes(date) &&
              source.nutrition.meals
                .filter((m) => m.date === date)
                .map((m) => m.id)
                .sort()
                .join(",") === mergedIds,
          );
        })
      : undefined;
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
    profile: {
      ...profile,
      ...(coaching
        ? {
            coaching: {
              ...coaching,
              ...(memories ? { memories } : {}),
              ...(plans ? { plans } : {}),
            },
          }
        : {}),
    },
    sessions: [...sessions.values()],
    program: {
      ...(fresh ? incoming.program : current.program),
      customPrograms,
    },
    templates: [...templates.values()],
    health: { checkins: [...checkins.values()] },
    cardio: { sessions: [...cardio.values()] },
    nutrition: {
      ...(favourites ? { favourites } : {}),
      ...(completeDays ? { completeDays } : {}),
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
