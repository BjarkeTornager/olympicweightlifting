import {
  APP_META,
  CHART_EXERCISE_IDS,
  EXERCISES,
  MILESTONES,
  PR_DEFINITIONS,
  PROGRAM_DEFINITION,
  getExercise,
  getProgramDay,
} from "./data.js";
import {
  StorageError,
  createBackup,
  createDefaultState,
  loadState,
  parseBackup,
  replaceState,
  saveState,
} from "./storage.js";

import { PROGRESSION_VERSION, PROGRESSION_STEP, PROGRAM_PROGRESSION_REVISION, wholeKilograms, planExercise, planProgramDay, upgradeProgramDraft, isLoggedSet, isValidLoggedSet, updatePendingSets } from "./progression.js";

const main = document.querySelector("#app-content");
const toast = document.querySelector("#toast");
const confirmDialog = document.querySelector("#confirm-dialog");
const prDialog = document.querySelector("#pr-dialog");
const validRoutes = new Set(["dashboard", "workout", "history", "progress", "library", "data"]);

let state;
let startupError = "";
let toastTimer = null;
let confirmCallback = null;
let prDialogContinuation = null;
let deferredInstallPrompt = null;
let lastRenderedRoute = "";
const historyFilters = { exerciseId: "", dateFrom: "", dateTo: "" };
let selectedDayId = "";
let selectedTrainingDate = "";
let programFilter = "all";
let historyFiltersOpen = false;
let progressExerciseId = "snatch";
let progressPeriod = "all";
const techniqueDialog = document.querySelector("#technique-dialog");

try {
  state = loadState();
} catch (error) {
  state = createDefaultState();
  startupError = error.message;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix = "id") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromIso(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day, 12) : new Date(value);
}

