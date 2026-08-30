import { writeFile } from "node:fs/promises";

const debugPort = process.env.CDP_PORT ?? "9223";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173/";
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");

if (!target) throw new Error("No headless Chrome page target is available.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
const failures = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`));
    else handler.resolve(message.result);
    return;
  }

  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    runtimeErrors.push(message.params.entry.text);
  }
});

function send(method, params = {}) {
  sequence += 1;
  socket.send(JSON.stringify({ id: sequence, method, params }));
  return new Promise((resolve, reject) => pending.set(sequence, { resolve, reject, method }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(expression, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `/tmp/lift-journal-${name}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

await Promise.all([
  send("Page.enable"),
  send("Runtime.enable"),
  send("Network.enable"),
  send("Log.enable"),
  send("Accessibility.enable"),
]);
await send("Network.setCacheDisabled", { cacheDisabled: true });

await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844,
});
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Storage.clearDataForOrigin", { origin: new URL(appUrl).origin, storageTypes: "all" });
await evaluate(`(async () => {
  localStorage.clear();
  sessionStorage.clear();
  for (const key of await caches.keys()) await caches.delete(key);
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
})()`);
await send("Page.navigate", { url: `${appUrl}?smoke=${Date.now()}#dashboard` });
await waitFor("document.querySelector('#dashboard-title') !== null");
await wait(500);
console.log("Browser: dashboard loaded");

const dashboard = await evaluate(`(() => {
  const visibleControls = [...document.querySelectorAll('button, input, select, textarea, .bottom-nav a')]
    .filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
  return {
    title: document.title,
    heading: document.querySelector('h1')?.textContent,
    metrics: document.querySelectorAll('.metric-card').length,
    trainingDays: document.querySelectorAll('.day-card').length,
    bottomNavigation: getComputedStyle(document.querySelector('.bottom-nav')).display,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    undersizedControls: visibleControls.filter((element) => element.getBoundingClientRect().height < 40).map((element) => element.outerHTML.slice(0, 80)),
    unnamedFields: [...document.querySelectorAll('input, select, textarea')].filter((element) => !element.labels?.length && !element.getAttribute('aria-label')).length
  };
})()`);

check(dashboard.title === "Home · Lift Journal", "Dashboard document title is incorrect");
check(dashboard.heading === "Train with intent.", "Dashboard heading did not render");
check(dashboard.metrics === 4, "Dashboard must show four current metrics");
check(dashboard.trainingDays === 4, "Dashboard must show four programmed days");
check(dashboard.bottomNavigation === "grid", "Mobile bottom navigation is not visible");
check(!dashboard.horizontalOverflow, "Dashboard has horizontal overflow at 390 px");
check(dashboard.undersizedControls.length === 0, `Dashboard has touch targets below 40 px: ${dashboard.undersizedControls.join(", ")}`);
check(dashboard.unnamedFields === 0, "Dashboard contains unnamed form fields");
const dashboardScreenshot = await screenshot("dashboard-mobile");

await evaluate(`document.querySelector('[data-action="start-day"][data-day-id="monday"]').click()`);
await waitFor("location.hash === '#workout' && document.querySelectorAll('.exercise-log-card').length === 5");
console.log("Browser: Monday workout started");

const initialWorkout = await evaluate(`(() => {
  const saved = JSON.parse(localStorage.getItem('lift-journal:v2'));
  return {
    cards: document.querySelectorAll('.exercise-log-card').length,
    setRows: document.querySelectorAll('.set-row').length,
    firstWeight: document.querySelector('[data-draft-set-field="weight"]')?.value,
    draftExercises: saved.activeWorkout.exercises.length,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
  };
})()`);

check(initialWorkout.cards === 5 && initialWorkout.draftExercises === 5, "Monday draft does not contain five exercises");
check(initialWorkout.setRows === 20, `Monday draft expected 20 default sets, found ${initialWorkout.setRows}`);
check(initialWorkout.firstWeight === "45", "Monday snatch did not start at 45 kg");
check(!initialWorkout.horizontalOverflow, "Workout has horizontal overflow at 390 px");

