import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  APP_META,
  EXERCISES,
  PR_DEFINITIONS,
  PROGRAM_DEFINITION,
} from "../js/data.js";

const root = resolve(import.meta.dirname, "..");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function exists(relativePath) {
  try {
    await access(resolve(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function pngDimensions(relativePath) {
  const image = await readFile(resolve(root, relativePath));
  check(image.subarray(1, 4).toString() === "PNG", `${relativePath} is not a PNG file`);
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

const requiredShell = [
  "index.html",
  "styles.css",
  "js/app.js",
  "js/data.js",
  "js/storage.js",
  "js/progression.js",
  "manifest.webmanifest",
  "sw.js",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png",
];

for (const path of requiredShell) check(await exists(path), `Missing app-shell file: ${path}`);

const html = await readFile(resolve(root, "index.html"), "utf8");
const appSource = await readFile(resolve(root, "js/app.js"), "utf8");
const serviceWorker = await readFile(resolve(root, "sw.js"), "utf8");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.webmanifest"), "utf8"));

check(html.includes('name="viewport"'), "index.html is missing a viewport declaration");
check(html.includes('rel="manifest" href="./manifest.webmanifest"'), "Manifest path is not relative");
check(html.includes('rel="apple-touch-icon"'), "Apple touch icon is missing");
check(!/(?:href|src)="\/(?!\/)/.test(html), "Root-absolute asset path found in index.html");
check(!/\sstyle=/.test(html), "Inline style found in index.html; it conflicts with the CSP");
check(!/\sstyle=/.test(appSource), "Inline style found in app templates; it conflicts with the CSP");

check(manifest.start_url.startsWith("./"), "Manifest start_url must be repository-relative");
check(manifest.scope === "./", "Manifest scope must work below a GitHub Pages repository path");
check(manifest.display === "standalone", "Manifest display must be standalone");
check(Array.isArray(manifest.icons) && manifest.icons.length >= 3, "Manifest needs regular and maskable icons");

for (const icon of manifest.icons) {
  check(icon.src.startsWith("./"), `Manifest icon path is not relative: ${icon.src}`);
  check(await exists(icon.src.replace(/^\.\//, "")), `Manifest icon is missing: ${icon.src}`);
}

const iconChecks = [
  ["assets/icon-192.png", 192],
  ["assets/icon-512.png", 512],
  ["assets/icon-maskable-512.png", 512],
  ["assets/apple-touch-icon.png", 180],
];
for (const [path, expected] of iconChecks) {
  const { width, height } = await pngDimensions(path);
  check(width === expected && height === expected, `${path} must be ${expected}×${expected}, found ${width}×${height}`);
}

for (const path of requiredShell.filter((item) => item !== "sw.js")) {
  const shellReference = path === "index.html" ? '"./index.html"' : `"./${path}"`;
  check(serviceWorker.includes(shellReference), `Service worker does not precache ${path}`);
}

const exerciseIds = new Set(EXERCISES.map((exercise) => exercise.id));
check(exerciseIds.size === EXERCISES.length, "Exercise IDs must be unique");

const requiredExerciseIds = [
  "snatch",
  "power_snatch",
  "snatch_pull",
  "snatch_balance",
  "overhead_squat",
  "clean",
  "power_clean",
  "clean_pull",
  "clean_and_jerk",
  "jerk",
  "push_press",
  "back_squat",
  "front_squat",
];

for (const id of requiredExerciseIds) {
  const exercise = EXERCISES.find((item) => item.id === id);
  check(Boolean(exercise), `Required exercise is missing: ${id}`);
  check(Boolean(exercise?.videoId), `Required exercise has no video: ${id}`);
  check(Boolean(exercise?.purpose), `Required exercise has no purpose: ${id}`);
  check(exercise?.cues?.length >= 2, `Required exercise needs at least two cues: ${id}`);
}

for (const exercise of EXERCISES.filter((item) => item.videoId)) {
  check(/^[\w-]{11}$/.test(exercise.videoId), `Invalid YouTube ID for ${exercise.id}: ${exercise.videoId}`);
  check(exercise.sourceUrl?.startsWith("https://www.catalystathletics.com/"), `Missing Catalyst source for ${exercise.id}`);
}

check(PROGRAM_DEFINITION.schemaVersion === APP_META.programSchemaVersion, "Program schema versions disagree");
check(PROGRAM_DEFINITION.days.filter(day => Number.isInteger(day.weekday)).length === 4, "Program must retain the four scheduled training days");
check(PROGRAM_DEFINITION.days.some(day => day.id === "gym_accessories" && day.weekday === null), "Any-day gym accessories programme is missing");
check(new Set(PROGRAM_DEFINITION.days.map(day => day.id)).size === PROGRAM_DEFINITION.days.length, "Programme template IDs must be unique");
for (const day of PROGRAM_DEFINITION.days) {
  check(Boolean(day.id && day.name && day.title), "Program day metadata is incomplete");
  for (const item of day.exercises) {
    check(exerciseIds.has(item.exerciseId), `${day.id} references unknown exercise ${item.exerciseId}`);
    for (const field of ["sets", "reps", "recommendation", "notes", "priority"]) {
      check(item[field] !== undefined && item[field] !== null, `${day.id}/${item.exerciseId} is missing ${field}`);
    }
    check(Object.hasOwn(item, "videoRef"), `${day.id}/${item.exerciseId} is missing videoRef`);
    check(!item.videoRef || exerciseIds.has(item.videoRef), `${day.id}/${item.exerciseId} has an unknown videoRef`);
  }
}

check(PR_DEFINITIONS.length === 10, "The app must define all ten requested PR fields");

// Exercise the storage adapter without a browser. Keeping this contract tested
// makes a future IndexedDB, SQLite/WASM, or server adapter easier to introduce.
const storageItems = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storageItems.get(key) ?? null,
    setItem: (key, value) => storageItems.set(key, String(value)),
  },
};
const storage = await import("../js/storage.js");
const defaultState = storage.createDefaultState();
defaultState.sessions.push({ id: "test-session", date: "2026-08-30", exercises: [] });
const savedState = storage.saveState(defaultState);
const backup = storage.createBackup(savedState);
const restored = storage.parseBackup(JSON.stringify(backup));
check(backup.schemaVersion === APP_META.dataSchemaVersion, "Backup root schema version is incorrect");
check(restored.sessions.length === 1, "Backup round trip lost a session");
check(restored.sessions[0].id === "test-session", "Backup round trip changed session data");

const migrated = storage.parseBackup({
  schemaVersion: 1,
  bodyweight: 87,
  age: 35,
  prs: { snatch: 66 },
  sessions: [],
  activeSession: { id: "legacy-draft", exercises: [] },
});
check(migrated.schemaVersion === APP_META.dataSchemaVersion, "Version 1 data was not migrated");
check(migrated.profile.bodyweight === 87 && migrated.profile.age === 35, "Legacy profile fields were not migrated");
check(migrated.activeWorkout?.id === "legacy-draft", "Legacy active session was not migrated");

let invalidBackupRejected = false;
try {
  storage.parseBackup('{"schemaVersion":2}');
} catch {
  invalidBackupRejected = true;
}
check(invalidBackupRejected, "Invalid backups must be rejected");
delete globalThis.window;

if (failures.length) {
  console.error(`Validation failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Validated ${requiredShell.length} shell files, ${EXERCISES.length} exercises, ${PROGRAM_DEFINITION.days.length} program days and PWA metadata.`);
}