function formatDate(value, options = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "No date";
  const date = dateFromIso(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(numeric);
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getRoute() {
  const raw = window.location.hash.replace(/^#/, "") || "dashboard";
  const [route, parameter = ""] = raw.split("/");
  return {
    route: validRoutes.has(route) ? route : "dashboard",
    parameter: decodeURIComponent(parameter),
  };
}

function routeTitle(route) {
  return {
    dashboard: "Home",
    workout: "Workout",
    history: "History",
    progress: "Progress",
    library: "Exercise library",
    data: "Data & profile",
  }[route];
}

function persist({ quiet = true } = {}) {
  try {
    state = saveState(state);
    if (!quiet) showToast("Saved");
    return true;
  } catch (error) {
    showToast(error.message, { error: true, duration: 6500 });
    return false;
  }
}

function showToast(message, { error = false, duration = 2800 } = {}) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", error);
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function requestConfirmation({ title, message, confirmLabel = "Confirm", dangerous = true, onConfirm }) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  const action = document.querySelector("#confirm-action");
  action.textContent = confirmLabel;
  action.className = `button ${dangerous ? "button-danger" : "button-primary"}`;
  confirmCallback = onConfirm;
  confirmDialog.returnValue = "";
  confirmDialog.showModal();
}

function navigate(route) {
  const nextHash = `#${route}`;
  if (window.location.hash === nextHash) {
    render({ focus: true });
  } else {
    window.location.hash = nextHash;
  }
}

function updateNavigation(route) {
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    const isCurrent = link.dataset.routeLink === route;
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function metricCard(label, value, unit = "kg") {
  return `
    <article class="card metric-card">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong class="metric-value">${escapeHtml(formatNumber(value))}<span class="metric-unit">${escapeHtml(unit)}</span></strong>
    </article>
  `;
}

function goalCard(exerciseId, target) {
  const exercise = getExercise(exerciseId);
  const current = Number(state.prs[exerciseId]) || 0;
  const percentage = Math.min(100, Math.max(0, (current / target) * 100));
  const remaining = Math.max(0, target - current);

  return `
    <article class="card goal-card">
      <div class="goal-heading">
        <h3>${escapeHtml(exercise.name)}</h3>
        <span class="goal-numbers">${escapeHtml(formatNumber(current))} / ${escapeHtml(formatNumber(target))} kg</span>
      </div>
      <progress class="progress-track" aria-label="${escapeHtml(exercise.name)} progress" max="${target}" value="${current}">${Math.round(percentage)}%</progress>
      <div class="goal-meta">
        <span>${Math.round(percentage)}% of target</span>
        <span>${remaining > 0 ? `${formatNumber(remaining)} kg to go` : "Target reached"}</span>
      </div>
    </article>
  `;
}

function setsLabel(sets) {
  if (typeof sets === "number") return String(sets);
  if (!sets || typeof sets !== "object") return "Open";
  return sets.min === sets.max ? String(sets.min) : `${sets.min}–${sets.max}`;
}

function sessionExerciseNames(session, limit = 3) {
  const names = (session.exercises ?? []).map((entry) => getExercise(entry.exerciseId).name);
  if (names.length <= limit) return names.join(", ") || "No exercises";
  return `${names.slice(0, limit).join(", ")} +${names.length - limit}`;
}

function renderInstallCard() {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone;
  if (standalone || state.preferences.installHintDismissed) return "";

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const copy = isIos
    ? "In Safari, tap Share, then Add to Home Screen. The app shell will be available offline after its first load."
    : deferredInstallPrompt
      ? "Install Lift Journal for a full-screen experience and offline access to the app shell."
      : "Use your browser’s install or Add to Home Screen command for quick access and an app-like window.";

  return `
    <aside class="install-card section" aria-label="Install Lift Journal">
      <div>
        <h2>Keep it on your home screen</h2>
        <p>${escapeHtml(copy)}</p>
      </div>
      <div class="button-row">
        ${deferredInstallPrompt ? '<button class="button button-primary button-small" data-action="install-app">Install</button>' : ""}
        <button class="button button-quiet button-small" data-action="dismiss-install">Dismiss</button>
      </div>
    </aside>
  `;
}

function currentProgramPlan(day, date = localIsoDate()) {
  return planProgramDay(day, { sessions: state.sessions, programId: PROGRAM_DEFINITION.id, date });
}

function isSoloProgram(day) {
  return day.exercises.some(exercise => exercise.progression);
}

function validTrainingDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function renderProgramTargets(day, plan = currentProgramPlan(day)) {
  const automatic = plan.exercises.some(exercise => exercise.status !== "manual");
  return `<div class="program-targets" data-program-targets="${escapeHtml(day.id)}">
    <div class="program-targets-heading"><strong>Next session loads</strong><span>${automatic ? "Auto progression" : "Coach-led"}</span></div>
    ${plan.trainedToday ? `<p class="program-repeat-note">Next loads apply from ${escapeHtml(formatDate(plan.availableFrom, { day: "numeric", month: "short" }))}. A repeat on the same training date keeps that date’s loads.</p>` : ""}
    <ul>${plan.exercises.map(exercise => `<li data-program-exercise="${escapeHtml(exercise.exerciseId)}" data-target-weight="${escapeHtml(exercise.weight)}">
      <span class="program-lift-name">${escapeHtml(getExercise(exercise.exerciseId).name)}</span>
      <strong class="program-load">${exercise.status === "manual" ? "Manual" : exercise.status === "choose" ? "Choose load" : `${formatNumber(exercise.weight)} <small>kg</small>`}</strong>
      <span class="program-dose">${exercise.sets} sets × ${exercise.reps} ${exercise.reps === 1 ? "rep" : "reps"}</span>
      <span class="program-load-status ${exercise.status === "increase" ? "is-increase" : ""}">${exercise.status === "increase" ? `↑ +${formatNumber(exercise.step)} kg · ${formatNumber(exercise.step / 2)} / side` : exercise.status === "initial" ? "Starting load" : exercise.status === "choose" ? "Set your baseline" : exercise.status === "manual" ? "Manual load" : "Repeat load"}</span>
      ${["hold", "limit"].includes(exercise.status) ? `<small class="program-hold-reason">${escapeHtml(exercise.reason)}</small>` : ""}
    </li>`).join("")}</ul>
    <p class="program-rule">${automatic ? `Complete the prescribed work to earn +${PROGRESSION_STEP} kg total (${PROGRESSION_STEP / 2} kg per side) next time. Targets use whole kilograms; old fractional loads round down before progressing. Starting ranges are not permanent limits.` : "Your coach sets these loads. Training on your own? Choose a solo programme for automatic progression on any day."}</p>
  </div>`;
}

function renderDashboard() {
  const today = new Date();
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const days = PROGRAM_DEFINITION.days.filter(day => Number.isInteger(day.weekday));
  const nextDay = days.find((day) => day.weekday >= (today.getDay() || 7)) ?? days[0];
  const selected = getProgramDay(selectedDayId) ?? nextDay;
  const active = state.activeWorkout;
  const recent = [...state.sessions].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 3);
  const weekSessions = state.sessions.filter((session) => session.date >= localIsoDate(weekStart) && session.date <= localIsoDate(today));
  const total = Number(state.prs.snatch || 0) + Number(state.prs.clean_and_jerk || 0);
  return `
    <section class="page dashboard-page" aria-labelledby="dashboard-title">
      <header class="page-header home-heading">
        <div><p class="eyebrow">${escapeHtml(formatDate(localIsoDate(), { weekday: "long", day: "numeric", month: "long" }))}</p>
        <h1 id="dashboard-title">Your platform awaits.</h1></div>
        <span class="week-count">${weekSessions.length} ${weekSessions.length === 1 ? "session" : "sessions"} this week</span>
      </header>
      ${startupError ? `<div class="storage-note" role="alert">${escapeHtml(startupError)}</div>` : ""}
      <div class="home-primary">
        <article class="training-hero ${active ? "resume-card" : ""}" aria-label="${active ? "Workout in progress" : "Selected workout"}">
          <div class="hero-heading"><span class="hero-badge">${active ? "In progress" : `Today · ${isSoloProgram(selected) ? "Solo programme" : "Coached session"}`}</span><span class="hero-symbol" aria-hidden="true"><i></i><i></i><i></i></span></div>
          <svg class="platform-art" viewBox="0 0 480 120" fill="none" aria-hidden="true" focusable="false">
            <path class="platform-grid" d="M24 109h432M48 93h384M72 77h336M100 77l-22 32m96-32-11 32m77-32v32m66-32 11 32m63-32 22 32"/>
            <circle cx="240" cy="54" r="52" fill="#ffffff" opacity=".035"/>
            <path d="M130 21h220" stroke="#d4dadd" stroke-width="4" stroke-linecap="round"/>
            <path d="M174 21h132" stroke="#89969e" stroke-width="2" stroke-dasharray="2 3"/>
            <rect x="147" y="1" width="10" height="40" rx="3" fill="#e9584e"/>
            <rect x="160" y="5" width="9" height="32" rx="2" fill="#5a94df"/>
            <rect x="172" y="16" width="5" height="10" rx="1" fill="#f1ede3"/>
            <rect x="323" y="1" width="10" height="40" rx="3" fill="#e9584e"/>
            <rect x="311" y="5" width="9" height="32" rx="2" fill="#5a94df"/>
            <rect x="303" y="16" width="5" height="10" rx="1" fill="#f1ede3"/>
            <circle cx="240" cy="44" r="8" fill="#f1ede3"/>
            <path d="m200 23 23 34 17 7 17-7 23-34" stroke="#f1ede3" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M234 60h12l6 21h-24z" fill="#d5aa5a"/>
            <path d="m232 82-21 5 11 17m26-22 21 5-11 17" stroke="#f1ede3" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M211 107h15m28 0h15" stroke="#f1ede3" stroke-width="6" stroke-linecap="round"/>
            <path d="M88 115h304" stroke="#d5aa5a" stroke-width="2"/>
          </svg>
          <h2>${escapeHtml(active?.title || selected.title)}</h2>
          <p>${active ? `${active.exercises?.filter((entry) => entry.completed).length ?? 0} of ${active.exercises?.length ?? 0} exercises complete · ${escapeHtml(formatDate(active.date, { day: "numeric", month: "short" }))}` : escapeHtml(selected.focus)}</p>
          <div class="hero-meta">${active ? "Pick up where you left off." : `${selected.exercises.length} exercises · ${escapeHtml(PROGRAM_DEFINITION.name)}`}</div>
          ${active ? '<a class="button hero-action" href="#workout">Resume workout <span aria-hidden="true">→</span></a>' : `<button class="button hero-action" data-action="start-day" data-day-id="${selected.id}">Start workout <span aria-hidden="true">→</span></button>`}
          ${!active ? '<button class="button hero-solo-action" data-action="choose-solo">Train on my own today <span aria-hidden="true">↗</span></button><a class="hero-picker-link" href="#workout">Choose another programme or date</a>' : ""}
        </article>
        <section class="week-panel" aria-labelledby="weekly-plan-title">
          <div class="section-header"><h2 id="weekly-plan-title">Usual weekly split</h2><a class="text-action" href="#workout">All programmes</a></div>
          <p class="schedule-hint">Weekdays are a guide. You can train any programme on any date.</p>
          <div class="week-selector" aria-label="Choose a training day">
            ${days.map((day) => {
              const done = weekSessions.some((session) => session.programDayId === day.id);
              return `<button class="week-day ${done ? "is-done" : ""}" data-action="select-day" data-day-id="${day.id}" aria-pressed="${selected.id === day.id}" aria-label="${day.name}${done ? ", completed this week" : ""}"><span>${day.name.slice(0, 3)}</span><span class="week-marker" aria-hidden="true">${done ? "✓" : day.weekday === today.getDay() ? "●" : "○"}</span></button>`;
            }).join("")}
          </div>
          <div class="week-preview"><h3>${escapeHtml(selected.title)}</h3>${renderProgramTargets(selected)}</div>
        </section>
      </div>
      <section class="section" aria-label="Current personal records">
        <div class="section-header"><h2>Your numbers</h2><a class="text-action" href="#progress/prs">Edit PRs</a></div>
        <div class="metric-grid compact-metrics">${metricCard("Snatch", state.prs.snatch)}${metricCard("Clean & jerk", state.prs.clean_and_jerk)}${metricCard("Total", total)}</div>
      </section>
      <section class="section" aria-labelledby="recent-title">
        <div class="section-header"><h2 id="recent-title">Recent training</h2><a class="text-action" href="#history">View all</a></div>
        ${recent.length ? `<ul class="session-list">${recent.map((session) => `<li><a href="#history/${encodeURIComponent(session.id)}"><span class="session-list-date">${escapeHtml(formatDate(session.date, { day: "numeric", month: "short" }))}</span><span><strong>${escapeHtml(session.title || "Training session")}</strong><small>${escapeHtml(sessionExerciseNames(session))}</small></span><span aria-hidden="true">↗</span></a></li>`).join("")}</ul>` : '<div class="quiet-empty"><p>Your training story starts here.</p><span>Finish a workout to see it here.</span></div>'}
      </section>
      <section class="section" aria-labelledby="immediate-targets-title">
        <div class="section-header"><h2 id="immediate-targets-title">Next milestone</h2><span>175 kg total</span></div>
        <div class="goal-grid">${goalCard("snatch", 70)}${goalCard("clean_and_jerk", 105)}</div>
      </section>
      <details class="rules-details section"><summary>Program guidance</summary><div class="rules-body">
        <h3>Training priorities</h3><ul>${PROGRAM_DEFINITION.priorities.map((priority) => `<li>${escapeHtml(priority)}</li>`).join("")}</ul>
        <h3>Loading rules</h3><ul>${PROGRAM_DEFINITION.loadingRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
        <h3>Review after ${escapeHtml(PROGRAM_DEFINITION.reviewWindow)}</h3><ul>${PROGRAM_DEFINITION.reviewCriteria.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
      </div></details>
      ${renderInstallCard()}
    </section>`;
}

function createSet(initialWeight = "", reps = 1) {
  return {
    id: makeId("set"),
    weight: initialWeight === null || initialWeight === undefined ? "" : String(initialWeight),
    reps: reps === null || reps === undefined ? "" : String(reps),
    rpe: "",
    result: "",
    touched: false,
  };
}

function createWorkoutExercise(programExercise, context) {
  const plan = planExercise(programExercise, context);
  const count = plan.sets;
  return {
    id: makeId("entry"),
    exerciseId: programExercise.exerciseId,
    loggingVersion: PROGRESSION_VERSION,
    strongSets: false,
    completed: false,
    athleteNotes: "",
    coachCue: "",
    prescribed: {
      sets: clone(programExercise.sets),
      reps: programExercise.reps,
      recommendation: programExercise.recommendation,
      notes: programExercise.notes,
      priority: programExercise.priority,
      optional: Boolean(programExercise.optional),
      videoRef: programExercise.videoRef,
      targetSets: count,
      targetReps: plan.reps,
      targetWeight: plan.weight,
      progression: plan,
    },
    sets: Array.from({ length: count }, () => createSet(plan.weight, plan.reps)),
  };
}

function startProgramDay(dayId, date = localIsoDate()) {
  const day = getProgramDay(dayId);
  if (!day) return;
  if (!validTrainingDate(date)) { showToast("Choose a valid training date.", { error: true }); return; }

  if (state.activeWorkout) {
    navigate("workout");
    showToast("Your saved workout is still in progress.");
    return;
  }

  state.activeWorkout = {
    id: makeId("workout"),
    editingSessionId: null,
    programId: PROGRAM_DEFINITION.id,
    programRevision: PROGRAM_DEFINITION.revision,
    programDayId: day.id,
    title: day.title,
    date,
    startedAt: new Date().toISOString(),
    athleteNotes: "",
    coachNotes: "",
    sessionPrompt: day.sessionPrompt ?? "",
    recovery: "auto",
    progressionRevision: PROGRAM_PROGRESSION_REVISION,
    exercises: day.exercises.map(exercise => createWorkoutExercise(exercise, {
      sessions: state.sessions, programId: PROGRAM_DEFINITION.id, dayId: day.id, date,
    })),
  };
  persist();
  navigate("workout");
}

function replanUntouchedExercises() {
  const draft = state.activeWorkout;
  const day = getProgramDay(draft?.programDayId);
  if (!day || draft.editingSessionId) return;
  for (const entry of draft.exercises) {
    if (entry.loggingVersion !== PROGRESSION_VERSION || entry.completed ||
      entry.sets.some(set => set.touched || isLoggedSet(set))) continue;
    const exercise = day.exercises.find(item => item.exerciseId === entry.exerciseId);
    if (!exercise) continue;
    const plan = planExercise(exercise, {
      sessions: state.sessions, programId: draft.programId, dayId: day.id,
      date: draft.date, recovery: draft.recovery,
    });
    entry.prescribed.progression = plan;
    entry.prescribed.targetWeight = plan.weight;
    entry.prescribed.targetReps = plan.reps;
    entry.sets.forEach(set => { set.weight = String(plan.weight); set.reps = String(plan.reps); });
  }
}

function upgradeActiveProgram() {
  const upgraded = upgradeProgramDraft(state.activeWorkout, {
    day: getProgramDay(state.activeWorkout?.programDayId), sessions: state.sessions,
  });
  if (upgraded !== state.activeWorkout) {
    state.activeWorkout = upgraded;
    persist();
  }
}

function startOpenWorkout(date = localIsoDate()) {
  if (!validTrainingDate(date)) { showToast("Choose a valid training date.", { error: true }); return; }
  if (state.activeWorkout) {
    navigate("workout");
    return;
  }

  state.activeWorkout = {
    id: makeId("workout"),
    editingSessionId: null,
    programId: null,
    programRevision: null,
    programDayId: null,
    title: "Open training session",
    date,
    startedAt: new Date().toISOString(),
    athleteNotes: "",
    coachNotes: "",
    sessionPrompt: "",
    exercises: [],
  };
  persist();
  render({ focus: true });
}

function renderWorkoutPicker() {
  const date = selectedTrainingDate || localIsoDate();
  const dateLabel = date === localIsoDate() ? "today" : formatDate(date, { day: "numeric", month: "short" });
  const days = PROGRAM_DEFINITION.days.filter(day => programFilter === "all" || isSoloProgram(day) === (programFilter === "solo"));
  return `
    <section class="page" aria-labelledby="workout-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">Workout</p>
          <h1 id="workout-title">Choose your training.</h1>
          <p class="page-lead">Pick a date and a programme. The usual weekday is just a guide—solo training works on Saturdays too.</p>
        </div>
      </header>

      <section class="training-picker-controls" aria-label="Training date and programme type">
        <div class="training-date-row"><label class="field"><span>Training date</span><input id="training-date" type="date" value="${escapeHtml(date)}" required></label><button class="button button-secondary" data-action="training-today">Today</button></div>
        <div class="training-type-selector" role="group" aria-label="Programme type">${[["all", "All programmes"], ["solo", "On my own"], ["coached", "With my coach"]].map(([value, label]) => `<button class="button button-secondary" data-action="filter-programs" data-filter="${value}" aria-pressed="${programFilter === value}">${label}</button>`).join("")}</div>
        <p class="schedule-hint">${programFilter === "solo" ? "No coached session today? Pick a solo programme below. " : ""}Loads follow your history for the chosen programme, not the weekday you train.</p>
      </section>
      <div class="workout-picker-grid">
        ${days
          .map((day) => {
            const plan = currentProgramPlan(day, date);
            return `
              <article class="card workout-picker" data-program-day="${escapeHtml(day.id)}">
                <p class="eyebrow">${isSoloProgram(day) ? "Solo" : "Coached"} · ${day.weekday == null ? "Any day · Normal gym" : `Usual split: ${escapeHtml(day.name)}`}</p>
                <h2>${escapeHtml(day.title)}</h2>
                <p>${escapeHtml(day.focus)}</p>
                <button class="button button-primary" data-action="start-day" data-day-id="${escapeHtml(day.id)}" data-training-date="${escapeHtml(date)}">${plan.trainedToday ? "Repeat" : "Start"} ${escapeHtml(dateLabel)}</button>
                <details class="picker-load-preview" data-ui-details="picker-${escapeHtml(day.id)}"><summary>Preview loads · ${day.exercises.length} exercises</summary>${day.sessionPrompt ? `<p>${escapeHtml(day.sessionPrompt)}</p>` : ""}${renderProgramTargets(day, plan)}</details>
              </article>
            `;
          })
          .join("")}
        <article class="card workout-picker">
          <p class="eyebrow">Flexible logging</p>
          <h2>Open session</h2>
          <p>Build an unprogrammed workout one exercise at a time.</p>
          <button class="button button-secondary" data-action="start-open-workout" data-training-date="${escapeHtml(date)}">Start open session ${escapeHtml(dateLabel)}</button>
        </article>
      </div>
    </section>
  `;
}

function prescriptionSummary(entry) {
  const prescribed = entry.prescribed ?? {};
  if (prescribed.progression?.status !== "manual" && prescribed.targetWeight != null && prescribed.targetWeight !== "") {
    return `${prescribed.targetSets} sets × ${prescribed.targetReps} ${prescribed.targetReps === 1 ? "rep" : "reps"} · ${formatNumber(prescribed.targetWeight)} kg`;
  }
  const setText = setsLabel(prescribed.sets);
  const pieces = [`${setText} × ${prescribed.reps ?? "open"}`];
  if (prescribed.recommendation) pieces.push(prescribed.recommendation);
  if (prescribed.optional) pieces.push("Optional");
  return pieces.join(" · ");
}

function progressionSummary(entry) {
  const plan = entry.prescribed.progression;
  if (plan.status === "choose") return `Choose starting weight · ${plan.sets} sets × ${plan.reps}`;
  return `${plan.status === "increase" ? "↑ Progressed" : "Planned"} · ${formatNumber(entry.prescribed.targetWeight)} kg × ${entry.prescribed.targetReps}`;
}

function setFieldAttributes(entry, set, field) {
  return `data-draft-set-field="${field}" data-entry-id="${escapeHtml(entry.id)}" data-set-id="${escapeHtml(set.id)}"`;
}

function renderSetRow(entry, set, index) {
  const exercise = getExercise(entry.exerciseId);
  const actionData = `data-entry-id="${escapeHtml(entry.id)}" data-set-id="${escapeHtml(set.id)}"`;
  return `
    <div class="set-row ${set.result ? "is-" + escapeHtml(set.result) : set.logged ? "is-logged" : ""}" data-set-row="${escapeHtml(set.id)}">
      <span class="set-number" aria-label="Set ${index + 1}">${index + 1}</span>
      <label class="set-weight"><span>kg</span><input type="number" inputmode="decimal" min="0" step="1" value="${escapeHtml(set.weight ?? "")}" placeholder="kg" ${setFieldAttributes(entry, set, "weight")} aria-label="Set ${index + 1} weight in kilograms"></label>
      <label class="set-reps"><span>Reps</span><input type="number" inputmode="numeric" min="0" step="1" value="${escapeHtml(set.reps ?? "")}" ${setFieldAttributes(entry, set, "reps")} aria-label="Set ${index + 1} repetitions"></label>
      <div class="set-result" role="group" aria-label="Set ${index + 1} result">
        ${exercise.tracksOutcome ? `<button class="result-button" data-action="set-result" data-result="success" ${actionData} aria-pressed="${set.result === "success"}" aria-label="Set ${index + 1} made">Made</button><button class="result-button miss-button" data-action="set-result" data-result="miss" ${actionData} aria-pressed="${set.result === "miss"}" aria-label="Set ${index + 1} missed">Miss</button>` : `<button class="result-button log-button" data-action="log-set" ${actionData} aria-pressed="${Boolean(set.logged)}" aria-label="Log set ${index + 1}">${set.logged ? "✓ Done" : "Log set"}</button>`}
      </div>
      <details class="set-options" data-ui-details="set-${escapeHtml(set.id)}"><summary>Set options${set.rpe ? ` · RPE ${escapeHtml(set.rpe)}` : ""}</summary>
        <div class="set-options-body">
          <div class="weight-adjust" role="group" aria-label="Adjust set ${index + 1} weight">${[-2, 2, -5, 5].map(delta => `<button class="button button-secondary" data-action="adjust-weight" data-delta="${delta}" ${actionData} aria-label="${delta < 0 ? "Decrease" : "Increase"} set ${index + 1} by ${Math.abs(delta)} kilograms total, ${Math.abs(delta) / 2} kilograms per side"><span>${delta < 0 ? "−" : "+"}${Math.abs(delta)} kg</span><small>${Math.abs(delta) / 2} kg / side</small></button>`).join("")}</div>
          <label class="field"><span>RPE (optional)</span><input type="number" inputmode="decimal" min="1" max="10" step="0.5" value="${escapeHtml(set.rpe ?? "")}" placeholder="1–10" ${setFieldAttributes(entry, set, "rpe")} aria-label="Set ${index + 1} RPE"></label>
          ${index ? `<button class="button button-secondary" data-action="copy-set" ${actionData}>Copy previous weight & reps</button>` : ""}
          <button class="button button-danger-quiet" data-action="remove-set" ${actionData} ${entry.sets.length <= 1 ? "disabled" : ""}>Remove set ${index + 1}</button>
        </div>
      </details>
    </div>`;
}

function renderWorkoutExercise(entry, index) {
  const exercise = getExercise(entry.exerciseId);
  const isActive = state.activeWorkout.activeExerciseId === entry.id;
  const previousSession = [...state.sessions].filter((session) => session.id !== state.activeWorkout.editingSessionId && session.date <= state.activeWorkout.date && session.exercises?.some((item) => item.exerciseId === entry.exerciseId))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.finishedAt).localeCompare(String(a.finishedAt)))[0];
  const previous = previousSession?.exercises.find((item) => item.exerciseId === entry.exerciseId);
  const previousSets = previous?.sets?.filter((set) => set.result !== "miss" && Number.parseFloat(set.weight) > 0) ?? [];
  const best = previousSets.length ? previousSets.reduce((a, b) => Number(a.weight) > Number(b.weight) ? a : b) : null;
  return `
    <article class="exercise-log-card ${entry.completed ? "is-complete" : ""} ${isActive ? "is-active" : ""}" id="exercise-${escapeHtml(entry.id)}">
      <button class="exercise-heading" data-action="select-exercise" data-entry-id="${escapeHtml(entry.id)}" aria-expanded="${isActive}" aria-controls="exercise-body-${escapeHtml(entry.id)}">
        <span class="exercise-badge" aria-hidden="true">${entry.completed ? "✓" : String(index + 1).padStart(2, "0")}</span>
        <span class="exercise-heading-copy"><span class="exercise-name">${escapeHtml(exercise.name)}</span><span class="exercise-summary">${entry.completed ? "Complete · " : ""}${escapeHtml(prescriptionSummary(entry))}</span></span><span class="exercise-chevron" aria-hidden="true">${isActive ? "−" : "+"}</span>
      </button>
      <div id="exercise-body-${escapeHtml(entry.id)}" class="exercise-body" ${isActive ? "" : "hidden"}>
        ${entry.prescribed?.notes ? `<p class="prescription-note">${escapeHtml(entry.prescribed.notes)}</p>` : ""}
        ${entry.prescribed?.progression && entry.prescribed.progression.status !== "manual" ? `<details class="progression-note" data-ui-details="progression-${escapeHtml(entry.id)}"><summary><strong>${escapeHtml(progressionSummary(entry))}</strong><span class="progression-why">Why? <span aria-hidden="true">⌄</span></span></summary><div class="progression-body"><span>${escapeHtml(entry.prescribed.progression.reason)}</span>${entry.prescribed.progression.sourceDate ? `<small>Based on ${escapeHtml(formatDate(entry.prescribed.progression.sourceDate))}</small>` : ""}<small>Weight and rep edits carry to later unlogged sets. Direct edits are kept.</small></div></details>` : ""}
        ${best ? `<p class="last-session">Last time <strong>${formatNumber(best.weight)} kg × ${escapeHtml(best.reps)} reps</strong><span>${escapeHtml(formatDate(previousSession.date, { day: "numeric", month: "short" }))}</span></p>` : ""}
        <div class="sets-area">
          ${entry.sets.map((set, setIndex) => renderSetRow(entry, set, setIndex)).join("")}
          <div class="sets-footer"><button class="button button-secondary" data-action="add-set" data-entry-id="${escapeHtml(entry.id)}">+ Add set</button>
          ${exercise.videoId ? `<button class="button button-quiet video-shortcut" data-action="technique" data-exercise-id="${escapeHtml(exercise.id)}">▷ Technique</button>` : ""}</div>
        </div>
        ${entry.prescribed?.progression && entry.prescribed.progression.status !== "manual" ? `<button class="strong-sets-control" data-action="strong-sets" data-entry-id="${escapeHtml(entry.id)}" aria-pressed="${Boolean(entry.strongSets)}"><span aria-hidden="true">${entry.strongSets ? "✓" : "○"}</span> Sets felt strong and controlled (optional)</button>` : ""}
        <details class="exercise-notes" data-ui-details="notes-${escapeHtml(entry.id)}"><summary>Notes & coach cue${entry.athleteNotes || entry.coachCue ? " · added" : ""}</summary>
          <div class="exercise-notes-grid">
            <label class="field"><span>Athlete notes</span><textarea rows="2" placeholder="How did it feel?" data-draft-entry-field="athleteNotes" data-entry-id="${escapeHtml(entry.id)}">${escapeHtml(entry.athleteNotes ?? "")}</textarea></label>
            <label class="field"><span>Coach cue</span><textarea rows="2" placeholder="One cue to remember" data-draft-entry-field="coachCue" data-entry-id="${escapeHtml(entry.id)}">${escapeHtml(entry.coachCue ?? "")}</textarea></label>
          </div>
        </details>
        ${entry.completed ? `<button class="button button-quiet reopen-exercise" data-action="reopen-exercise" data-entry-id="${escapeHtml(entry.id)}">Mark incomplete</button>` : ""}
      </div>
    </article>`;
}