await evaluate(`(() => {
  const weight = document.querySelector('[data-draft-set-field="weight"]');
  weight.value = '52.5';
  weight.dispatchEvent(new Event('input', { bubbles: true }));
  const result = document.querySelector('[data-draft-set-field="result"]');
  result.value = 'success';
  result.dispatchEvent(new Event('input', { bubbles: true }));
  const complete = document.querySelector('[data-action="toggle-complete"]');
  complete.checked = true;
  complete.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor("document.querySelector('.exercise-log-card')?.classList.contains('is-complete')");
check(await evaluate("document.querySelectorAll('dialog[open]').length === 0"), "A modal dialog opened unexpectedly while logging a set");
await wait(250);
await evaluate("window.scrollTo({ top: 0, behavior: 'auto' })");
await wait(50);
await screenshot("workout-mobile");

await evaluate("location.hash = '#dashboard'");
await waitFor("document.querySelector('#dashboard-title') !== null");
check(await evaluate("document.querySelector('.resume-card') !== null"), "In-progress workout is not shown on the dashboard");
await evaluate("location.hash = '#workout'");
await waitFor("document.querySelector('.exercise-log-card') !== null");
check(await evaluate("document.querySelector('[data-draft-set-field=\"weight\"]')?.value === '52.5'"), "Set data did not persist across navigation");
check(await evaluate("document.querySelector('[data-action=\"toggle-complete\"]')?.checked === true"), "Exercise completion did not persist across navigation");

await evaluate("document.querySelector('[data-action=\"finish-workout\"]').click()");
await waitFor("location.hash === '#history' && document.querySelector('.history-session') !== null");
const firstHistory = await evaluate(`(() => {
  const saved = JSON.parse(localStorage.getItem('lift-journal:v2'));
  return {
    sessions: saved.sessions.length,
    draftCleared: saved.activeWorkout === null,
    text: document.querySelector('.history-session').textContent,
    entries: document.querySelectorAll('.history-entry').length
  };
})()`);
check(firstHistory.sessions === 1, "Finished workout was not added to history");
check(firstHistory.draftCleared, "Active draft was not cleared after finishing");
check(firstHistory.entries === 1, "Untouched program exercises should not be added to history");
check(firstHistory.text.includes("52.5 kg"), "Saved set weight is missing from history");
console.log("Browser: draft persistence and first saved session verified");

await evaluate("location.hash = '#workout'");
await waitFor("document.querySelector('[data-action=\"start-open-workout\"]') !== null");
await evaluate("document.querySelector('[data-action=\"start-open-workout\"]').click()");
await waitFor("document.querySelector('#add-exercise-select') !== null");
await evaluate(`(() => {
  const select = document.querySelector('#add-exercise-select');
  select.value = 'snatch';
  document.querySelector('[data-action="add-exercise"]').click();
})()`);
await waitFor("document.querySelector('.exercise-log-card') !== null");
await evaluate(`(() => {
  const weight = document.querySelector('[data-draft-set-field="weight"]');
  weight.value = '72';
  weight.dispatchEvent(new Event('input', { bubbles: true }));
  const result = document.querySelector('[data-draft-set-field="result"]');
  result.value = 'success';
  result.dispatchEvent(new Event('input', { bubbles: true }));
  const complete = document.querySelector('[data-action="toggle-complete"]');
  complete.checked = true;
  complete.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor("document.querySelector('.exercise-log-card')?.classList.contains('is-complete')");
const prBeforeFinish = await evaluate(`(() => {
  const saved = JSON.parse(localStorage.getItem('lift-journal:v2'));
  return { currentPr: saved.prs.snatch, enteredWeight: saved.activeWorkout.exercises[0].sets[0].weight, result: saved.activeWorkout.exercises[0].sets[0].result };
})()`);
console.log(`Browser: PR test prepared (${JSON.stringify(prBeforeFinish)})`);
await evaluate("document.querySelector('[data-action=\"finish-workout\"]').click()");
await wait(300);
const prDialogOpen = await evaluate("document.querySelector('#pr-dialog')?.open === true");
check(prDialogOpen, "A qualifying logged lift did not open the possible-PR dialog");
if (prDialogOpen) await evaluate("document.querySelector('#pr-dialog button[value=\"apply\"]').click()");
await waitFor("location.hash === '#history'");
check(await evaluate("JSON.parse(localStorage.getItem('lift-journal:v2')).prs.snatch === 72"), "Possible-PR confirmation did not update the snatch PR");
console.log("Browser: possible-PR flow verified");

await evaluate("location.hash = '#progress'");
await waitFor("document.querySelector('#progress-title') !== null");
check(await evaluate("document.querySelectorAll('.chart-card').length === 6"), "Progress view does not contain six charts");
check(await evaluate("document.querySelectorAll('.line-chart').length >= 1"), "Logged snatch data did not produce a chart");

await evaluate("location.hash = '#library/snatch'");
await waitFor("document.querySelector('#library-title') !== null");
const library = await evaluate(`(() => ({
  visibleCards: [...document.querySelectorAll('[data-library-card]')].filter((card) => !card.hidden).length,
  selectedVisible: document.querySelector('[data-library-card][data-exercise-id="snatch"]') ? !document.querySelector('[data-library-card][data-exercise-id="snatch"]').hidden : false,
  videoButtons: document.querySelectorAll('[data-action="load-video"]').length,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
}))()`);
check(library.visibleCards >= 1 && library.selectedVisible, "Direct exercise-library route did not reveal the selected exercise");
check(library.videoButtons >= 13, "Exercise library does not contain all required video embeds");
check(!library.horizontalOverflow, "Exercise library has horizontal overflow at 390 px");
console.log("Browser: charts and library verified");

const manifest = await evaluate(`(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  const response = await fetch(link.href);
  return { url: link.href, ok: response.ok, data: await response.json() };
})()`);
check(manifest.ok, "Browser could not fetch the web app manifest");
check(manifest.url.endsWith("/manifest.webmanifest"), "Browser did not discover the web app manifest");
check(manifest.data.display === "standalone", "Browser manifest is not configured for standalone display");
console.log("Browser: manifest discovered and parsed");

const serviceWorker = await evaluate(`(async () => {
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('service worker ready timeout')), 5000))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return {
    scope: registration.scope,
    controlled: Boolean(navigator.serviceWorker.controller),
    caches: await caches.keys()
  };
})()`);
check(serviceWorker.scope === appUrl, `Service worker scope is incorrect: ${serviceWorker.scope}`);
check(serviceWorker.controlled, "The page is not controlled by its service worker");
check(serviceWorker.caches.includes("lift-journal-shell-v2"), "App-shell cache was not created");
console.log("Browser: manifest and service worker verified");

await send("Network.emulateNetworkConditions", {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
  connectionType: "none",
});
await send("Page.navigate", { url: `${appUrl}#dashboard` });
await waitFor("document.querySelector('#dashboard-title') !== null", 7000);
check(await evaluate("document.querySelector('#dashboard-title')?.textContent === 'Train with intent.'"), "Offline navigation did not load the app shell");
check(await evaluate("JSON.parse(localStorage.getItem('lift-journal:v2')).sessions.length === 2"), "Offline reload lost local training data");
await send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
  connectionType: "wifi",
});

const accessibility = await send("Accessibility.getFullAXTree");
check(accessibility.nodes.some((node) => node.role?.value === "main"), "Accessibility tree is missing the main landmark");
check(accessibility.nodes.some((node) => node.role?.value === "navigation" && node.name?.value.includes("mobile")), "Accessibility tree is missing named mobile navigation");
check(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors.join(" | ")}`);
console.log("Browser: offline reload and accessibility tree verified");

socket.close();

if (failures.length) {
  console.error(`Browser smoke test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Browser smoke test passed: dashboard, responsive controls, workout draft persistence, history, PR detection, charts, library, manifest, service worker and offline reload.");
  console.log(`Screenshots: ${dashboardScreenshot}, /tmp/lift-journal-workout-mobile.png`);
}

setTimeout(() => process.exit(failures.length ? 1 : 0), 50);
