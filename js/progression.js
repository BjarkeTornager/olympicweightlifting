// Pure progression rules: no storage or DOM access. Every draft snapshots its
// targets so subsequent changes to the program cannot rewrite training history.
export const PROGRESSION_VERSION = 1;
export const PROGRESSION_STEP = 2.5;
export const PROGRAM_PROGRESSION_REVISION = 2;

export function isLoggedSet(set) {
  return set?.logged === true || set?.result === "success" || set?.result === "miss";
}

export function isValidLoggedSet(set) {
  if (set?.weight == null || String(set.weight).trim() === "" || set?.reps == null || String(set.reps).trim() === "") return false;
  const weight = Number(set.weight);
  const reps = Number(set?.reps);
  return isLoggedSet(set) && Number.isFinite(weight) && weight >= 0 &&
    Number.isInteger(reps) && reps >= (set.result === "miss" ? 0 : 1);
}

export function targetSetCount(exercise) {
  return typeof exercise.sets === "number" ? exercise.sets : exercise.sets.default ?? exercise.sets.min;
}

function baseline(entry, fallback) {
  // Use the lightest recorded working set, never a single top set or a miss.
  // Old completed/touched rows can supply a reference, but cannot by themselves
  // qualify as explicitly logged work below.
  const weights = (entry?.sets ?? []).filter(set => isValidLoggedSet(set) ||
    (entry?.loggingVersion !== PROGRESSION_VERSION && (entry?.completed || set.touched) &&
      isValidLoggedSet({ ...set, logged: true })))
    .filter(set => set.result !== "miss").map(set => Number(set.weight));
  const target = Number(entry?.prescribed?.targetWeight);
  return weights.length ? Math.min(...weights) :
    Number.isFinite(target) && target > 0 ? target : fallback;
}

export function planExercise(exercise, { sessions, programId, dayId, date, recovery = "auto", excludeSessionId } = {}) {
  const initial = exercise.initialWeight;
  const plan = {
    version: PROGRESSION_VERSION,
    policyRevision: PROGRAM_PROGRESSION_REVISION,
    weight: initial,
    reps: exercise.defaultReps,
    sets: targetSetCount(exercise),
    step: exercise.progression?.step ?? PROGRESSION_STEP,
    maxWeight: exercise.progression?.maxWeight ?? null,
    sourceSessionId: null,
    sourceDate: null,
    previousWeight: null,
    status: "initial",
    reason: "Starting from the program’s prescribed load.",
  };
  if (!exercise.progression || typeof initial !== "number") {
    return { ...plan, status: "manual", reason: "Choose the load with your coach or for the accessory you use." };
  }
  // The calendar date, not edit/save time, determines the previous workout.
  // Same-day repeats do not repeatedly add another increment.
  const history = (sessions ?? []).filter(session =>
    session.id !== excludeSessionId && session.programId === programId &&
    session.programDayId === dayId && session.date < date
  ).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.finishedAt ?? "").localeCompare(String(a.finishedAt ?? "")));
  const previous = history[0];
  if (!previous) return plan;
  const entry = previous.exercises?.find(item => item.exerciseId === exercise.exerciseId);
  const lastEntry = entry ?? history.flatMap(session => session.exercises ?? []).find(item => item.exerciseId === exercise.exerciseId);
  const base = baseline(lastEntry, initial);
  const weight = plan.maxWeight === null ? base : Math.min(base, plan.maxWeight);
  Object.assign(plan, { weight, previousWeight: base, sourceSessionId: previous.id, sourceDate: previous.date, status: "hold" });
  const hold = reason => ({ ...plan, reason });
  if (!entry) return hold("This exercise was not logged in the last workout for this day. Repeat the last load.");
  const sets = entry.sets ?? [];
  const targetSets = Math.max(plan.sets, Number(entry.prescribed?.targetSets) || plan.sets);
  const targetReps = Math.max(plan.reps, Number(entry.prescribed?.targetReps) || plan.reps);
  const savedTarget = entry.prescribed?.targetWeight;
  const targetWeight = savedTarget == null ? base : Number(savedTarget);
  if (!Number.isFinite(targetWeight) || targetWeight <= 0) return hold("Previous load targets are missing. Repeat the load to establish a baseline.");
  if (sets.length < targetSets || !sets.every(isValidLoggedSet)) {
    return hold("Not all prescribed sets were completed and logged. Repeat this load.");
  }
  if (sets.some(set => set.result === "miss")) return hold("The previous workout included a miss. Repeat this load.");
  if (sets.some(set => Number(set.reps) < targetReps || Number(set.weight) < targetWeight)) {
    return hold("The previous workout did not meet every prescribed weight and rep target.");
  }
  if (previous.recovery === "limited") return hold("Recovery was limited in the previous session. Repeat the load before increasing.");
  const rpes = sets.map(set => Number(set.rpe));
  if (sets.some((set, index) => set.rpe !== "" && set.rpe != null &&
    (!Number.isFinite(rpes[index]) || rpes[index] < 1 || rpes[index] > 10))) {
    return hold("A previous RPE is invalid. Review the session before increasing.");
  }
  if (rpes.some(rpe => Number.isFinite(rpe) && rpe > 8)) {
    return hold("A previous set was above RPE 8. Repeat the load before increasing.");
  }
  const increased = Math.round((base + plan.step) * 100) / 100;
  if (plan.maxWeight !== null && increased > plan.maxWeight) {
    return { ...plan, status: "limit", reason: "The next full increase exceeds the program’s load range. Hold here and review the program." };
  }
  if (recovery === "limited") return hold("Recovery is limited today. Repeat the previous load.");
  return { ...plan, weight: increased, status: "increase", reason: "All prescribed sets and reps were completed successfully. The program automatically adds " + plan.step + " kg." };
}