function renderWorkoutDock(draft) {
  const exercises = draft.exercises ?? [];
  const active = exercises.find(entry => entry.id === draft.activeExerciseId);
  if (!active) return "";
  return `<div class="workout-dock"><span class="dock-caption">${active.completed ? "All entered work saves when you finish." : `Exercise ${exercises.indexOf(active) + 1} of ${exercises.length}`}</span>
    ${!active.completed ? `<button class="button button-primary" data-action="complete-exercise" data-entry-id="${escapeHtml(active.id)}">Complete ${escapeHtml(getExercise(active.exerciseId).name)} <span aria-hidden="true">→</span></button>` : `<button class="button button-primary" data-action="finish-workout">${draft.editingSessionId ? "Save changes" : "Finish workout"}</button>`}
  </div>`;
}

function syncWorkoutCompletion(entry) {
  const draft = state.activeWorkout;
  const card = document.getElementById(`exercise-${entry.id}`);
  card.classList.toggle("is-complete", entry.completed);
  card.querySelector(".exercise-badge").textContent = entry.completed ? "✓" : String(draft.exercises.indexOf(entry) + 1).padStart(2, "0");
  card.querySelector(".exercise-summary").textContent = `${entry.completed ? "Complete · " : ""}${prescriptionSummary(entry)}`;
  if (!entry.completed) card.querySelector(".reopen-exercise")?.remove();
  const completed = draft.exercises.filter(item => item.completed).length;
  main.querySelector(".workout-progress-row progress").value = completed;
  main.querySelector(".workout-progress-row > span").textContent = `${completed} / ${draft.exercises.length} complete`;
  const dock = main.querySelector(".workout-dock");
  if (dock) dock.outerHTML = renderWorkoutDock(draft);
}

