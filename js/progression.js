// Pure progression rules: no storage or DOM access. Every draft snapshots its
// targets so subsequent changes to the program cannot rewrite training history.
export const PROGRESSION_VERSION = 1;
export const PROGRESSION_STEP = 2;
export const PROGRAM_PROGRESSION_REVISION = 4;

// Round generated loads down, never up. Historical and manually entered weights
// remain exact; only new prescriptions and quick adjustments use whole kilos.
export function wholeKilograms(weight) {
  return Math.max(0, Math.floor(Number(weight) || 0));
}

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

// Increases follow coaching convention, not settled science (see
// docs/targets-evidence-review-2026-10-04.md, 3.23). People misjudge effort
// by about a rep, so an increase needs the top set at RPE 8 or lower or, with
// no RPE, two sessions in a row made at the same load. Strength losses are
// small within 4 weeks off and grow after, more so from 65. Under 18, a coach
// checks technique before the load goes up.
export const RPE_LIMIT = 8;
const BREAK_HOLD_DAYS = 14;
const BREAK_DAYS = 28;
const LONG_BREAK_DAYS = 84;
const ADULT_AGE = 18;
const OLDER_AGE = 65;

const hasRpe = set => set?.rpe !== "" && set?.rpe != null;
const daysBetween = (from, to) =>
  Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000);
// A share of a load, rounded down to whole kilograms.
const percentOf = (weight, percent) => wholeKilograms(weight * percent / 100);

// How a logged exercise went against its frozen prescription: why it holds
// the load, or nothing when every prescribed set and rep was made at the
// target with no miss and no RPE above 8. A miss, missed reps or a hard set
// also marks it failed, the holds that can lead to a reset.
function review(entry, plan, base, chooseStartingWeight) {
  const sets = entry.sets ?? [];
  const targetSets = Math.max(plan.sets, Number(entry.prescribed?.targetSets) || plan.sets);
  const targetReps = Math.max(plan.reps, Number(entry.prescribed?.targetReps) || plan.reps);
  const savedTarget = entry.prescribed?.targetWeight;
  const targetWeight = savedTarget == null || String(savedTarget).trim() === "" || (chooseStartingWeight && Number(savedTarget) === 0) ? base : Number(savedTarget);
  const rpes = sets.map(set => Number(set.rpe));
  const failed = sets.some((set, index) => set.result === "miss" || rpes[index] > RPE_LIMIT ||
    (isValidLoggedSet(set) && Number(set.reps) < targetReps));
  const hold = reason => ({ hold: reason, failed });
  if (chooseStartingWeight && base === 0) return hold("Bodyweight work stays at 0 kg. Choose and log a comfortable added load before automatic increases begin.");
  if (!Number.isFinite(targetWeight) || targetWeight <= 0) return hold("Previous load targets are missing. Repeat the load to establish a baseline.");
  if (sets.length < targetSets || !sets.every(isValidLoggedSet)) {
    return hold("Not all prescribed sets were completed and logged. Repeat this load.");
  }
  if (sets.some(set => set.result === "miss")) return hold("The previous workout included a miss. Repeat this load.");
  if (sets.some(set => Number(set.reps) < targetReps || Number(set.weight) < targetWeight)) {
    return hold("The previous workout did not meet every prescribed weight and rep target.");
  }
  if (sets.some((set, index) => hasRpe(set) && (!Number.isFinite(rpes[index]) || rpes[index] < 1 || rpes[index] > 10))) {
    return hold("A previous RPE is invalid. Review the session before increasing.");
  }
  if (rpes.some(rpe => rpe > RPE_LIMIT)) {
    return hold(`A previous set was above RPE ${RPE_LIMIT}. Repeat the load before increasing.`);
  }
  // The effort of the top set: the hardest RPE recorded at the heaviest load.
  const top = Math.max(...sets.map(set => Number(set.weight)));
  const topRpes = sets.filter(set => Number(set.weight) === top && hasRpe(set)).map(set => Number(set.rpe));
  return { hold: null, failed: false, rpe: topRpes.length ? Math.max(...topRpes) : null };
}