// The program shows the next exposure immediately after a completed session.
// Training again today still uses today's prescription, so a repeat cannot
// compound increases. Future-dated logs never feed this preview.
export function planProgramDay(day, { sessions = [], programId, date }) {
  const history = sessions.filter(session => session.date <= date);
  const trainedToday = history.some(session => session.programId === programId && session.programDayId === day.id && session.date === date);
  const nextDate = new Date(date + "T12:00:00Z");
  if (trainedToday) nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const availableFrom = nextDate.toISOString().slice(0, 10);
  return { availableFrom, trainedToday, exercises: day.exercises.map(exercise => ({
    exerciseId: exercise.exerciseId,
    ...planExercise(exercise, { sessions: history, programId, dayId: day.id, date: availableFrom }),
  })) };
}

// Upgrade only untouched presets. Never reinterpret an athlete's recorded or
// manually edited sets, or rewrite a saved historical session.
export function upgradeProgramDraft(draft, { day, sessions }) {
  if (!draft || !day || draft.editingSessionId || draft.progressionRevision === PROGRAM_PROGRESSION_REVISION) return draft;
  const upgraded = JSON.parse(JSON.stringify(draft));
  upgraded.progressionRevision = PROGRAM_PROGRESSION_REVISION;
  upgraded.recovery = draft.recovery === "limited" ? "limited" : "auto";
  for (const entry of upgraded.exercises ?? []) {
    const exercise = day.exercises.find(item => item.exerciseId === entry.exerciseId);
    if (!exercise || entry.completed || !entry.sets?.length || entry.sets.some(set => set.touched || isLoggedSet(set) || Object.values(set.edited ?? {}).some(Boolean))) continue;
    const expectedWeight = entry.prescribed?.targetWeight ?? exercise.initialWeight;
    const expectedReps = entry.prescribed?.targetReps ?? exercise.defaultReps;
    if (entry.sets.length !== targetSetCount(exercise) ||
      entry.sets.some(set => String(set.weight ?? "") !== String(expectedWeight) || String(set.reps) !== String(expectedReps))) continue;
    const plan = planExercise(exercise, { sessions, programId: upgraded.programId, dayId: day.id, date: upgraded.date, recovery: upgraded.recovery });
    entry.loggingVersion = PROGRESSION_VERSION;
    entry.prescribed = { ...entry.prescribed, targetSets: plan.sets, targetReps: plan.reps, targetWeight: plan.weight, progression: plan };
    entry.sets.forEach(set => { set.weight = String(plan.weight ?? ""); set.reps = String(plan.reps); });
  }
  return upgraded;
}

// Adjust later unlogged sets, but preserve any value the athlete edited directly.
export function updatePendingSets(entry, setId, field, value) {
  const index = entry.sets.findIndex(set => set.id === setId);
  if (index < 0) return;
  const current = entry.sets[index];
  current[field] = value;
  current.edited = { ...current.edited, [field]: true };
  current.touched = true;
  if (field === "weight" || field === "reps") {
    current.logged = false;
    current.result = "";
    entry.completed = false;
    entry.strongSets = false;
    for (const later of entry.sets.slice(index + 1)) {
      if (!isLoggedSet(later) && !later.edited?.[field]) later[field] = value;
    }
  }
}