function renderWorkout() {
  const draft = state.activeWorkout;
  if (!draft) return renderWorkoutPicker();
  const exercises = draft.exercises ?? [];
  if (!exercises.some((entry) => entry.id === draft.activeExerciseId)) {
    draft.activeExerciseId = (exercises.find((entry) => !entry.completed) ?? exercises[0])?.id ?? "";
  }
  const completed = exercises.filter((entry) => entry.completed).length;
  const isEditing = Boolean(draft.editingSessionId);
  return `
    <section class="page workout-page" aria-labelledby="active-workout-title">
      <div class="workout-topbar">
        <div><div class="workout-title-row"><h1 id="active-workout-title">${escapeHtml(draft.title || "Training session")}</h1><span class="draft-saved" id="draft-saved-status" role="status">Saved</span></div>
        <div class="workout-progress-row"><progress class="progress-track" aria-label="Workout completion" max="${Math.max(1, exercises.length)}" value="${completed}"></progress><span>${completed} / ${exercises.length} complete</span></div></div>
        <button class="button button-quiet" data-action="finish-workout">${isEditing ? "Save changes" : "Finish"}</button>
      </div>
      ${draft.programDayId && !isEditing ? `<label class="field recovery-field"><span>Recovery today</span><select id="workout-recovery"><option value="auto" ${draft.recovery !== "limited" ? "selected" : ""}>Automatic · follow program</option><option value="limited" ${draft.recovery === "limited" ? "selected" : ""}>Limited · repeat previous loads</option></select><small>Progression is on. Limited recovery holds untouched exercises.</small></label>` : ""}
      <details class="session-details" data-ui-details="session-meta"><summary>${escapeHtml(formatDate(draft.date, { day: "numeric", month: "short" }))} · Session details</summary>
        <div class="session-meta-panel">
          <label class="field"><span>Session date</span><input type="date" value="${escapeHtml(draft.date ?? localIsoDate())}" data-draft-session-field="date"></label>
          <label class="field"><span>Session name</span><input type="text" value="${escapeHtml(draft.title ?? "")}" data-draft-session-field="title" autocomplete="off"></label>
          <button class="button button-danger-quiet" data-action="abandon-workout">${isEditing ? "Cancel edit" : "Discard workout"}</button>
        </div>
      </details>
      ${draft.sessionPrompt ? `<p class="coach-prompt">${escapeHtml(draft.sessionPrompt)}</p>` : ""}
      ${exercises.length ? `<div class="exercise-stack">${exercises.map(renderWorkoutExercise).join("")}</div>` : '<div class="quiet-empty"><h2>What are you training?</h2><p>Add an exercise to begin.</p></div>'}
      <div class="add-exercise-panel"><label class="field" for="add-exercise-select"><span>Add an exercise</span><select id="add-exercise-select">${[...EXERCISES].sort((a, b) => a.name.localeCompare(b.name)).map((exercise) => `<option value="${escapeHtml(exercise.id)}">${escapeHtml(exercise.name)}</option>`).join("")}</select></label><button class="button button-secondary" data-action="add-exercise">Add exercise</button></div>
      <details class="session-details session-notes" data-ui-details="session-notes"><summary>Session notes${draft.athleteNotes || draft.coachNotes ? " · added" : ""}</summary><div class="session-notes-panel">
        <label class="field"><span>Overall athlete notes</span><textarea rows="3" placeholder="Energy, recovery, session summary…" data-draft-session-field="athleteNotes">${escapeHtml(draft.athleteNotes ?? "")}</textarea></label>
        <label class="field"><span>Overall coach notes</span><textarea rows="3" placeholder="Feedback from your coach" data-draft-session-field="coachNotes">${escapeHtml(draft.coachNotes ?? "")}</textarea></label>
      </div></details>
      ${renderWorkoutDock(draft)}
    </section>`;
}

function findDraftEntry(entryId) {
  return state.activeWorkout?.exercises?.find((entry) => entry.id === entryId) ?? null;
}

function markDraftSaved() {
  const savedStatus = document.querySelector("#draft-saved-status");
  if (!savedStatus) return;
  savedStatus.textContent = "Saved";
}

function setWasPerformed(entry) {
  if (entry.loggingVersion === PROGRESSION_VERSION) return Boolean(entry.sets?.some(isValidLoggedSet));
  return Boolean(entry.completed || entry.sets?.some((set) => set.touched));
}

function possiblePrs(session) {
  const bestByExercise = new Map();

  for (const entry of session.exercises ?? []) {
    if (!(entry.exerciseId in state.prs)) continue;
    for (const set of entry.sets ?? []) {
      if (set.result === "miss") continue;
      const weight = Number.parseFloat(set.weight);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      bestByExercise.set(entry.exerciseId, Math.max(bestByExercise.get(entry.exerciseId) ?? 0, weight));
    }
  }

  return [...bestByExercise.entries()]
    .filter(([exerciseId, weight]) => weight > Number(state.prs[exerciseId] ?? 0))
    .map(([exerciseId, weight]) => ({
      exerciseId,
      weight,
      previous: Number(state.prs[exerciseId] ?? 0),
      name: getExercise(exerciseId).name,
    }));
}

function showPrSuggestions(candidates, continuation) {
  const list = document.querySelector("#pr-suggestion-list");
  list.innerHTML = candidates
    .map(
      (candidate) => `
        <label class="check-row">
          <input type="checkbox" name="pr-candidate" value="${escapeHtml(candidate.exerciseId)}" data-weight="${candidate.weight}" checked>
          <strong>${escapeHtml(candidate.name)}</strong>
          <span>${formatNumber(candidate.previous)} → ${formatNumber(candidate.weight)} kg</span>
        </label>
      `,
    )
    .join("");
  prDialogContinuation = continuation;
  prDialog.returnValue = "";
  prDialog.showModal();
}

function allSetsLogged(entry) {
  return entry.loggingVersion === PROGRESSION_VERSION && entry.sets?.length > 0 &&
    entry.sets.length >= (entry.prescribed?.targetSets ?? entry.sets.length) && entry.sets.every(isValidLoggedSet);
}

function finalizeWorkout() {
  const draft = state.activeWorkout;
  if (!draft) return;

  const performedExercises = (draft.exercises ?? []).filter(setWasPerformed).map((entry) => ({
    ...clone(entry),
    completed: entry.completed || allSetsLogged(entry),
    sets: (entry.sets ?? []).filter((set) => entry.loggingVersion === PROGRESSION_VERSION ? isValidLoggedSet(set) : entry.completed || set.touched || isLoggedSet(set)).map((set) => clone(set)),
  }));
  if (!performedExercises.length) {
    showToast("Mark at least one set Made, Miss, or Log set before finishing.", { error: true });
    return;
  }

  const session = {
    ...clone(draft),
    id: draft.editingSessionId ?? makeId("session"),
    editingSessionId: undefined,
    exercises: performedExercises,
    finishedAt: new Date().toISOString(),
  };
  delete session.focusedExerciseId;

  if (draft.editingSessionId) {
    const index = state.sessions.findIndex((item) => item.id === draft.editingSessionId);
    if (index >= 0) state.sessions[index] = session;
    else state.sessions.push(session);
  } else {
    state.sessions.push(session);
  }

  state.activeWorkout = null;
  persist();
  const candidates = possiblePrs(session);
  const continuation = () => {
    showToast(draft.editingSessionId ? "Session updated" : "Workout saved");
    navigate("history");
  };

  if (candidates.length) showPrSuggestions(candidates, continuation);
  else continuation();
}

function requestFinishWorkout() {
  const draft = state.activeWorkout;
  if (!draft) return;
  const performed = (draft.exercises ?? []).filter(setWasPerformed);
  if (!performed.length) {
    showToast("Mark at least one set Made, Miss, or Log set before finishing.", { error: true });
    return;
  }

  const unlogged = (draft.exercises ?? []).filter(entry => entry.loggingVersion === PROGRESSION_VERSION)
    .reduce((count, entry) => count + entry.sets.filter(set => set.touched && !isValidLoggedSet(set)).length, 0);
  if (unlogged) {
    requestConfirmation({
      title: "Leave unlogged edits out?",
      message: `${unlogged} edited sets have no valid logged result. Only explicitly logged sets will be saved.`,
      confirmLabel: "Save logged sets",
      dangerous: false,
      onConfirm: finalizeWorkout,
    });
    return;
  }
  const incomplete = performed.filter((entry) => !entry.completed && !allSetsLogged(entry)).length;
  if (incomplete) {
    requestConfirmation({
      title: "Finish this workout?",
      message: `${incomplete} logged ${incomplete === 1 ? "exercise is" : "exercises are"} not marked complete. The entered work will still be saved.`,
      confirmLabel: "Finish anyway",
      dangerous: false,
      onConfirm: finalizeWorkout,
    });
  } else {
    finalizeWorkout();
  }
}

