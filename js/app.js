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
    if (!quiet) showToast("Saved locally");
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

function renderDashboard() {
  const total = Number(state.prs.snatch || 0) + Number(state.prs.clean_and_jerk || 0);
  const recent = [...state.sessions]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.finishedAt).localeCompare(String(a.finishedAt)))
    .slice(0, 4);
  const today = new Date().getDay();
  const active = state.activeWorkout;

  return `
    <section class="page" aria-labelledby="dashboard-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">${escapeHtml(formatDate(localIsoDate(), { weekday: "long", day: "numeric", month: "long" }))}</p>
          <h1 id="dashboard-title">Train with intent.</h1>
          <p class="page-lead">Your technique-first program, training log and progress—kept locally on this device.</p>
        </div>
        <a class="button button-secondary" href="#progress">Edit PRs</a>
      </header>

      ${startupError ? `<div class="storage-note" role="alert"><strong>Storage notice:</strong> ${escapeHtml(startupError)}</div>` : ""}

      <div class="metric-grid" aria-label="Current athlete numbers">
        ${metricCard("Snatch PR", state.prs.snatch)}
        ${metricCard("Clean & jerk PR", state.prs.clean_and_jerk)}
        ${metricCard("Current total", total)}
        ${metricCard("Bodyweight", state.profile.bodyweight)}
      </div>

      <section class="section" aria-labelledby="immediate-targets-title">
        <div class="section-header">
          <div>
            <p class="eyebrow">Immediate target</p>
            <h2 id="immediate-targets-title">70 / 105 · 175 total</h2>
          </div>
        </div>
        <div class="goal-grid">
          ${goalCard("snatch", 70)}
          ${goalCard("clean_and_jerk", 105)}
        </div>
      </section>

      ${
        active
          ? `
            <aside class="card resume-card section" aria-label="Workout in progress">
              <div>
                <p class="eyebrow">Saved workout in progress</p>
                <h2>${escapeHtml(active.title || "Open session")}</h2>
                <p>${escapeHtml(formatDate(active.date))} · ${active.exercises?.filter((entry) => entry.completed).length ?? 0} of ${active.exercises?.length ?? 0} exercises complete</p>
              </div>
              <a class="button button-primary" href="#workout">Resume workout</a>
            </aside>
          `
          : ""
      }

      <section class="section" aria-labelledby="weekly-plan-title">
        <div class="section-header">
          <div>
            <p class="eyebrow">Current program</p>
            <h2 id="weekly-plan-title">Your training week</h2>
          </div>
          <p>${escapeHtml(PROGRAM_DEFINITION.reviewWindow)} review window</p>
        </div>
        <div class="weekly-grid">
          ${PROGRAM_DEFINITION.days
            .map(
              (day) => `
                <article class="card day-card ${day.weekday === today ? "is-today" : ""}">
                  <div class="day-label-row">
                    <span class="day-label">${escapeHtml(day.name)}</span>
                    ${day.weekday === today ? '<span class="today-pill">Today</span>' : ""}
                  </div>
                  <h3>${escapeHtml(day.title)}</h3>
                  <p class="day-focus">${escapeHtml(day.focus)}</p>
                  <ol class="day-exercises">
                    ${day.exercises
                      .slice(0, 4)
                      .map((item) => `<li>${escapeHtml(getExercise(item.exerciseId).name)} · ${setsLabel(item.sets)} × ${escapeHtml(item.reps)}</li>`)
                      .join("")}
                    ${day.exercises.length > 4 ? `<li>+ ${day.exercises.length - 4} accessory</li>` : ""}
                  </ol>
                  <button class="button button-secondary button-block" data-action="start-day" data-day-id="${escapeHtml(day.id)}">
                    ${active ? "View workout" : `Start ${escapeHtml(day.name)}`}
                  </button>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="section dashboard-lower-grid" aria-label="Recent training and priorities">
        <article class="panel">
          <div class="section-header">
            <div>
              <p class="eyebrow">Training history</p>
              <h2>Recent sessions</h2>
            </div>
            <a class="text-action" href="#history">View all</a>
          </div>
          ${
            recent.length
              ? `<ul class="recent-list">
                  ${recent
                    .map(
                      (session) => `
                        <li class="recent-item">
                          <span class="recent-date">${escapeHtml(formatDate(session.date, { day: "numeric", month: "short" }))}</span>
                          <span class="recent-name">${escapeHtml(session.title || "Training session")}</span>
                          <span class="recent-meta">${escapeHtml(sessionExerciseNames(session))}</span>
                        </li>
                      `,
                    )
                    .join("")}
                </ul>`
              : '<div class="empty-state"><h3>No sessions yet</h3><p>Start a programmed day and your latest work will appear here.</p><a class="button button-primary" href="#workout">Log a workout</a></div>'
          }
        </article>

        <aside class="panel">
          <p class="eyebrow">Keep the hierarchy clear</p>
          <h2>Training priorities</h2>
          <ol class="priority-list">
            ${PROGRAM_DEFINITION.priorities.map((priority) => `<li>${escapeHtml(priority)}</li>`).join("")}
          </ol>
        </aside>
      </section>

      <section class="section" aria-label="Program guidance">
        <details class="rules-details">
          <summary>Loading rules and review criteria</summary>
          <div class="rules-body">
            <h3>Loading rules</h3>
            <ul>${PROGRAM_DEFINITION.loadingRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
            <h3 class="rules-subheading">Review after ${escapeHtml(PROGRAM_DEFINITION.reviewWindow)}</h3>
            <ul>${PROGRAM_DEFINITION.reviewCriteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join("")}</ul>
          </div>
        </details>
      </section>

      ${renderInstallCard()}
    </section>
  `;
}

function workoutSetCount(programExercise) {
  if (typeof programExercise.sets === "number") return programExercise.sets;
  return Number(programExercise.sets?.default ?? programExercise.sets?.min ?? 1);
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

function createWorkoutExercise(programExercise) {
  const count = workoutSetCount(programExercise);
  return {
    id: makeId("entry"),
    exerciseId: programExercise.exerciseId,
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
    },
    sets: Array.from({ length: count }, () => createSet(programExercise.initialWeight, programExercise.defaultReps)),
  };
}

function startProgramDay(dayId) {
  const day = getProgramDay(dayId);
  if (!day) return;

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
    date: localIsoDate(),
    startedAt: new Date().toISOString(),
    athleteNotes: "",
    coachNotes: "",
    sessionPrompt: day.sessionPrompt ?? "",
    exercises: day.exercises.map(createWorkoutExercise),
  };
  persist();
  navigate("workout");
}

function startOpenWorkout() {
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
    date: localIsoDate(),
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
  return `
    <section class="page" aria-labelledby="workout-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">Workout</p>
          <h1 id="workout-title">Choose today’s session.</h1>
          <p class="page-lead">Starting a programmed day creates a local draft. It stays here through navigation, screen locks and reloads until you finish or discard it.</p>
        </div>
      </header>

      <div class="workout-picker-grid">
        ${PROGRAM_DEFINITION.days
          .map(
            (day) => `
              <article class="card workout-picker">
                <p class="eyebrow">${escapeHtml(day.name)}</p>
                <h2>${escapeHtml(day.title)}</h2>
                <p>${escapeHtml(day.focus)}</p>
                <button class="button button-primary" data-action="start-day" data-day-id="${escapeHtml(day.id)}">Start session</button>
              </article>
            `,
          )
          .join("")}
        <article class="card workout-picker">
          <p class="eyebrow">Flexible logging</p>
          <h2>Open session</h2>
          <p>Build an unprogrammed workout one exercise at a time.</p>
          <button class="button button-secondary" data-action="start-open-workout">Start open session</button>
        </article>
      </div>
    </section>
  `;
}

function prescriptionSummary(entry) {
  const prescribed = entry.prescribed ?? {};
  const setText = setsLabel(prescribed.sets);
  const pieces = [`${setText} × ${prescribed.reps ?? "open"}`];
  if (prescribed.recommendation) pieces.push(prescribed.recommendation);
  if (prescribed.optional) pieces.push("Optional");
  return pieces.join(" · ");
}

function setFieldAttributes(entry, set, field) {
  return `data-draft-set-field="${field}" data-entry-id="${escapeHtml(entry.id)}" data-set-id="${escapeHtml(set.id)}"`;
}

function renderSetRow(entry, set, index) {
  const exercise = getExercise(entry.exerciseId);
  const resultField = exercise.tracksOutcome
    ? `
      <label class="set-outcome">
        <span>Result</span>
        <select ${setFieldAttributes(entry, set, "result")} aria-label="Set ${index + 1} result">
          <option value="" ${set.result ? "" : "selected"}>Not marked</option>
          <option value="success" ${set.result === "success" ? "selected" : ""}>Success</option>
          <option value="miss" ${set.result === "miss" ? "selected" : ""}>Miss</option>
        </select>
      </label>
    `
    : '<div class="set-outcome set-outcome-empty" aria-hidden="true">—</div>';

  return `
    <div class="set-row" data-set-row="${escapeHtml(set.id)}">
      <span class="set-number" aria-hidden="true">${index + 1}</span>
      <label>
        <span>Weight</span>
        <input
          type="number"
          inputmode="decimal"
          min="0"
          step="0.5"
          value="${escapeHtml(set.weight ?? "")}"
          placeholder="kg"
          ${setFieldAttributes(entry, set, "weight")}
          aria-label="Set ${index + 1} weight in kilograms"
        >
      </label>
      <label>
        <span>Reps</span>
        <input
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          value="${escapeHtml(set.reps ?? "")}"
          placeholder="Reps"
          ${setFieldAttributes(entry, set, "reps")}
          aria-label="Set ${index + 1} repetitions"
        >
      </label>
      <label>
        <span>RPE</span>
        <input
          type="number"
          inputmode="decimal"
          min="1"
          max="10"
          step="0.5"
          value="${escapeHtml(set.rpe ?? "")}"
          placeholder="1–10"
          ${setFieldAttributes(entry, set, "rpe")}
          aria-label="Set ${index + 1} RPE"
        >
      </label>
      ${resultField}
      <button
        class="remove-set"
        type="button"
        data-action="remove-set"
        data-entry-id="${escapeHtml(entry.id)}"
        data-set-id="${escapeHtml(set.id)}"
        aria-label="Remove set ${index + 1}"
        title="Remove set"
        ${entry.sets.length <= 1 ? "disabled" : ""}
      >×</button>
    </div>
  `;
}

function renderWorkoutExercise(entry, index) {
  const exercise = getExercise(entry.exerciseId);
  const videoLink = exercise.videoId
    ? `<a class="button button-quiet video-shortcut" href="#library/${encodeURIComponent(exercise.id)}">Watch technique video</a>`
    : "";

  return `
    <article class="exercise-log-card ${entry.completed ? "is-complete" : ""}" id="exercise-${escapeHtml(entry.id)}">
      <header class="exercise-card-header">
        <div>
          <span class="exercise-index">Exercise ${index + 1}</span>
          <h2>${escapeHtml(exercise.name)}</h2>
          <p class="exercise-prescription">${escapeHtml(prescriptionSummary(entry))}</p>
        </div>
        <label class="complete-toggle">
          <input
            type="checkbox"
            data-action="toggle-complete"
            data-entry-id="${escapeHtml(entry.id)}"
            ${entry.completed ? "checked" : ""}
          >
          <span class="complete-label">Complete</span>
          <span class="visually-hidden">Mark ${escapeHtml(exercise.name)} complete</span>
        </label>
      </header>
      ${entry.prescribed?.notes ? `<p class="prescription-note"><strong>Focus:</strong> ${escapeHtml(entry.prescribed.notes)}</p>` : ""}
      <div class="sets-area">
        <div class="sets-heading" aria-hidden="true">
          <span>Set</span><span>Weight</span><span>Reps</span><span>RPE</span><span>Result</span><span></span>
        </div>
        ${entry.sets.map((set, setIndex) => renderSetRow(entry, set, setIndex)).join("")}
        <div class="sets-footer">
          <button class="button button-secondary button-small" type="button" data-action="add-set" data-entry-id="${escapeHtml(entry.id)}">Add set</button>
          ${videoLink}
        </div>
      </div>
      <div class="exercise-notes-grid">
        <label class="field">
          <span>Athlete notes</span>
          <textarea
            rows="2"
            placeholder="How did it feel? What changed?"
            data-draft-entry-field="athleteNotes"
            data-entry-id="${escapeHtml(entry.id)}"
          >${escapeHtml(entry.athleteNotes ?? "")}</textarea>
        </label>
        <label class="field">
          <span>Coach cue</span>
          <textarea
            rows="2"
            placeholder="One concise cue from Tim"
            data-draft-entry-field="coachCue"
            data-entry-id="${escapeHtml(entry.id)}"
          >${escapeHtml(entry.coachCue ?? "")}</textarea>
        </label>
      </div>
    </article>
  `;
}

function renderWorkout() {
  const draft = state.activeWorkout;
  if (!draft) return renderWorkoutPicker();

  const exercises = draft.exercises ?? [];
  const completed = exercises.filter((entry) => entry.completed).length;
  const progress = exercises.length ? (completed / exercises.length) * 100 : 0;
  const isEditing = Boolean(draft.editingSessionId);
  const exerciseOptions = [...EXERCISES]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((exercise) => `<option value="${escapeHtml(exercise.id)}">${escapeHtml(exercise.name)}</option>`)
    .join("");

  return `
    <section class="page" aria-labelledby="active-workout-title">
      <div class="workout-topbar">
        <div>
          <div class="workout-title-row">
            <h1 id="active-workout-title">${escapeHtml(draft.title || "Training session")}</h1>
            <span class="draft-saved" id="draft-saved-status">Saved locally</span>
          </div>
          <div class="workout-progress-row">
            <progress class="progress-track" aria-label="Workout completion" max="${Math.max(1, exercises.length)}" value="${completed}">${Math.round(progress)}%</progress>
            <span>${completed} / ${exercises.length} complete</span>
          </div>
        </div>
        <div class="workout-topbar-actions">
          <button class="button button-quiet button-small" data-action="abandon-workout">${isEditing ? "Cancel edit" : "Discard"}</button>
          <button class="button button-primary button-small" data-action="finish-workout">${isEditing ? "Save changes" : "Finish"}</button>
        </div>
      </div>

      <div class="session-meta-panel">
        <label class="field">
          <span>Session date</span>
          <input type="date" value="${escapeHtml(draft.date ?? localIsoDate())}" data-draft-session-field="date">
        </label>
        <label class="field">
          <span>Session name</span>
          <input type="text" value="${escapeHtml(draft.title ?? "")}" data-draft-session-field="title" autocomplete="off">
        </label>
      </div>

      ${draft.sessionPrompt ? `<p class="coach-prompt"><strong>Coached session:</strong> ${escapeHtml(draft.sessionPrompt)}</p>` : ""}

      ${
        exercises.length
          ? `<div class="exercise-stack">${exercises.map(renderWorkoutExercise).join("")}</div>`
          : '<div class="empty-state"><h2>Add your first exercise</h2><p>This open session is already saved. Choose an exercise below to begin logging.</p></div>'
      }

      <div class="add-exercise-panel">
        <label class="field" for="add-exercise-select">
          <span>Add another exercise</span>
          <select id="add-exercise-select">${exerciseOptions}</select>
        </label>
        <button class="button button-secondary" data-action="add-exercise">Add exercise</button>
      </div>

      <div class="card session-notes-panel">
        <label class="field">
          <span>Overall athlete notes</span>
          <textarea rows="3" placeholder="Energy, recovery, session summary…" data-draft-session-field="athleteNotes">${escapeHtml(draft.athleteNotes ?? "")}</textarea>
        </label>
        <label class="field">
          <span>Overall coach notes</span>
          <textarea rows="3" placeholder="Coach feedback kept separate from your own notes…" data-draft-session-field="coachNotes">${escapeHtml(draft.coachNotes ?? "")}</textarea>
        </label>
      </div>
    </section>
  `;
}

function findDraftEntry(entryId) {
  return state.activeWorkout?.exercises?.find((entry) => entry.id === entryId) ?? null;
}

function markDraftSaved() {
  const savedStatus = document.querySelector("#draft-saved-status");
  if (!savedStatus) return;
  savedStatus.textContent = "Saved locally";
}

function setWasPerformed(entry) {
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

function finalizeWorkout() {
  const draft = state.activeWorkout;
  if (!draft) return;

  const performedExercises = (draft.exercises ?? []).filter(setWasPerformed).map((entry) => clone(entry));
  if (!performedExercises.length) {
    showToast("Mark an exercise complete or edit at least one set before finishing.", { error: true });
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
    showToast("Mark an exercise complete or edit at least one set before finishing.", { error: true });
    return;
  }

  const incomplete = performed.filter((entry) => !entry.completed).length;
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
          <h1 id="history-title">Every useful detail, kept.</h1>
          <p class="page-lead">Review completed work, technical outcomes and the cues that mattered.</p>
        </div>
        <a class="button button-primary" href="#workout">Log workout</a>
      </header>

      <form class="card history-filters" id="history-filter-form" aria-label="Filter training history">
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
                    <article class="card history-session">
                      <header class="history-session-header">
                        <time class="history-session-date" datetime="${escapeHtml(session.date)}">${escapeHtml(formatDate(session.date, { day: "numeric", month: "short", year: "numeric" }))}</time>
                        <div>
                          <h2>${escapeHtml(session.title || "Training session")}</h2>
                          <p class="history-session-summary">${entries.length} ${entries.length === 1 ? "exercise" : "exercises"} · ${entries.reduce((count, entry) => count + (entry.sets?.length ?? 0), 0)} sets</p>
                        </div>
                        <div class="history-session-actions">
                          <button class="button button-quiet button-small" data-action="edit-session" data-session-id="${escapeHtml(session.id)}">Edit session</button>
                          <button class="button button-danger-quiet button-small" data-action="delete-session" data-session-id="${escapeHtml(session.id)}">Delete session</button>
                        </div>
                      </header>
                      <ul class="history-exercises">${entries.map((entry) => renderHistoryEntry(session, entry)).join("")}</ul>
                      ${
                        session.athleteNotes || session.coachNotes
                          ? `<footer class="session-footer-notes">
                              ${session.athleteNotes ? `<span><strong>Session notes:</strong> ${escapeHtml(session.athleteNotes)}</span>` : ""}
                              ${session.coachNotes ? `<span><strong>Coach notes:</strong> ${escapeHtml(session.coachNotes)}</span>` : ""}
                            </footer>`
                          : ""
                      }
                    </article>
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

function chartData(exerciseId) {
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

  let runningBest = 0;
  return [...dailyBest.entries()]
    .sort(([dateA], [dateB]) => String(dateA).localeCompare(String(dateB)))
    .map(([date, best]) => {
      runningBest = Math.max(runningBest, best);
      return { date, weight: runningBest, sessionBest: best };
    });
}

function renderLineChart(exerciseId) {
  const exercise = getExercise(exerciseId);
  const points = chartData(exerciseId);
  const currentPr = Number(state.prs[exerciseId] ?? 0);

  if (!points.length) {
    return `
      <article class="card chart-card">
        <div class="chart-card-header"><h2>${escapeHtml(exercise.name)}</h2><span class="chart-current">PR ${formatNumber(currentPr)} kg</span></div>
        <div class="chart-empty">Log a successful weighted set<br>to begin this chart.</div>
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
        <text class="chart-axis-label" x="${x(0)}" y="${height - 7}" text-anchor="start">${escapeHtml(formatDate(points[0].date, { day: "numeric", month: "short" }))}</text>
        <text class="chart-axis-label" x="${x(points.length - 1)}" y="${height - 7}" text-anchor="end">${escapeHtml(formatDate(points.at(-1).date, { day: "numeric", month: "short" }))}</text>
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
  return `
    <section class="page" aria-labelledby="progress-title">
      <header class="page-header">
        <div class="page-header-copy">
          <p class="eyebrow">Progress</p>
          <h1 id="progress-title">See what is actually moving.</h1>
          <p class="page-lead">Charts use the running best successful weight from your saved sessions. Misses are excluded.</p>
        </div>
      </header>

      <div class="chart-grid" aria-label="Lift progress charts">
        ${CHART_EXERCISE_IDS.map(renderLineChart).join("")}
      </div>

      <section class="section" aria-labelledby="prs-title">
        <div class="section-header">
          <div><p class="eyebrow">Personal records</p><h2 id="prs-title">Current PRs</h2></div>
          <p>Weights in kilograms</p>
        </div>
        <form class="panel" id="pr-form">
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
        </form>
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
          <h1 id="library-title">A clear cue, when you need it.</h1>
          <p class="page-lead">Concise purposes and cues with Catalyst Athletics demonstrations. Videos load only when requested and naturally require an internet connection.</p>
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
          <h1 id="data-title">Your data stays yours.</h1>
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

  main.innerHTML = views[route]();
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
    window.scrollTo({ top: 0, behavior: "auto" });
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
    case "start-day":
      startProgramDay(dayId);
      break;
    case "start-open-workout":
      startOpenWorkout();
      break;
    case "add-set": {
      const entry = findDraftEntry(entryId);
      if (!entry) break;
      const previous = entry.sets.at(-1) ?? {};
      entry.sets.push(createSet(previous.weight ?? "", previous.reps ?? 1));
      persist();
      render({ focus: false });
      window.requestAnimationFrame(() => document.querySelector(`#exercise-${CSS.escape(entryId)} .set-row:last-of-type input`)?.focus());
      break;
    }
    case "remove-set": {
      const entry = findDraftEntry(entryId);
      if (!entry || entry.sets.length <= 1) break;
      entry.sets = entry.sets.filter((set) => set.id !== setId);
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
      persist();
      render({ focus: false });
      const added = state.activeWorkout.exercises.at(-1);
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
  event.preventDefault();
  handleAction(actionElement);
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
    set[target.dataset.draftSetField] = target.value;
    set.touched = true;
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

  if (target.id === "library-category") {
    filterLibrary();
    return;
  }

  if (target.id === "import-file") {
    importBackup(target.files?.[0]);
    return;
  }

  if (target.matches('[data-action="toggle-complete"]')) {
    const entry = findDraftEntry(target.dataset.entryId);
    if (!entry) return;
    entry.completed = target.checked;
    if (target.checked) entry.sets.forEach((set) => (set.touched = true));
    persist();
    render({ focus: false });
    return;
  }

  if (target.form?.id === "history-filter-form") {
    const formData = new FormData(target.form);
    historyFilters.exerciseId = String(formData.get("exerciseId") ?? "");
    historyFilters.dateFrom = String(formData.get("dateFrom") ?? "");
    historyFilters.dateTo = String(formData.get("dateTo") ?? "");
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
      registration.update();
    } catch (error) {
      console.error("Service worker registration failed", error);
      showToast("Offline setup could not be completed.", { error: true, duration: 5000 });
    }
  });
}

if (!window.location.hash) window.history.replaceState(null, "", "#dashboard");
updateNetworkStatus();
render({ focus: false });