export function planExercise(exercise, { sessions, programId, dayId, date, recovery = "auto", excludeSessionId, age = 0, techniqueChecked = false } = {}) {
  const automatic = Boolean(exercise.progression);
  const chooseStartingWeight = automatic && typeof exercise.initialWeight !== "number";
  const initial = automatic && !chooseStartingWeight ? wholeKilograms(exercise.initialWeight) : exercise.initialWeight;
  const configuredStep = exercise.progression?.step;
  const plan = {
    version: PROGRESSION_VERSION,
    policyRevision: PROGRAM_PROGRESSION_REVISION,
    weight: initial,
    reps: exercise.defaultReps,
    sets: targetSetCount(exercise),
    step: Number.isInteger(configuredStep) && configuredStep > 0 ? configuredStep : PROGRESSION_STEP,
    maxWeight: exercise.progression?.maxWeight == null ? null : wholeKilograms(exercise.progression.maxWeight),
    sourceSessionId: null,
    sourceDate: null,
    previousWeight: null,
    status: chooseStartingWeight ? "choose" : "initial",
    reason: chooseStartingWeight ? "Choose a comfortable starting weight. Completed, logged work establishes your baseline for automatic progression." : "Starting from the program’s prescribed load.",
  };
  if (!automatic) {
    return { ...plan, status: "manual", reason: "Choose the load with your coach or for the accessory you use." };
  }
  // The calendar date, not edit/save time, determines the previous workout.
  // Same-day repeats do not repeatedly add another increment.
  const earlierSessions = (sessions ?? []).filter(session => session.id !== excludeSessionId && session.date < date);
  const history = earlierSessions.filter(session =>
    session.programId === programId && session.programDayId === dayId
  ).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.finishedAt ?? "").localeCompare(String(a.finishedAt ?? "")));
  const previous = history[0];
  if (!previous) return plan;
  const entry = previous.exercises?.find(item => item.exerciseId === exercise.exerciseId);
  const lastEntry = entry ?? history.flatMap(session => session.exercises ?? []).find(item => item.exerciseId === exercise.exerciseId);
  const base = baseline(lastEntry, initial);
  if (typeof base !== "number" || !Number.isFinite(base)) return plan;
  const roundedBase = wholeKilograms(base);
  const weight = plan.maxWeight === null ? roundedBase : Math.min(roundedBase, plan.maxWeight);
  const roundingNote = base !== roundedBase ? ` Previous ${base} kg rounded down to a ${roundedBase} kg baseline for whole-kilogram loading; the saved workout is unchanged.` : "";
  Object.assign(plan, { weight, previousWeight: base, sourceSessionId: previous.id, sourceDate: previous.date, status: "hold" });
  const hold = reason => ({ ...plan, reason: reason + roundingNote });
  // A break counts from the last time the lift was trained on any day, so
  // the same lift on another programme day keeps it fresh.
  const lastTrained = earlierSessions.filter(session => session.exercises?.some(item =>
    item.exerciseId === exercise.exerciseId && item.sets?.length
  )).reduce((latest, session) => session.date > latest ? session.date : latest, "");
  const gap = lastTrained ? daysBetween(lastTrained, date) : 0;
  if (gap > BREAK_DAYS && weight > 0) {
    const percent = gap > LONG_BREAK_DAYS || age >= OLDER_AGE ? 80 : 90;
    const restart = percentOf(weight, percent);
    const away = gap > LONG_BREAK_DAYS ? "more than 12 weeks" : age >= OLDER_AGE ? "more than 4 weeks at 65 or over" : "more than 4 weeks";
    return {
      ...plan, weight: restart, status: "return",
      reason: `You last trained this lift ${Math.floor(gap / 7)} weeks ago, on ${lastTrained}. After ${away} away, a cautious restart is about ${percent}% of your last load: ${restart} kg instead of ${weight} kg. This is a convention, not a fixed rule, so change the weight if it feels too light or too heavy.` + roundingNote,
    };
  }
  if (!entry) return hold("This exercise was not logged in the last workout for this day. Repeat the last load.");
  const result = review(entry, plan, base, chooseStartingWeight);
  // The session before the previous one, for two in a row at the same load.
  const earlierEntry = history.find(session => session.date < previous.date)?.exercises?.find(item => item.exerciseId === exercise.exerciseId);
  const earlierBase = earlierEntry && baseline(earlierEntry, initial);
  const earlier = earlierEntry && Number.isFinite(earlierBase) && wholeKilograms(earlierBase) === roundedBase ?
    review(earlierEntry, plan, earlierBase, chooseStartingWeight) : null;
  if (result.hold) {
    // Two failed sessions in a row at one load: propose a reset, never
    // impose it. The plan still repeats the load until the athlete takes it.
    const held = hold(result.hold);
    const resetWeight = percentOf(weight, 90);
    if (!result.failed || !earlier?.failed || resetWeight <= 0 || resetWeight >= weight) return held;
    return { ...held, resetWeight, reason: held.reason + ` Two sessions in a row at ${weight} kg ended with a miss or an RPE above ${RPE_LIMIT}. A common coaching convention, not a rule, is to reset to about 90%: ${resetWeight} kg. Take the reset, or repeat ${weight} kg.` };
  }
  if (previous.recovery === "limited") return hold("Recovery was limited in the previous session. Repeat the load before increasing.");
  const twoInARow = earlier !== null && earlier.hold === null;
  if (result.rpe === null && !twoInARow) {
    return hold(`All prescribed sets were made, with no RPE recorded. Repeat ${roundedBase} kg: a second completed session at this load, or an RPE of ${RPE_LIMIT} or lower on the last set, unlocks the next increase.`);
  }
  const increased = roundedBase + plan.step;
  if (plan.maxWeight !== null && increased > plan.maxWeight) {
    return { ...plan, status: "limit", reason: "The next full increase exceeds the program’s load range. Hold here and review the program." + roundingNote };
  }
  if (recovery === "limited") return hold("Recovery is limited today. Repeat the previous load.");
  if (gap > BREAK_HOLD_DAYS) return hold(`You last trained this lift ${gap} days ago. Repeat the last load before increasing again.`);
  if (age > 0 && age < ADULT_AGE && !techniqueChecked) {
    return { ...plan, status: "confirm", reason: `Under 18, the load goes up only once a coach has checked your technique. When your coach has checked it, confirm it in this workout to add ${plan.step} kg.` + roundingNote };
  }
  const why = result.rpe !== null ?
    `All prescribed sets and reps were made, the top set at RPE ${result.rpe}.` :
    `No RPE recorded; increase based on two completed sessions at ${roundedBase} kg.`;
  return { ...plan, weight: increased, status: "increase", reason: `${age > 0 && age < ADULT_AGE ? "Your coach checked your technique. " : ""}${why} The program automatically adds ${plan.step} kg total (${plan.step / 2} kg per side).` + roundingNote };
}

// The program shows the next exposure immediately after a completed session.
// Training again today still uses today's prescription, so a repeat cannot
// compound increases. Future-dated logs never feed this preview.
export function planProgramDay(day, { sessions = [], programId, date, age = 0 }) {
  const history = sessions.filter(session => session.date <= date);
  const trainedToday = history.some(session => session.programId === programId && session.programDayId === day.id && session.date === date);
  const nextDate = new Date(date + "T12:00:00Z");
  if (trainedToday) nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const availableFrom = nextDate.toISOString().slice(0, 10);
  return { availableFrom, trainedToday, exercises: day.exercises.map(exercise => ({
    exerciseId: exercise.exerciseId,
    ...planExercise(exercise, { sessions: history, programId, dayId: day.id, date: availableFrom, age }),
  })) };
}

// Upgrade only untouched presets. Never reinterpret an athlete's recorded or
// manually edited sets, or rewrite a saved historical session.
export function upgradeProgramDraft(draft, { day, sessions, age = 0 }) {
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
    const plan = planExercise(exercise, { sessions, programId: upgraded.programId, dayId: day.id, date: upgraded.date, recovery: upgraded.recovery, age, techniqueChecked: upgraded.techniqueChecked === true });
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