function editSession(sessionId, focusedEntryId = "") {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;

  const beginEdit = () => {
    state.activeWorkout = {
      ...clone(session),
      id: makeId("workout"),
      editingSessionId: session.id,
      focusedExerciseId: focusedEntryId,
      activeExerciseId: focusedEntryId || session.exercises?.[0]?.id || "",
    };
    persist();
    navigate("workout");
  };

  if (state.activeWorkout) {
    requestConfirmation({
      title: "Replace the current draft?",
      message: "Opening this session for editing will discard the workout currently in progress.",
      confirmLabel: "Replace draft",
      onConfirm: beginEdit,
    });
  } else {
    beginEdit();
  }
}

function setChip(set) {
  const weight = Number.parseFloat(set.weight);
  const reps = Number.parseFloat(set.reps);
  const parts = [];
  if (Number.isFinite(weight) && weight > 0) parts.push(`${formatNumber(weight)} kg`);
  if (Number.isFinite(reps) && reps > 0) parts.push(`${formatNumber(reps)} ${reps === 1 ? "rep" : "reps"}`);
  if (set.rpe !== "" && Number.isFinite(Number.parseFloat(set.rpe))) parts.push(`RPE ${formatNumber(set.rpe)}`);
  if (!parts.length) parts.push("Logged set");
  const result = set.result === "success" ? " · ✓" : set.result === "miss" ? " · Miss" : "";
  return `<span class="set-chip ${set.result ? `is-${escapeHtml(set.result)}` : ""}">${escapeHtml(parts.join(" × "))}${result}</span>`;
}

function renderHistoryEntry(session, entry) {
  const exercise = getExercise(entry.exerciseId);
  return `
    <li class="history-entry">
      <div><h3>${escapeHtml(exercise.name)}</h3></div>
      <div>
        <div class="set-chips">${(entry.sets ?? []).map(setChip).join("") || '<span class="set-chip">No sets recorded</span>'}</div>
        ${
          entry.athleteNotes || entry.coachCue
            ? `<div class="entry-notes">
                ${entry.athleteNotes ? `<span><strong>Athlete:</strong> ${escapeHtml(entry.athleteNotes)}</span>` : ""}
                ${entry.coachCue ? `<span><strong>Coach cue:</strong> ${escapeHtml(entry.coachCue)}</span>` : ""}
              </div>`
            : ""
        }
      </div>
      <div class="entry-actions">
        <button class="button button-quiet button-small" data-action="edit-session" data-session-id="${escapeHtml(session.id)}" data-entry-id="${escapeHtml(entry.id)}">Edit</button>
        <button class="button button-danger-quiet button-small" data-action="delete-entry" data-session-id="${escapeHtml(session.id)}" data-entry-id="${escapeHtml(entry.id)}">Delete</button>
      </div>
    </li>
  `;
}

function filteredSessions() {
  return [...state.sessions]
    .filter((session) => !historyFilters.dateFrom || String(session.date) >= historyFilters.dateFrom)
    .filter((session) => !historyFilters.dateTo || String(session.date) <= historyFilters.dateTo)
    .filter(
      (session) =>
        !historyFilters.exerciseId ||
        (session.exercises ?? []).some((entry) => entry.exerciseId === historyFilters.exerciseId),
    )
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.finishedAt).localeCompare(String(a.finishedAt)));
}

function renderHistory() {
  const sessions = filteredSessions();
  const options = [...EXERCISES]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (exercise) => `<option value="${escapeHtml(exercise.id)}" ${historyFilters.exerciseId === exercise.id ? "selected" : ""}>${escapeHtml(exercise.name)}</option>`,
    )
    .join("");

  return `
    <section class="page" aria-labelledby="history-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">Training history</p>
          <h1 id="history-title">History</h1>
          <p class="page-lead">Your sessions, sets, and small wins.</p>
        </div>
        <a class="button button-primary" href="#workout">Log workout</a>
      </header>

      <details class="filter-panel" id="history-filters" ${historyFiltersOpen ? "open" : ""}>
        <summary>Filter sessions${Object.values(historyFilters).some(Boolean) ? " · active" : ""}</summary>
      <form class="history-filters" id="history-filter-form" aria-label="Filter training history">
        <label class="field filter-exercise">
          <span>Exercise</span>
          <select name="exerciseId">
            <option value="">All exercises</option>
            ${options}
          </select>
        </label>
        <label class="field">
          <span>From</span>
          <input type="date" name="dateFrom" value="${escapeHtml(historyFilters.dateFrom)}">
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" name="dateTo" value="${escapeHtml(historyFilters.dateTo)}">
        </label>
        <button class="button button-secondary" type="button" data-action="clear-history-filters">Clear</button>
      </form>

      </details>
      <p class="filter-result-count" role="status">Showing ${sessions.length} of ${state.sessions.length} ${state.sessions.length === 1 ? "session" : "sessions"}</p>

      ${
        sessions.length
          ? `<div class="history-list">
              ${sessions
                .map((session) => {
                  const entries = historyFilters.exerciseId
                    ? (session.exercises ?? []).filter((entry) => entry.exerciseId === historyFilters.exerciseId)
                    : (session.exercises ?? []);
                  return `
                    <details class="card history-session" data-ui-details="history-${escapeHtml(session.id)}" data-session-id="${escapeHtml(session.id)}" ${getRoute().parameter === session.id ? "open" : ""}>
                      <summary class="history-session-header">
                        <time class="history-session-date" datetime="${escapeHtml(session.date)}">${escapeHtml(formatDate(session.date, { day: "numeric", month: "short", year: "numeric" }))}</time>
                        <div>
                          <h2>${escapeHtml(session.title || "Training session")}</h2>
                          <p class="history-session-summary">${entries.length} ${entries.length === 1 ? "exercise" : "exercises"} · ${entries.reduce((count, entry) => count + (entry.sets?.length ?? 0), 0)} sets</p>
                        </div>
                        <span class="history-expand" aria-hidden="true">+</span>
                      </summary>
                      <div class="history-session-actions">
                        <button class="button button-quiet" data-action="edit-session" data-session-id="${escapeHtml(session.id)}">Edit session</button>
                        <button class="button button-danger-quiet" data-action="delete-session" data-session-id="${escapeHtml(session.id)}">Delete session</button>
                      </div>
                      <ul class="history-exercises">${entries.map((entry) => renderHistoryEntry(session, entry)).join("")}</ul>
                      ${
                        session.athleteNotes || session.coachNotes
                          ? `<footer class="session-footer-notes">
                              ${session.athleteNotes ? `<span><strong>Session notes:</strong> ${escapeHtml(session.athleteNotes)}</span>` : ""}
                              ${session.coachNotes ? `<span><strong>Coach notes:</strong> ${escapeHtml(session.coachNotes)}</span>` : ""}
                            </footer>`
                          : ""
                      }
                    </details>
                  `;
                })
                .join("")}
            </div>`
          : `<div class="empty-state">
              <h2>${state.sessions.length ? "No sessions match" : "Your first session starts here"}</h2>
              <p>${state.sessions.length ? "Clear or adjust the filters to see more history." : "Finished workouts will be grouped by date with every set, note and coach cue."}</p>
              ${state.sessions.length ? '<button class="button button-secondary" data-action="clear-history-filters">Clear filters</button>' : '<a class="button button-primary" href="#workout">Start a workout</a>'}
            </div>`
      }
    </section>
  `;
}

function chartData(exerciseId, period = "all") {
  const dailyBest = new Map();
  const ordered = [...state.sessions].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (const session of ordered) {
    for (const entry of session.exercises ?? []) {
      if (entry.exerciseId !== exerciseId) continue;
      for (const set of entry.sets ?? []) {
        if (set.result === "miss") continue;
        const weight = Number.parseFloat(set.weight);
        if (!Number.isFinite(weight) || weight <= 0) continue;
        dailyBest.set(session.date, Math.max(dailyBest.get(session.date) ?? 0, weight));
      }
    }
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (period === "30" ? 29 : 89));
  let runningBest = 0;
  return [...dailyBest.entries()]
    .filter(([date]) => period === "all" || (date >= localIsoDate(cutoff) && date <= localIsoDate()))
    .sort(([dateA], [dateB]) => String(dateA).localeCompare(String(dateB)))
    .map(([date, best]) => {
      runningBest = Math.max(runningBest, best);
      return { date, weight: runningBest, sessionBest: best };
    });
}

function renderLineChart(exerciseId) {
  const exercise = getExercise(exerciseId);
  const points = chartData(exerciseId, progressPeriod);
  const currentPr = Number(state.prs[exerciseId] ?? 0);

  if (!points.length) {
    return `
      <article class="card chart-card">
        <div class="chart-card-header"><h2>${escapeHtml(exercise.name)}</h2><span class="chart-current">PR ${formatNumber(currentPr)} kg</span></div>
        <div class="chart-empty">No lifts in this period.<br>Log a set or choose a longer period.</div>
      </article>
    `;
  }

  const width = 360;
  const height = 190;
  const padding = { top: 14, right: 12, bottom: 28, left: 38 };
  const values = points.map((point) => point.weight);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(10, rawMax - rawMin);
  const min = Math.max(0, Math.floor((rawMin - spread * 0.25) / 5) * 5);
  const max = Math.ceil((rawMax + spread * 0.2) / 5) * 5 || 5;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index) => (points.length === 1 ? padding.left + innerWidth / 2 : padding.left + (index / (points.length - 1)) * innerWidth);
  const y = (weight) => padding.top + ((max - weight) / Math.max(1, max - min)) * innerHeight;
  const coordinates = points.map((point, index) => `${x(index).toFixed(1)},${y(point.weight).toFixed(1)}`);
  const linePath = coordinates.map((coordinate, index) => `${index ? "L" : "M"}${coordinate}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${padding.top + innerHeight} L${x(0).toFixed(1)},${padding.top + innerHeight} Z`;
  const gridValues = [max, Math.round(((max + min) / 2) * 2) / 2, min];

  return `
    <article class="card chart-card">
      <div class="chart-card-header"><h2>${escapeHtml(exercise.name)}</h2><span class="chart-current">PR ${formatNumber(currentPr)} kg</span></div>
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title-${escapeHtml(exerciseId)} chart-desc-${escapeHtml(exerciseId)}">
        <title id="chart-title-${escapeHtml(exerciseId)}">${escapeHtml(exercise.name)} best over time</title>
        <desc id="chart-desc-${escapeHtml(exerciseId)}">${points.length} logged dates. Best logged weight is ${formatNumber(Math.max(...values))} kilograms.</desc>
        ${gridValues
          .map(
            (gridValue) => `
              <line class="chart-gridline" x1="${padding.left}" y1="${y(gridValue)}" x2="${width - padding.right}" y2="${y(gridValue)}"></line>
              <text class="chart-axis-label" x="${padding.left - 7}" y="${y(gridValue) + 3}" text-anchor="end">${formatNumber(gridValue)}</text>
            `,
          )
          .join("")}
        <path class="chart-area" d="${areaPath}"></path>
        <path class="chart-line" d="${linePath}"></path>
        ${points.map((point, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(point.weight)}" r="4"><title>${escapeHtml(formatDate(point.date, { day: "numeric", month: "short", year: "numeric" }))}: ${formatNumber(point.weight)} kg</title></circle>`).join("")}
        <text class="chart-axis-label" x="${x(0)}" y="${height - 7}" text-anchor="${points.length === 1 ? "middle" : "start"}">${escapeHtml(formatDate(points[0].date, { day: "numeric", month: "short" }))}</text>
        ${points.length > 1 ? `<text class="chart-axis-label" x="${x(points.length - 1)}" y="${height - 7}" text-anchor="end">${escapeHtml(formatDate(points.at(-1).date, { day: "numeric", month: "short" }))}</text>` : ""}
      </svg>
      <details class="chart-values">
        <summary>View logged bests</summary>
        <ul>${points.map((point) => `<li>${escapeHtml(formatDate(point.date, { day: "numeric", month: "short", year: "numeric" }))}: ${formatNumber(point.weight)} kg</li>`).join("")}</ul>
      </details>
    </article>
  `;
}

function currentMilestoneStage() {
  const snatch = Number(state.prs.snatch ?? 0);
  const cleanAndJerk = Number(state.prs.clean_and_jerk ?? 0);
  const total = snatch + cleanAndJerk;
  return MILESTONES.find((stage) => snatch < stage.snatch || cleanAndJerk < stage.cleanAndJerk || total < stage.total)?.stage ?? MILESTONES.at(-1).stage;
}

function renderProgress() {
  const currentStage = currentMilestoneStage();
  const points = chartData(progressExerciseId, progressPeriod);
  const improvement = points.length > 1 ? points.at(-1).weight - points[0].weight : null;
  return `
    <section class="page" aria-labelledby="progress-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">Progress</p>
          <h1 id="progress-title">Progress</h1>
          <p class="page-lead">Every lift adds up. Follow your bests over time.</p>
        </div>
      </header>

      <div class="progress-controls">
        <label class="field"><span>Lift</span><select id="progress-exercise">${CHART_EXERCISE_IDS.map((id) => `<option value="${id}" ${id === progressExerciseId ? "selected" : ""}>${escapeHtml(getExercise(id).name)}</option>`).join("")}</select></label>
        <div class="period-selector" role="group" aria-label="Chart period">${[["30", "30 days"], ["90", "90 days"], ["all", "All time"]].map(([value, label]) => `<button data-action="chart-period" data-period="${value}" aria-pressed="${progressPeriod === value}">${label}</button>`).join("")}</div>
      </div>
      <div class="progress-insight"><div><span>Best in period</span><strong>${points.length ? formatNumber(points.at(-1).weight) + " kg" : "—"}</strong></div>
      <p>${improvement === null ? "Log two training dates to see your change." : `<strong>+${formatNumber(improvement)} kg</strong> since your first lift in this period`}<small>Running best of logged lifts. Misses excluded.</small></p></div>
      <div class="chart-grid focused-chart" aria-label="Lift progress chart">${renderLineChart(progressExerciseId)}</div>

      <section class="section" aria-labelledby="prs-title">
        <div class="section-header">
          <div><p class="eyebrow">Personal records</p><h2 id="prs-title">Current PRs</h2></div>
          <p>Weights in kilograms</p>
        </div>
        <details class="pr-editor" id="pr-editor" data-ui-details="pr-editor" ${getRoute().parameter === "prs" ? "open" : ""}><summary>Edit personal records</summary><form class="panel" id="pr-form">
          <div class="pr-form-grid">
            ${PR_DEFINITIONS.map(
              (definition) => `
                <label class="pr-field">
                  <span>
                    <span class="pr-field-name">${escapeHtml(definition.label)}</span>
                    <span class="pr-field-target">${definition.target ? `Target ${escapeHtml(definition.targetLabel ?? formatNumber(definition.target))} kg` : "No immediate target"}</span>
                  </span>
                  <input
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.5"
                    name="pr-${escapeHtml(definition.exerciseId)}"
                    value="${escapeHtml(state.prs[definition.exerciseId] ?? "")}"
                    aria-label="${escapeHtml(definition.label)} PR in kilograms"
                    required
                  >
                </label>
              `,
            ).join("")}
          </div>
          <div class="form-actions"><button class="button button-primary" type="submit">Save PRs</button></div>
        </form></details>
      </section>

      <section class="section" aria-labelledby="milestones-title">
        <div class="section-header">
          <div><p class="eyebrow">Long-term path</p><h2 id="milestones-title">Competition milestones</h2></div>
        </div>
        <div class="milestone-table-wrap">
          <table class="milestone-table">
            <thead><tr><th>Stage</th><th>Snatch</th><th>Clean & jerk</th><th>Total</th></tr></thead>
            <tbody>
              ${MILESTONES.map(
                (stage) => `
                  <tr class="${stage.stage === currentStage ? "is-current" : ""}">
                    <td class="milestone-stage">Stage ${stage.stage}${stage.stage === currentStage ? " · current" : ""}</td>
                    <td>${stage.snatch} kg</td><td>${stage.cleanAndJerk} kg</td><td>${stage.total} kg</td>
                  </tr>
                `,
              ).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function libraryExercises() {
  return EXERCISES.filter((exercise) => exercise.videoId);
}

function renderLibraryCard(exercise) {
  const searchValue = [exercise.name, exercise.category, exercise.purpose, ...exercise.cues].join(" ").toLocaleLowerCase();
  return `
    <article class="card library-card" data-library-card data-exercise-id="${escapeHtml(exercise.id)}" data-search="${escapeHtml(searchValue)}" data-category="${escapeHtml(exercise.category)}">
      <div class="video-shell" id="video-${escapeHtml(exercise.id)}">
        <button class="video-placeholder" data-action="load-video" data-exercise-id="${escapeHtml(exercise.id)}" aria-label="Load ${escapeHtml(exercise.name)} video">
          <span>
            <span class="play-mark" aria-hidden="true">▶</span>
            <strong>Load demonstration</strong>
            <small>Video requires internet</small>
          </span>
        </button>
      </div>
      <div class="library-card-body">
        <div class="library-card-title"><h2>${escapeHtml(exercise.name)}</h2><span class="tag">${escapeHtml(exercise.category)}</span></div>
        <p class="library-purpose">${escapeHtml(exercise.purpose)}</p>
        <ul class="cue-list">${exercise.cues.map((cue) => `<li>${escapeHtml(cue)}</li>`).join("")}</ul>
        <div class="library-links">
          <a href="https://www.youtube.com/watch?v=${encodeURIComponent(exercise.videoId)}" target="_blank" rel="noopener noreferrer">Open on YouTube<span class="visually-hidden"> (opens in a new tab)</span></a>
          ${exercise.sourceUrl ? `<a href="${escapeHtml(exercise.sourceUrl)}" target="_blank" rel="noopener noreferrer">Catalyst exercise notes<span class="visually-hidden"> (opens in a new tab)</span></a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderLibrary(selectedExerciseId = "") {
  const selected = libraryExercises().find((exercise) => exercise.id === selectedExerciseId);
  const initialSearch = selected?.name ?? "";
  const categories = [...new Set(libraryExercises().map((exercise) => exercise.category))].sort();

  return `
    <section class="page" aria-labelledby="library-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">Exercise library</p>
          <h1 id="library-title">Exercises</h1>
          <p class="page-lead">Find a lift. Refine your technique.</p>
        </div>
      </header>

      <div class="card library-controls">
        <label class="field">
          <span>Search exercises or cues</span>
          <input id="library-search" type="search" value="${escapeHtml(initialSearch)}" placeholder="Try “lockout” or “snatch”" autocomplete="off">
        </label>
        <label class="field">
          <span>Category</span>
          <select id="library-category"><option value="">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select>
        </label>
      </div>
      <p class="filter-result-count" id="library-count" role="status">${libraryExercises().length} exercises</p>

      <div class="library-grid" id="library-grid">
        ${libraryExercises().map(renderLibraryCard).join("")}
      </div>
      <div class="empty-state" id="library-empty" hidden><h2>No matching exercises</h2><p>Try a broader exercise name, purpose or cue.</p></div>
    </section>
  `;
}

function renderData() {
  const backupSize = new Blob([JSON.stringify(createBackup(state))]).size;
  return `
    <section class="page" aria-labelledby="data-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">Data & profile</p>
          <h1 id="data-title">Profile & backups</h1>
          <p class="page-lead">Everything is stored in this browser on this device. Export a backup regularly—especially before clearing Safari website data or changing phones.</p>
        </div>
      </header>

      <div class="data-grid">
        <section class="card data-card" aria-labelledby="profile-title">
          <p class="eyebrow">Athlete</p>
          <h2 id="profile-title">Profile</h2>
          <form id="profile-form">
            <div class="profile-grid">
              <label class="field"><span>Bodyweight (kg)</span><input type="number" inputmode="decimal" min="0" step="0.1" name="bodyweight" value="${escapeHtml(state.profile.bodyweight)}" required></label>
              <label class="field"><span>Age</span><input type="number" inputmode="numeric" min="0" step="1" name="age" value="${escapeHtml(state.profile.age)}" required></label>
            </div>
            <div class="form-actions"><button class="button button-primary" type="submit">Save profile</button></div>
          </form>
        </section>

        <section class="card data-card" aria-labelledby="export-title">
          <p class="eyebrow">Backup</p>
          <h2 id="export-title">Export all data</h2>
          <p>Download a readable JSON file containing your profile, PRs, sessions, active draft and program reference.</p>
          <p class="storage-note"><strong>${state.sessions.length}</strong> saved ${state.sessions.length === 1 ? "session" : "sessions"} · backup about ${Math.max(1, Math.round(backupSize / 1024))} KB · schema v${APP_META.dataSchemaVersion}</p>
          <button class="button button-primary" data-action="export-data">Download JSON backup</button>
        </section>

        <section class="card data-card" aria-labelledby="import-title">
          <p class="eyebrow">Restore</p>
          <h2 id="import-title">Import a backup</h2>
          <p>A valid Lift Journal JSON backup replaces the data currently held on this device. You will see a confirmation first.</p>
          <label class="field file-field"><span>Choose JSON backup</span><input id="import-file" type="file" accept="application/json,.json"></label>
        </section>

        <aside class="card data-card" aria-labelledby="storage-title">
          <p class="eyebrow">Local-first</p>
          <h2 id="storage-title">Storage status</h2>
          <p class="privacy-note"><strong>No account and no server:</strong> training data never leaves the device unless you export it or open an external video.</p>
          <p>Last local update: <strong>${escapeHtml(formatDateTime(state.updatedAt))}</strong></p>
          <p>Active program: <strong>${escapeHtml(PROGRAM_DEFINITION.name)}</strong><br>Revision: ${escapeHtml(PROGRAM_DEFINITION.revision)}</p>
        </aside>
      </div>
    </section>
  `;
}

function render({ focus = false } = {}) {
  const { route, parameter } = getRoute();
  const routeChanged = route !== lastRenderedRoute;
  updateNavigation(route);
  document.title = `${routeTitle(route)} · ${APP_META.name}`;

  const views = {
    dashboard: renderDashboard,
    workout: renderWorkout,
    history: renderHistory,
    progress: renderProgress,
    library: () => renderLibrary(parameter),
    data: renderData,
  };

  const opened = routeChanged ? [] : [...main.querySelectorAll("details[data-ui-details][open]")].map((item) => item.dataset.uiDetails);
  const focused = document.activeElement;
  const focusSelector = !routeChanged && focused?.matches("[data-action]")
    ? Object.entries(focused.dataset).map(([key, value]) => `[data-${key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase())}="${CSS.escape(value)}"]`).join("")
    : !routeChanged && focused?.id ? "#" + CSS.escape(focused.id) : "";
  main.innerHTML = views[route]();
  document.body.classList.toggle("is-training", route === "workout" && Boolean(state.activeWorkout));
  for (const key of opened) {
    const details = main.querySelector(`details[data-ui-details="${CSS.escape(key)}"]`);
    if (details) details.open = true;
  }
  if (!focus && focusSelector) main.querySelector(focusSelector)?.focus({ preventScroll: true });
  lastRenderedRoute = route;

  if (route === "library" && parameter) {
    window.requestAnimationFrame(() => {
      filterLibrary();
      document.querySelector(`[data-library-card][data-exercise-id="${CSS.escape(parameter)}"]`)?.scrollIntoView({ block: "start" });
    });
  }

  if (route === "workout" && state.activeWorkout?.focusedExerciseId) {
    const focusedId = state.activeWorkout.focusedExerciseId;
    delete state.activeWorkout.focusedExerciseId;
    persist();
    window.requestAnimationFrame(() => document.querySelector(`#exercise-${CSS.escape(focusedId)}`)?.scrollIntoView({ block: "center" }));
  }

  if (focus || routeChanged) {
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  if (route === "progress" && parameter === "prs" && (focus || routeChanged)) {
    window.requestAnimationFrame(() => {
      document.querySelector("#pr-editor")?.scrollIntoView({ block: "start", behavior: "instant" });
      document.querySelector("#pr-form input")?.focus({ preventScroll: true });
    });
  }
  if (route === "history" && parameter && (focus || routeChanged)) {
    window.requestAnimationFrame(() => document.querySelector(`details[data-session-id="${CSS.escape(parameter)}"]`)?.scrollIntoView({ block: "start" }));
  }
}

function filterLibrary() {
  const search = document.querySelector("#library-search")?.value.trim().toLocaleLowerCase() ?? "";
  const category = document.querySelector("#library-category")?.value ?? "";
  let count = 0;

  document.querySelectorAll("[data-library-card]").forEach((card) => {
    const visible = (!search || card.dataset.search.includes(search)) && (!category || card.dataset.category === category);
    card.hidden = !visible;
    if (visible) count += 1;
  });

  const countLabel = document.querySelector("#library-count");
  if (countLabel) countLabel.textContent = `${count} ${count === 1 ? "exercise" : "exercises"}`;
  const empty = document.querySelector("#library-empty");
  if (empty) empty.hidden = count !== 0;
}

function loadExerciseVideo(exerciseId) {
  const exercise = getExercise(exerciseId);
  const shell = document.querySelector(`#video-${CSS.escape(exerciseId)}`);
  if (!shell || !exercise.videoId) return;
  if (!navigator.onLine) {
    showToast("Technique videos need an internet connection.", { error: true });
    return;
  }

  shell.innerHTML = `
    <iframe
      src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(exercise.videoId)}?rel=0&playsinline=1"
      title="${escapeHtml(exercise.name)} demonstration by Catalyst Athletics"
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
    ></iframe>
  `;
}

function downloadBackup() {
  const backup = createBackup(state);
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lift-journal-backup-${localIsoDate()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Backup downloaded");
}

async function importBackup(file) {
  if (!file) return;
  try {
    const imported = parseBackup(await file.text());
    requestConfirmation({
      title: "Replace local training data?",
      message: `${file.name} contains ${imported.sessions.length} ${imported.sessions.length === 1 ? "session" : "sessions"}. Importing it will replace the ${state.sessions.length} currently saved on this device.`,
      confirmLabel: "Import backup",
      onConfirm: () => {
        try {
          state = replaceState(imported);
          upgradeActiveProgram();
          showToast("Backup imported");
          render({ focus: true });
        } catch (error) {
          showToast(error.message, { error: true, duration: 6000 });
        }
      },
    });
  } catch (error) {
    showToast(error.message, { error: true, duration: 6000 });
  } finally {
    const input = document.querySelector("#import-file");
    if (input) input.value = "";
  }
}

function handleAction(actionElement) {
  const { action, dayId, entryId, setId, sessionId, exerciseId } = actionElement.dataset;

  switch (action) {
    case "choose-solo":
      selectedTrainingDate = localIsoDate();
      programFilter = "solo";
      navigate("workout");
      break;
    case "filter-programs":
      programFilter = ["all", "solo", "coached"].includes(actionElement.dataset.filter) ? actionElement.dataset.filter : "all";
      render();
      break;
    case "training-today":
      selectedTrainingDate = localIsoDate();
      render();
      break;
    case "select-day":
      selectedDayId = dayId;
      render();
      break;
    case "select-exercise":
      if (!state.activeWorkout) break;
      state.activeWorkout.activeExerciseId = entryId;
      persist();
      render();
      break;
    case "strong-sets": {
      const entry = findDraftEntry(entryId);
      if (!entry) break;
      entry.strongSets = !entry.strongSets;
      persist();
      render();
      break;
    }
    case "complete-exercise": {
      const entry = findDraftEntry(entryId);
      if (!entry) break;
      const remaining = entry.sets.filter(set => !isValidLoggedSet(set)).length;
      if (remaining) {
        showToast(`Log the result of ${remaining} remaining ${remaining === 1 ? "set" : "sets"} first, or finish the workout to save partial work.`, { error: true });
        break;
      }
      entry.completed = true;
      const exercises = state.activeWorkout.exercises;
      const index = exercises.indexOf(entry);
      const next = exercises.slice(index + 1).find((item) => !item.completed) ?? exercises.find((item) => !item.completed);
      if (next) state.activeWorkout.activeExerciseId = next.id;
      persist();
      render();
      window.requestAnimationFrame(() => {
        const heading = document.querySelector(".exercise-log-card.is-active .exercise-heading");
        heading?.focus({ preventScroll: true });
        heading?.scrollIntoView({ block: "start", behavior: "instant" });
      });
      showToast(next ? `Next: ${getExercise(next.exerciseId).name}` : "Exercises complete. Ready to finish.");
      break;
    }
    case "reopen-exercise": {
      const entry = findDraftEntry(entryId);
      if (!entry) break;
      entry.completed = false;
      persist();
      render();
      break;
    }
    case "adjust-weight":
    case "copy-set":
    case "set-result":
    case "log-set": {
      const entry = findDraftEntry(entryId);
      const set = entry?.sets?.find((item) => item.id === setId);
      if (!set) break;
      if (action === "adjust-weight") updatePendingSets(entry, setId, "weight", String(Math.max(0, wholeKilograms(set.weight) + Number(actionElement.dataset.delta))));
      if (action === "copy-set") {
        const previous = entry.sets[entry.sets.indexOf(set) - 1];
        if (!previous) break;
        updatePendingSets(entry, setId, "weight", previous.weight);
        updatePendingSets(entry, setId, "reps", previous.reps);
      }
      if (action === "set-result" || action === "log-set") {
        const result = action === "set-result" ? actionElement.dataset.result : "success";
        if (!isValidLoggedSet({ ...set, logged: true, result })) {
          showToast(result === "miss" ? "Enter a valid weight and rep count (0 or more) first." : "Enter a valid weight and at least one rep first.", { error: true });
          break;
        }
        if (action === "set-result") {
          set.result = set.result === actionElement.dataset.result ? "" : actionElement.dataset.result;
          set.logged = Boolean(set.result);
        } else set.logged = !set.logged;
        if (!isLoggedSet(set)) { entry.completed = false; entry.strongSets = false; }
      }
      set.touched = true;
      persist();
      render();
      break;
    }
    case "chart-period":
      progressPeriod = actionElement.dataset.period;
      render();
      break;
    case "technique": {
      const exercise = getExercise(exerciseId);
      document.querySelector("#technique-title").textContent = exercise.name;
      document.querySelector("#technique-content").innerHTML = renderLibraryCard(exercise);
      techniqueDialog.showModal();
      break;
    }
    case "start-day":
      startProgramDay(dayId, actionElement.dataset.trainingDate || localIsoDate());
      break;
    case "start-open-workout":
      startOpenWorkout(actionElement.dataset.trainingDate || localIsoDate());
      break;
    case "add-set": {
      const entry = findDraftEntry(entryId);
      if (!entry) break;
      const previous = entry.sets.at(-1) ?? {};
      entry.sets.push(createSet(previous.weight ?? "", previous.reps ?? 1));
      entry.completed = false;
      entry.strongSets = false;
      persist();
      render({ focus: false });
      window.requestAnimationFrame(() => document.querySelector(`#exercise-${CSS.escape(entryId)} .set-row:last-of-type input`)?.focus());
      break;
    }
    case "remove-set": {
      const entry = findDraftEntry(entryId);
      if (!entry || entry.sets.length <= 1) break;
      entry.sets = entry.sets.filter((set) => set.id !== setId);
      entry.completed = false;
      entry.strongSets = false;
      persist();
      render({ focus: false });
      break;
    }
    case "add-exercise": {
      const select = document.querySelector("#add-exercise-select");
      if (!select || !state.activeWorkout) break;
      const selectedExercise = getExercise(select.value);
      state.activeWorkout.exercises.push({
        id: makeId("entry"),
        exerciseId: selectedExercise.id,
        loggingVersion: PROGRESSION_VERSION,
        completed: false,
        athleteNotes: "",
        coachCue: "",
        prescribed: {
          sets: { min: 1, max: 10, default: 3 },
          reps: "Open",
          recommendation: "Self-selected",
          notes: "",
          priority: state.activeWorkout.exercises.length + 1,
          optional: false,
          videoRef: selectedExercise.videoId ? selectedExercise.id : null,
        },
        sets: [createSet("", 1), createSet("", 1), createSet("", 1)],
      });
      const added = state.activeWorkout.exercises.at(-1);
      state.activeWorkout.activeExerciseId = added.id;
      persist();
      render({ focus: false });
      window.requestAnimationFrame(() => document.querySelector(`#exercise-${CSS.escape(added.id)}`)?.scrollIntoView({ block: "center" }));
      break;
    }
    case "abandon-workout": {
      const isEditing = Boolean(state.activeWorkout?.editingSessionId);
      requestConfirmation({
        title: isEditing ? "Cancel this edit?" : "Discard this workout?",
        message: isEditing
          ? "Your original saved session will remain unchanged. Edits in this draft will be lost."
          : "This removes the in-progress draft and its entered sets from this device.",
        confirmLabel: isEditing ? "Cancel edit" : "Discard workout",
        onConfirm: () => {
          state.activeWorkout = null;
          persist();
          render({ focus: true });
          showToast(isEditing ? "Edit cancelled" : "Workout discarded");
        },
      });
      break;
    }
    case "finish-workout":
      requestFinishWorkout();
      break;
    case "edit-session":
      editSession(sessionId, entryId);
      break;
    case "delete-entry": {
      const session = state.sessions.find((item) => item.id === sessionId);
      const entry = session?.exercises?.find((item) => item.id === entryId);
      if (!session || !entry) break;
      requestConfirmation({
        title: `Delete ${getExercise(entry.exerciseId).name}?`,
        message: "This removes the exercise and all of its sets from the saved session.",
        confirmLabel: "Delete entry",
        onConfirm: () => {
          session.exercises = session.exercises.filter((item) => item.id !== entryId);
          if (!session.exercises.length) state.sessions = state.sessions.filter((item) => item.id !== sessionId);
          persist();
          render({ focus: false });
          showToast("History entry deleted");
        },
      });
      break;
    }
    case "delete-session": {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) break;
      requestConfirmation({
        title: "Delete this session?",
        message: `${formatDate(session.date)} · ${session.title || "Training session"} and all of its sets will be removed from this device.`,
        confirmLabel: "Delete session",
        onConfirm: () => {
          state.sessions = state.sessions.filter((item) => item.id !== sessionId);
          persist();
          render({ focus: false });
          showToast("Session deleted");
        },
      });
      break;
    }
    case "clear-history-filters":
      historyFilters.exerciseId = "";
      historyFilters.dateFrom = "";
      historyFilters.dateTo = "";
      render({ focus: false });
      break;
    case "load-video":
      loadExerciseVideo(exerciseId);
      break;
    case "export-data":
      downloadBackup();
      break;
    case "dismiss-install":
      state.preferences.installHintDismissed = true;
      persist();
      document.querySelector(".install-card")?.remove();
      break;
    case "install-app":
      deferredInstallPrompt?.prompt();
      break;
    default:
      break;
  }
}

main.addEventListener("click", (event) => {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  if (actionElement.matches("input, select, textarea")) return;
  event.preventDefault();
  handleAction(actionElement);
});

main.addEventListener("toggle", (event) => {
  if (event.target.id === "history-filters") historyFiltersOpen = event.target.open;
}, true);

techniqueDialog.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) handleAction(button);
});
techniqueDialog.addEventListener("close", () => {
  document.querySelector("#technique-content").replaceChildren();
});

main.addEventListener("input", (event) => {
  const target = event.target;

  if (target.id === "library-search") {
    filterLibrary();
    return;
  }

  if (target.matches("[data-draft-set-field]")) {
    const entry = findDraftEntry(target.dataset.entryId);
    const set = entry?.sets?.find((item) => item.id === target.dataset.setId);
    if (!set) return;
    const field = target.dataset.draftSetField;
    if (entry.loggingVersion === PROGRESSION_VERSION) {
      const wasComplete = entry.completed;
      updatePendingSets(entry, set.id, field, target.value);
      if (wasComplete !== entry.completed) syncWorkoutCompletion(entry);
      // Update dependent controls without replacing the focused input.
      for (const row of main.querySelectorAll(`#exercise-${CSS.escape(entry.id)} .set-row`)) {
        const item = entry.sets.find(candidate => candidate.id === row.dataset.setRow);
        if (!item) continue;
        const input = row.querySelector(`[data-draft-set-field="${field}"]`);
        if (input && input !== target) input.value = item[field];
        row.querySelectorAll("[data-result]").forEach(button => button.setAttribute("aria-pressed", String(item.result === button.dataset.result)));
        const log = row.querySelector('[data-action="log-set"]');
        if (log) { log.setAttribute("aria-pressed", String(Boolean(item.logged))); log.textContent = item.logged ? "✓ Done" : "Log set"; }
        row.classList.toggle("is-success", item.result === "success");
        row.classList.toggle("is-miss", item.result === "miss");
        row.classList.toggle("is-logged", Boolean(item.logged));
      }
      const strong = main.querySelector(`[data-action="strong-sets"][data-entry-id="${CSS.escape(entry.id)}"]`);
      if (strong) { strong.setAttribute("aria-pressed", String(Boolean(entry.strongSets))); strong.querySelector("span").textContent = entry.strongSets ? "✓" : "○"; }
    } else { set[field] = target.value; set.touched = true; }
    persist();
    markDraftSaved();
    return;
  }

  if (target.matches("[data-draft-entry-field]")) {
    const entry = findDraftEntry(target.dataset.entryId);
    if (!entry) return;
    entry[target.dataset.draftEntryField] = target.value;
    persist();
    markDraftSaved();
    return;
  }

  if (target.matches("[data-draft-session-field]")) {
    if (!state.activeWorkout) return;
    state.activeWorkout[target.dataset.draftSessionField] = target.value;
    persist();
    markDraftSaved();
  }
});

main.addEventListener("change", (event) => {
  const target = event.target;

  if (target.id === "training-date") {
    if (!target.validity.valid || !validTrainingDate(target.value)) {
      showToast("Choose a valid training date.", { error: true });
      target.value = selectedTrainingDate || localIsoDate();
      return;
    }
    selectedTrainingDate = target.value;
    render();
    return;
  }

  if (target.id === "workout-recovery") {
    if (!state.activeWorkout) return;
    state.activeWorkout.recovery = target.value;
    replanUntouchedExercises();
    persist();
    render();
    return;
  }
  if (target.matches('[data-draft-session-field="date"]')) {
    replanUntouchedExercises();
    persist();
    render();
    return;
  }

  if (target.id === "progress-exercise") {
    progressExerciseId = target.value;
    render();
    return;
  }

  if (target.id === "library-category") {
    filterLibrary();
    return;
  }

  if (target.id === "import-file") {
    importBackup(target.files?.[0]);
    return;
  }

  if (target.form?.id === "history-filter-form") {
    const formData = new FormData(target.form);
    historyFilters.exerciseId = String(formData.get("exerciseId") ?? "");
    historyFilters.dateFrom = String(formData.get("dateFrom") ?? "");
    historyFilters.dateTo = String(formData.get("dateTo") ?? "");
    historyFiltersOpen = true;
    render({ focus: false });
  }
});

main.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === "pr-form") {
    const formData = new FormData(form);
    for (const definition of PR_DEFINITIONS) {
      const value = Number.parseFloat(formData.get(`pr-${definition.exerciseId}`));
      if (!Number.isFinite(value) || value < 0) {
        showToast(`Enter a valid ${definition.label} PR.`, { error: true });
        return;
      }
      state.prs[definition.exerciseId] = value;
    }
    persist();
    render({ focus: false });
    showToast("PRs updated");
    return;
  }

  if (form.id === "profile-form") {
    const formData = new FormData(form);
    const bodyweight = Number.parseFloat(formData.get("bodyweight"));
    const age = Number.parseInt(formData.get("age"), 10);
    if (!Number.isFinite(bodyweight) || bodyweight <= 0 || !Number.isFinite(age) || age <= 0) {
      showToast("Enter a valid bodyweight and age.", { error: true });
      return;
    }
    state.profile.bodyweight = bodyweight;
    state.profile.age = age;
    persist();
    render({ focus: false });
    showToast("Profile updated");
  }
});

confirmDialog.addEventListener("close", () => {
  const callback = confirmCallback;
  confirmCallback = null;
  if (confirmDialog.returnValue === "confirm") callback?.();
});

prDialog.addEventListener("close", () => {
  if (prDialog.returnValue === "apply") {
    document.querySelectorAll('#pr-suggestion-list input[name="pr-candidate"]:checked').forEach((input) => {
      state.prs[input.value] = Number(input.dataset.weight);
    });
    persist();
  }
  const continuation = prDialogContinuation;
  prDialogContinuation = null;
  continuation?.();
});

function updateNetworkStatus() {
  const status = document.querySelector("#network-status");
  if (!status) return;
  const online = navigator.onLine;
  status.classList.toggle("is-offline", !online);
  status.querySelector(".status-label").textContent = online ? "Online" : "Offline";
  status.title = online ? "Online" : "Offline — saved data and the app shell remain available";
}

window.addEventListener("online", () => {
  updateNetworkStatus();
  showToast("Back online");
});
window.addEventListener("offline", () => {
  updateNetworkStatus();
  showToast("Offline mode · changes still save locally");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (getRoute().route === "dashboard") render({ focus: false });
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  state.preferences.installHintDismissed = true;
  persist();
  showToast("Lift Journal installed");
});

window.addEventListener("hashchange", () => render({ focus: true }));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      // An existing offline shell remains usable when an update cannot connect.
      registration.update().catch(() => {});
    } catch (error) {
      console.error("Service worker registration failed", error);
      showToast("Offline setup could not be completed.", { error: true, duration: 5000 });
    }
  });
}

function updateKeyboardLayout() {
  const viewport = window.visualViewport;
  document.body.classList.toggle("keyboard-open", Boolean(viewport && window.innerHeight - viewport.height > 150));
}
window.visualViewport?.addEventListener("resize", updateKeyboardLayout);

upgradeActiveProgram();
if (!window.location.hash) window.history.replaceState(null, "", "#dashboard");
updateNetworkStatus();
render({ focus: false });
