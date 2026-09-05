import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

const output = process.env.E2E_OUTPUT ?? "/tmp/lift-journal-e2e-results";
await mkdir(output, { recursive: true });
const downloadDirectory = await mkdtemp(output + "/downloads-");
// Serve actual production files under a repository path, on an isolated port.
// Stopping this server proves offline reloads cannot fall back to the network.
const shellFiles = ["index.html", "styles.css", "sw.js", "manifest.webmanifest",
  "js/app.js", "js/data.js", "js/storage.js", "js/progression.js", "assets/icon.svg",
  "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png"];
const files = new Map(await Promise.all(shellFiles.map(async path => [path, await readFile(new URL("../" + path, import.meta.url))])));
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const path = pathname.startsWith("/lift-journal/") ? pathname.slice("/lift-journal/".length) || "index.html" : "";
  if (!files.has(path)) { response.writeHead(404).end(); return; }
  const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  response.end(files.get(path));
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const appUrl = "http://127.0.0.1:" + server.address().port + "/lift-journal/";
async function stopServer() {
  if (!server.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
const version = await fetch("http://127.0.0.1:" + (process.env.CDP_PORT ?? "9223") + "/json/version").then(r => r.json());
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0, sessionId, contextId;
const pending = new Map(), errors = [], screenshots = [], passed = [], downloads = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, browser = false) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(!browser && sessionId ? { sessionId } : {}) }));
  });
}
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const p = pending.get(message.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(message.id);
    if (message.error) p.reject(new Error(message.error.message));
    else p.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    errors.push(message.params.entry.text);
  } else if (message.method === "Browser.downloadWillBegin") {
    downloads.set(message.params.guid, message.params.suggestedFilename);
  } else if (message.method === "Fetch.requestPaused") {
    // Stub only third-party media, retaining the real app and iframe request.
    send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/html" }],
      body: Buffer.from("<html><body>Technique video fixture</body></html>").toString("base64"),
    }).catch(e => errors.push(e.message));
  }
});
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression, timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await wait(60);
  }
  throw new Error("Timed out: " + expression);
}
async function tap(selector) {
  await evaluate("document.querySelector(" + JSON.stringify(selector) + ")?.scrollIntoView({block:'center',behavior:'instant'})");
  await wait(200);
  const point = await evaluate("(() => { const el=document.querySelector(" + JSON.stringify(selector) + "); if(!el) throw new Error('Missing tap target'); el.scrollIntoView({block:'center',behavior:'instant'}); const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y); if(!r.width||!r.height||!(el===hit||el.contains(hit))) throw new Error('Obscured target: '+" + JSON.stringify(selector) + "); return {x,y}; })()");
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, radiusX: 1, radiusY: 1 }] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(100);
}
async function fill(selector, value) {
  await tap(selector);
  assert.ok(await evaluate("document.activeElement === document.querySelector(" + JSON.stringify(selector) + ")"), "Input did not receive focus: " + selector);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4, commands: ["selectAll"] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
  await send("Input.insertText", { text: String(value) });
  assert.equal(await evaluate("document.querySelector(" + JSON.stringify(selector) + ").value"), String(value), "Input value did not change: " + selector);
  assert.ok(await evaluate("document.activeElement === document.querySelector(" + JSON.stringify(selector) + ")"), "Editing must retain input focus: " + selector);
  await evaluate("document.activeElement.blur()");
}
async function select(selector, value) {
  await evaluate("(() => { const el=document.querySelector(" + JSON.stringify(selector) + "); el.value=" + JSON.stringify(value) + "; el.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await wait(100);
}
async function route(hash, ready) {
  await evaluate("location.hash=" + JSON.stringify(hash));
  await until("document.querySelector(" + JSON.stringify(ready) + ") !== null");
  await wait(200);
}
async function reload(ready) {
  const previous = await evaluate("performance.timeOrigin");
  await send("Page.reload", {});
  await wait(200);
  await until("performance.timeOrigin !== " + previous + " && document.querySelector(" + JSON.stringify(ready) + ") !== null");
}
async function viewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 700, screenWidth: width, screenHeight: height });
  await wait(100);
}
async function capture(name) {
  await until("document.querySelector('#toast')?.hidden !== false", 8000);
  await wait(200);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = output + "/" + name + ".png";
  await writeFile(path, Buffer.from(r.data, "base64"));
  screenshots.push(path);
}
async function saved() { return evaluate("JSON.parse(localStorage.getItem('lift-journal:v2'))"); }
async function importFile(path) {
  const root = (await send("DOM.getDocument")).root.nodeId;
  const nodeId = (await send("DOM.querySelector", { nodeId: root, selector: "#import-file" })).nodeId;
  await send("DOM.setFileInputFiles", { nodeId, files: [path] });
  await until("document.querySelector('#confirm-dialog').open");
  await tap("#confirm-action");
}
function pass(name) { passed.push(name); console.log("PASS " + name); }
const weight = '.is-active [data-draft-set-field="weight"]';
const first = '.is-active .set-row:first-of-type';
const second = '.is-active .set-row:nth-of-type(2)';
try {
  // A fresh browser context prevents tests from touching any existing user data.
  contextId = (await send("Target.createBrowserContext", {}, true)).browserContextId;
  const targetId = (await send("Target.createTarget", { url: "about:blank", browserContextId: contextId }, true)).targetId;
  sessionId = (await send("Target.attachToTarget", { targetId, flatten: true }, true)).sessionId;
  await Promise.all(["Page.enable", "Runtime.enable", "Network.enable", "Log.enable", "Accessibility.enable"].map(m => send(m)));
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, browserContextId: contextId, eventsEnabled: true }, true);
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "https://www.youtube-nocookie.com/*", resourceType: "Document" }] });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await viewport(390, 844);
  await send("Page.navigate", { url: appUrl });
  await until("document.querySelector('#dashboard-title') !== null");
  await until("Boolean(navigator.serviceWorker.controller)");
  assert.equal(await evaluate("document.querySelectorAll('.week-day').length"), 4);
  assert.equal(await evaluate("document.querySelectorAll('.metric-card').length"), 3);
  assert.ok(await evaluate("document.querySelector('.hero-action').getBoundingClientRect().bottom < innerHeight-90"));
  await capture("home-390");
  await route("#workout", "#workout-title");
  assert.equal(await evaluate("document.querySelectorAll('[data-program-day]').length"), 5);
  assert.equal(await evaluate("document.querySelector('[data-program-day=saturday] .program-targets-heading > span').textContent"), "Coach-led");
  for (const [width, height] of [[320,740],[390,844],[430,932],[768,1024],[844,390],[1440,1000]]) {
    await viewport(width, height);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Program overflow at " + width);
    assert.ok(await evaluate("[...document.querySelectorAll('.workout-picker button')].every(button => button.getBoundingClientRect().height >= 44)"));
    await capture("program-" + width + "x" + height);
  }
  await viewport(390,844);
  await route("#dashboard", "#dashboard-title");
  pass("Live program cards at six screen sizes, with coached sessions clearly distinguished");
  await tap('[data-action="select-day"][data-day-id="monday"]');
  assert.ok(await evaluate("document.querySelector('.training-hero h2').textContent.includes('Snatch + Back Squat')"));
  await tap(".hero-action");
  await until("document.querySelectorAll('.exercise-log-card').length === 5");
  assert.equal(await evaluate("document.querySelectorAll('.exercise-body:not([hidden])').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.set-row').length"), 20);
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "45");
  pass("Select training day and start workout with one expanded exercise");

  await tap(first + " .set-options > summary");
  await tap(first + ' [data-action="adjust-weight"][data-delta="2"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "47");
  await tap(first + ' [data-action="adjust-weight"][data-delta="-2"]');
  await tap(first + ' [data-action="adjust-weight"][data-delta="5"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "50");
  assert.ok(await evaluate("document.querySelector('.is-active [data-delta=\"5\"]').textContent.includes('2.5 kg / side')"));
  await tap(first + ' [data-action="adjust-weight"][data-delta="-5"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "45");
  await viewport(320, 740);
  assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Weight controls overflow on a small phone");
  assert.ok(await evaluate("[...document.querySelectorAll('.is-active .set-row:first-of-type .weight-adjust button')].every(button=>button.getBoundingClientRect().width>=44&&button.getBoundingClientRect().height>=44)"));
  await capture("whole-kg-buttons-320");
  await viewport(390, 844);
  await fill(weight, "52.5");
  await fill(first + ' [data-draft-set-field="reps"]', "2");
  await fill(first + ' [data-draft-set-field="rpe"]', "8");
  await tap(first + ' [data-result="success"]');
  await tap(second + " .set-options > summary");
  await tap(second + ' [data-action="copy-set"]');
  let state = await saved();
  assert.equal(state.activeWorkout.exercises[0].sets[1].weight, "52.5");
  assert.equal(state.activeWorkout.exercises[0].sets[1].reps, "2");
  assert.equal(state.activeWorkout.exercises[0].sets[1].result, "");
  await fill(second + ' [data-draft-set-field="weight"]', "100");
  await tap(second + ' [data-result="miss"]');
  await tap(".is-active .exercise-notes > summary");
  await fill('.is-active [data-draft-entry-field="athleteNotes"]', "Stable catch");
  await fill('.is-active [data-draft-entry-field="coachCue"]', "Stay close");
  pass("Touch/keyboard logging, weight increments, copy set, outcomes, RPE and notes");

  await tap('.is-active [data-action="technique"]');
  assert.ok(await evaluate("document.querySelector('#technique-dialog').open"));
  await tap('#technique-dialog [data-action="load-video"]');
  assert.ok(await evaluate("document.querySelector('#technique-dialog iframe').src.startsWith('https://www.youtube-nocookie.com/embed/')"));
  await tap('#technique-dialog button[value="close"]');
  assert.equal(await evaluate("document.querySelector('#technique-dialog iframe')"), null);
  assert.equal(await evaluate("location.hash"), "#workout");
  await tap('.is-active [data-action="add-set"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets.length, 7);
  await tap('.is-active .set-row:nth-of-type(7) .set-options > summary');
  await tap('.is-active .set-row:nth-of-type(7) [data-action="remove-set"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets.length, 6);
  await tap('[data-action="complete-exercise"]');
  assert.equal((await saved()).activeWorkout.exercises[0].completed, false, "Untouched presets must not be marked complete");
  await fill('.is-active .set-row:nth-of-type(3) [data-draft-set-field="weight"]', "45");
  for (let i = 3; i <= 6; i++) await tap('.is-active .set-row:nth-of-type(' + i + ') [data-result="success"]');
  await tap('[data-action="complete-exercise"]');
  state = await saved();
  assert.ok(state.activeWorkout.exercises[0].completed);
  assert.equal(state.activeWorkout.activeExerciseId, state.activeWorkout.exercises[1].id);
  await tap(".exercise-log-card:first-child .exercise-heading");
  await evaluate("document.querySelectorAll('.set-options[open],.exercise-notes[open]').forEach(el=>el.open=false);scrollTo({top:0,behavior:'instant'})");
  await capture("workout-390");
  await route("#dashboard", "#dashboard-title");
  assert.ok(await evaluate("document.querySelector('.resume-card .hero-action').getBoundingClientRect().bottom < innerHeight-90"));
  await tap(".resume-card .hero-action");
  await until("document.querySelector('.workout-page') !== null");
  await reload(".is-active");
  state = await saved();
  assert.equal(state.activeWorkout.exercises[0].sets[0].weight, "52.5");
  assert.equal(state.activeWorkout.exercises[0].sets[0].rpe, "8");
  assert.equal(state.activeWorkout.exercises[0].coachCue, "Stay close");
  assert.equal(state.activeWorkout.activeExerciseId, state.activeWorkout.exercises[0].id);
  await tap('.workout-topbar [data-action="finish-workout"]');
  await until("location.hash === '#history'");
  state = await saved();
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].exercises.length, 1);
  assert.equal(state.activeWorkout, null);
  assert.equal(state.prs.snatch, 64, "Missed 100 kg must not update PR");
  assert.equal(await evaluate("document.querySelector('.history-session').open"), false);
  await tap(".history-session > summary");
  assert.ok(await evaluate("document.querySelector('.history-session').innerText.includes('Stable catch')"));
  pass("Video overlay (media stubbed), exercise advancement, resume/reload, history and missed PR exclusion");

  await tap('.history-session-actions [data-action="edit-session"]');
  await until("document.querySelector('.workout-page') !== null");
  await fill(weight, "55");
  assert.equal(await evaluate("document.querySelector('.is-active').classList.contains('is-complete')"), false);
  assert.equal(await evaluate("document.querySelector('.workout-progress-row progress').value"), 0);
  assert.ok(await evaluate("document.querySelector('.workout-dock [data-action=\"complete-exercise\"]') !== null"));
  await tap(first + ' [data-result="success"]');
  await tap('[data-action="complete-exercise"]');
  await tap('.workout-topbar [data-action="finish-workout"]');
  await until("location.hash === '#history'");
  assert.equal((await saved()).sessions[0].exercises[0].sets[0].weight, "55");
  await route("#workout", "#workout-title");
  await tap('[data-action="start-open-workout"]');
  await select("#add-exercise-select", "snatch");
  await tap('[data-action="add-exercise"]');
  await until("document.querySelector('.is-active') !== null");
  assert.ok(await evaluate("document.querySelector('.last-session').textContent.includes('55 kg')"));
  await fill(weight, "72");
  await tap(first + ' [data-result="success"]');
  await tap('.workout-topbar [data-action="finish-workout"]');
  await until("document.querySelector('#confirm-dialog').open");
  await tap("#confirm-action");
  await until("document.querySelector('#pr-dialog').open");
  await tap('#pr-dialog button[value="apply"]');
  await until("location.hash === '#history'");
  state = await saved();
  assert.equal(state.sessions.length, 2);
  assert.equal(state.sessions[1].exercises[0].sets.length, 1, "Unlogged sets should not enter history");
  assert.equal(state.prs.snatch, 72);
  pass("History editing, last-session reference, open workout, partial sets and PR confirmation");

  await tap("#history-filters > summary");
  await select('#history-filter-form [name="exerciseId"]', "back_squat");
  assert.equal(await evaluate("document.querySelectorAll('.history-session').length"), 0);
  assert.ok(await evaluate("document.querySelector('#history-filters').open"));
  await tap('[data-action="clear-history-filters"]');
  assert.equal(await evaluate("document.querySelectorAll('.history-session').length"), 2);
  await route("#dashboard", "#dashboard-title");
  await tap('a[href="#progress/prs"]');
  await until("document.querySelector('#pr-editor')?.open");
  assert.equal(await evaluate("document.activeElement.name"), "pr-snatch");
  await fill('[name="pr-back_squat"]', "155");
  await tap('#pr-form button[type="submit"]');
  assert.equal((await saved()).prs.back_squat, 155);
  await route("#progress", "#progress-title");
  assert.equal(await evaluate("document.querySelectorAll('.chart-card').length"), 1);
  assert.ok(await evaluate("document.querySelector('.line-chart') !== null"));
  await tap('[data-action="chart-period"][data-period="30"]');
  await select("#progress-exercise", "front_squat");
  assert.ok(await evaluate("document.querySelector('.chart-empty') !== null"));
  await select("#progress-exercise", "snatch");
  await evaluate("scrollTo({top:0,behavior:'instant'})");
  await capture("progress-390");
  pass("History filters, direct PR editing, lift selection and chart controls");

  await route("#library/snatch", "#library-title");
  await fill("#library-search", "front squat");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-library-card]')).filter(el=>!el.hidden).length"), 1);
  await route("#data", "#data-title");
  await fill('#profile-form [name="bodyweight"]', "86.5");
  await tap('#profile-form button[type="submit"]');
  assert.equal((await saved()).profile.bodyweight, 86.5);
  await tap('[data-action="export-data"]');
  const start = Date.now();
  let backupFile;
  while (Date.now()-start < 5000) {
    backupFile = [...downloads.values()].find(name=>name.endsWith(".json"));
    if (backupFile && (await readdir(downloadDirectory)).includes(backupFile)) break;
    await wait(100);
  }
  assert.ok(backupFile, "JSON download missing");
  const backup = JSON.parse(await readFile(downloadDirectory+"/"+backupFile, "utf8"));
  assert.equal(backup.data.sessions.length, 2);
  await importFile(downloadDirectory+"/"+backupFile);
  assert.equal((await saved()).sessions.length, 2);
  assert.equal((await saved()).profile.bodyweight, 86.5);
  pass("Exercise search, profile editing, real JSON export/download/import");

  const progressionDates = await evaluate("(() => { const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); const before=new Date(),after=new Date();before.setDate(before.getDate()-7);after.setDate(after.getDate()+7);return [iso(before),iso(after)];})()");
  const progressionBackup = structuredClone(backup);
  const priorWorkout = progressionBackup.data.sessions[0];
  priorWorkout.date = progressionDates[0];
  priorWorkout.exercises[0].strongSets = false;
  priorWorkout.exercises[0].sets.forEach(set => { set.weight = "45"; set.reps = "1"; set.result = "success"; set.logged = true; set.rpe = ""; });
  progressionBackup.data.sessions = [priorWorkout];
  const progressionPath = output + "/progression-fixture.json";
  await writeFile(progressionPath, JSON.stringify(progressionBackup));
  await importFile(progressionPath);
  await route("#dashboard", "#dashboard-title");
  await tap('[data-action="select-day"][data-day-id="monday"]');
  assert.equal(await evaluate("document.querySelector('[data-program-targets=monday] [data-program-exercise=snatch]').dataset.targetWeight"), "47");
  await capture("program-next-loads-home-390");
  await route("#workout", "#workout-title");
  assert.equal(await evaluate("document.querySelector('[data-program-day=monday] [data-program-exercise=snatch]').dataset.targetWeight"), "47");
  await capture("program-next-loads-390");
  await tap('[data-action="start-day"][data-day-id="monday"]');
  await until("document.querySelector('.is-active') !== null");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "47");
  assert.equal(await evaluate("document.querySelector('#workout-recovery').value"), "auto");
  assert.ok(await evaluate("document.querySelector('.is-active .exercise-summary').textContent.includes('47 kg')"));
  assert.ok(await evaluate("!document.querySelector('.is-active .exercise-summary').textContent.includes('45–55')"));
  const automaticDraft = structuredClone((await saved()).activeWorkout);
  assert.equal((await saved()).activeWorkout.exercises[0].prescribed.progression.status, "increase");
  await select("#workout-recovery", "limited");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "45");
  await select("#workout-recovery", "auto");
  await evaluate("scrollTo({top:0,behavior:'instant'})");
  assert.ok(await evaluate("document.querySelector('.is-active .set-weight input').getBoundingClientRect().bottom < document.querySelector('.workout-dock').getBoundingClientRect().top"), "The first set should be visible above the phone action dock");
  await capture("automatic-progression-390");
  await tap('.is-active .progression-note > summary');
  assert.ok(await evaluate("document.querySelector('.is-active .progression-note').open"));
  assert.ok(await evaluate("document.querySelector('.is-active .progression-body').innerText.includes('automatically adds')"));
  await tap('.is-active .progression-note > summary');
  await fill(weight, "50");
  assert.ok((await saved()).activeWorkout.exercises[0].sets.every(set => set.weight === "50"));
  await select("#workout-recovery", "limited");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "50", "Readiness must not overwrite athlete edits");
  await fill(second + ' [data-draft-set-field="weight"]', "54");
  await fill(weight, "55");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[1].weight, "54");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[2].weight, "55");
  await tap(first + ' [data-result="success"]');
  await fill(weight, "47");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].result, "", "Changing a logged load must clear the old success");
  await fill(second + ' [data-draft-set-field="weight"]', "47");
  await select("#workout-recovery", "auto");
  for (let i = 1; i <= 6; i++) await tap('.is-active .set-row:nth-of-type(' + i + ') [data-result="success"]');
  await tap('.workout-topbar [data-action="finish-workout"]');
  await until("location.hash === '#history'");
  const completedProgression = await saved();
  assert.equal(completedProgression.sessions.length, 2);
  assert.ok(completedProgression.sessions[1].exercises[0].sets.every(set => set.weight === "47"));
  assert.equal(completedProgression.sessions[1].exercises[0].completed, true, "Finishing all logged work does not require a separate completion confirmation");
  await route("#workout", "#workout-title");
  assert.equal(await evaluate("document.querySelector('[data-program-day=monday] [data-program-exercise=snatch]').dataset.targetWeight"), "49");
  assert.ok(await evaluate("document.querySelector('[data-program-day=monday] .program-repeat-note').textContent.includes('same training date')"));
  await tap('[data-action="start-day"][data-day-id="monday"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "47", "Same-day repeats must not compound increases");
  await evaluate("(() => { const input=document.querySelector('[data-draft-session-field=date]');input.value=" + JSON.stringify(progressionDates[1]) + ";input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "49");
  assert.ok((await saved()).activeWorkout.exercises[0].sets.every(set => set.reps === "1"));
  await reload(".is-active");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "49");
  pass("Program previews and automatic 45 → 47 → 49 kg loads without opt-in, recovery holds, carry-forward, same-day guard and persistence");

  const upgradeBackup = structuredClone(progressionBackup);
  upgradeBackup.data.activeWorkout = automaticDraft;
  delete automaticDraft.progressionRevision;
  automaticDraft.recovery = "unknown";
  const oldEntry = automaticDraft.exercises[0];
  delete oldEntry.loggingVersion;
  for (const key of ["progression", "targetWeight", "targetSets", "targetReps"]) delete oldEntry.prescribed[key];
  oldEntry.sets.forEach(set => { set.weight = "45"; });
  const edited = automaticDraft.exercises[1].sets[0];
  edited.weight = "63"; edited.touched = true; edited.logged = true;
  automaticDraft.exercises[1].athleteNotes = "Keep my recorded load";
  const upgradePath = output + "/old-draft-fixture.json";
  await writeFile(upgradePath, JSON.stringify(upgradeBackup));
  await route("#data", "#data-title");
  await importFile(upgradePath);
  await route("#workout", ".is-active");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "47");
  assert.equal((await saved()).activeWorkout.exercises[1].sets[0].weight, "63");
  assert.equal((await saved()).activeWorkout.exercises[1].athleteNotes, "Keep my recorded load");
  assert.deepEqual((await saved()).sessions, upgradeBackup.data.sessions);
  await reload(".is-active");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "47");

  const uncappedBackup = structuredClone(progressionBackup);
  uncappedBackup.data.sessions[0].exercises[0].prescribed.targetWeight = 55;
  uncappedBackup.data.sessions[0].exercises[0].sets.forEach(set => { set.weight = "55"; });
  const uncappedPath = output + "/uncapped-program-fixture.json";
  await writeFile(uncappedPath, JSON.stringify(uncappedBackup));
  await route("#data", "#data-title");
  await importFile(uncappedPath);
  await route("#workout", "#workout-title");
  assert.equal(await evaluate("document.querySelector('[data-program-day=monday] [data-program-exercise=snatch]').dataset.targetWeight"), "57");
  await tap('[data-action="start-day"][data-day-id="monday"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "57");
  pass("Existing draft upgrade preserves logged work; program automatically progresses beyond the original fixed range");
  await route("#data", "#data-title");
  await importFile(downloadDirectory + "/" + backupFile);

  const saturdayBackup = structuredClone(progressionBackup);
  saturdayBackup.data.sessions[0].date = "2026-09-04";
  const saturdayPath = output + "/saturday-solo-fixture.json";
  await writeFile(saturdayPath, JSON.stringify(saturdayBackup));
  await importFile(saturdayPath);
  await route("#dashboard", "#dashboard-title");
  await tap('[data-action="choose-solo"]');
  await until("document.querySelector('#training-date') !== null");
  assert.equal(await evaluate("document.querySelector('[data-filter=solo]').getAttribute('aria-pressed')"), "true");
  assert.equal(await evaluate("document.querySelectorAll('[data-program-day]').length"), 4);
  assert.equal(await evaluate("document.querySelector('[data-program-day=saturday]')"), null);
  await select("#training-date", "2026-09-03");
  assert.equal(await evaluate("document.querySelector('[data-program-day=monday] [data-program-exercise=snatch]').dataset.targetWeight"), "45", "Future history cannot increase a backdated workout");
  await select("#training-date", "2026-09-05");
  assert.equal(await evaluate("document.querySelector('[data-program-day=monday] [data-program-exercise=snatch]').dataset.targetWeight"), "47");
  await tap('[data-program-day=monday] .picker-load-preview > summary');
  assert.ok(await evaluate("document.querySelector('[data-program-day=monday] .picker-load-preview').open"));
  await capture("saturday-solo-preview-390");
  await tap('[data-program-day=monday] .picker-load-preview > summary');
  await tap('[data-filter=coached]');
  assert.equal(await evaluate("document.querySelectorAll('[data-program-day]').length"), 1);
  assert.equal(await evaluate("document.querySelector('[data-program-day]').dataset.programDay"), "saturday");
  assert.equal(await evaluate("document.querySelector('#training-date').value"), "2026-09-05");
  await tap('[data-filter=solo]');
  for (const [width, height] of [[320,740],[390,844],[430,932],[768,1024],[844,390],[1440,1000]]) {
    await viewport(width, height);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Solo picker overflow at " + width);
    assert.ok(await evaluate("[...document.querySelectorAll('.training-picker-controls button,input')].every(el=>el.getBoundingClientRect().height>=44)"));
  }
  await viewport(390,844);
  await evaluate("scrollTo({top:0,behavior:'instant'})");
  await capture("choose-solo-saturday-390");
  await tap('[data-action="start-day"][data-day-id="monday"]');
  const saturdayDraft = (await saved()).activeWorkout;
  assert.equal(saturdayDraft.date, "2026-09-05");
  assert.equal(saturdayDraft.programDayId, "monday");
  assert.equal(saturdayDraft.title, "Snatch + Back Squat");
  assert.equal(saturdayDraft.exercises[0].sets[0].weight, "47");
  assert.equal(saturdayDraft.exercises[0].prescribed.progression.sourceDate, "2026-09-04");
  await reload(".is-active");
  assert.equal((await saved()).activeWorkout.date, "2026-09-05");
  for (let i = 1; i <= 6; i++) await tap('.is-active .set-row:nth-of-type(' + i + ') [data-result="success"]');
  await tap('.workout-topbar [data-action="finish-workout"]');
  await until("location.hash === '#history'");
  const savedSaturday = (await saved()).sessions.find(item => item.date === saturdayDraft.date && item.id !== saturdayBackup.data.sessions[0].id);
  assert.equal(savedSaturday.date, "2026-09-05");
  assert.equal(savedSaturday.programDayId, "monday");
  assert.ok(savedSaturday.exercises[0].sets.every(set => set.weight === "47"));
  assert.deepEqual((await saved()).sessions[0], saturdayBackup.data.sessions[0]);
  await route("#workout", "#workout-title");
  await select("#training-date", "2026-09-12");
  await tap('[data-filter=coached]');
  await tap('[data-action="start-day"][data-day-id="saturday"]');
  assert.equal((await saved()).activeWorkout.date, "2026-09-12");
  assert.equal((await saved()).activeWorkout.programDayId, "saturday");
  assert.equal((await saved()).activeWorkout.exercises[0].prescribed.progression.status, "manual");
  await route("#data", "#data-title");
  await importFile(saturdayPath);
  await route("#workout", "#workout-title");
  await select("#training-date", "2026-09-12");
  await tap('[data-action="start-open-workout"]');
  assert.equal((await saved()).activeWorkout.date, "2026-09-12");
  assert.equal((await saved()).activeWorkout.programDayId, null);
  await route("#data", "#data-title");
  await importFile(downloadDirectory + "/" + backupFile);
  await route("#workout", "#workout-title");
  await tap('[data-action="training-today"]');
  assert.equal(await evaluate("document.querySelector('#training-date').value"), await evaluate("(() => {const date=new Date();return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');})()"));
  await tap('[data-filter=all]');
  await route("#data", "#data-title");
  pass("Saturday solo selection, chosen-date loads and history, six-width picker, coached/manual and open-session dates, Today reset");

  await importFile(saturdayPath);
  const beforeAccessories = structuredClone((await saved()).sessions);
  await route("#dashboard", "#dashboard-title");
  await tap('[data-action="choose-solo"]');
  await until("document.querySelector('#training-date') !== null");
  await select("#training-date", "2026-09-05");
  assert.equal(await evaluate("document.querySelector('[data-program-day]').dataset.programDay"), "gym_accessories");
  await tap('[data-program-day=gym_accessories] .picker-load-preview > summary');
  assert.ok(await evaluate("document.querySelector('[data-program-day=gym_accessories] .program-load').textContent.includes('Choose load')"));
  assert.ok(await evaluate("document.querySelector('[data-program-day=gym_accessories]').textContent.includes('no platform')"));
  await capture("gym-accessories-preview-390");
  await tap('[data-action="start-day"][data-day-id="gym_accessories"]');
  const newGymDraft = (await saved()).activeWorkout;
  assert.equal(newGymDraft.date, "2026-09-05");
  assert.equal(newGymDraft.title, "Gym Accessories");
  assert.equal(newGymDraft.exercises.length, 5);
  assert.equal(newGymDraft.exercises[0].sets[0].weight, "");
  assert.ok(await evaluate("document.querySelector('.is-active .progression-note').textContent.includes('Choose starting weight')"));
  const gymWeights = ["40", "20", "30", "0", "0"];
  for (let index = 0; index < 5; index++) {
    const entry = (await saved()).activeWorkout.exercises[index];
    if (index) await tap('[data-action="select-exercise"][data-entry-id="' + entry.id + '"]');
    await fill(weight, gymWeights[index]);
    for (let set = 1; set <= 3; set++) await tap('.is-active .set-row:nth-of-type(' + set + ') [data-action="log-set"]');
  }
  assert.deepEqual((await saved()).activeWorkout.exercises.map(entry => entry.sets[0].reps), ["8", "8", "10", "16", "16"]);
  await tap('.workout-topbar [data-action="finish-workout"]');
  await until("location.hash === '#history'");
  const loggedGym = (await saved()).sessions.at(-1);
  assert.equal(loggedGym.programDayId, "gym_accessories");
  assert.equal(loggedGym.date, "2026-09-05");
  assert.ok(loggedGym.exercises.every(entry => entry.completed && entry.sets.length === 3));
  assert.deepEqual((await saved()).sessions.slice(0, -1), beforeAccessories);
  await route("#workout", "#workout-title");
  await select("#training-date", "2026-09-12");
  assert.equal(await evaluate("document.querySelector('[data-program-day=gym_accessories] [data-program-exercise=romanian_deadlift]').dataset.targetWeight"), "42");
  await tap('[data-action="start-day"][data-day-id="gym_accessories"]');
  assert.deepEqual((await saved()).activeWorkout.exercises.map(entry => entry.sets[0].weight), ["42", "22", "32", "0", "0"]);
  assert.equal((await saved()).activeWorkout.exercises[4].prescribed.progression.status, "manual");
  await select("#workout-recovery", "limited");
  assert.deepEqual((await saved()).activeWorkout.exercises.map(entry => entry.sets[0].weight), gymWeights);
  await select("#workout-recovery", "auto");
  await reload(".is-active");
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight, "42");
  await evaluate("document.querySelector('.is-active .exercise-heading').scrollIntoView({block:'center',behavior:'instant'})");
  await capture("gym-accessories-progressed-390");
  await route("#data", "#data-title");
  await importFile(downloadDirectory + "/" + backupFile);
  await route("#workout", "#workout-title");
  await tap('[data-action="training-today"]');
  await tap('[data-filter=all]');
  await route("#data", "#data-title");
  pass("Gym Accessories: chosen loads, all 15 sets logged, saved history, +2 kg next-session progression, bodyweight holds, recovery and reload");

  const dates = await evaluate("(() => { const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); const old=new Date();old.setDate(old.getDate()-60);return [iso(old),iso(new Date())];})()");
  const dated = structuredClone(backup);
  dated.data.sessions = dates.map((date,i)=>({id:"fixture-"+i,date,title:"Training "+i,exercises:[{id:"entry-"+i,exerciseId:"snatch",sets:[{weight:String(50+10*i),reps:"1",result:"success",touched:true}]}]}));
  const fixturePath = output+"/dated-fixture.json";
  await writeFile(fixturePath, JSON.stringify(dated));
  await importFile(fixturePath);
  await route("#progress", "#progress-title");
  await tap('[data-period="30"]');
  assert.equal(await evaluate("document.querySelectorAll('.chart-dot').length"), 1);
  await tap('[data-period="90"]');
  assert.equal(await evaluate("document.querySelectorAll('.chart-dot').length"), 2);
  assert.ok(await evaluate("document.querySelector('.progress-insight p').textContent.includes('+10 kg')"));
  pass("30/90-day date boundaries and progress calculation");

  await route("#workout", "#workout-title");
  await tap('[data-action="start-day"][data-day-id="monday"]');
  await until("document.querySelector('.workout-page') !== null");
  for (const [width,height] of [[320,740],[390,844],[430,932],[768,1024],[844,390],[1440,1000]]) {
    await viewport(width,height);
    for (const [hash,ready] of [["#dashboard","#dashboard-title"],["#workout",".workout-page"],["#history","#history-title"],["#progress","#progress-title"],["#library","#library-title"],["#data","#data-title"]]) {
      await route(hash,ready);
      const layout = await evaluate("(() => { const nav=document.querySelector(innerWidth<=700?'.bottom-nav':'.desktop-nav'); const controls=[...document.querySelectorAll('button,input,select,textarea,summary,.bottom-nav a,.profile-link')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().height);return {overflow:document.documentElement.scrollWidth>innerWidth,nav:getComputedStyle(nav).display!=='none',small:controls.filter(el=>el.getBoundingClientRect().height<43||el.getBoundingClientRect().width<43).map(el=>el.outerHTML.slice(0,100)),unnamed:controls.filter(el=>el.matches('input,select,textarea')&&!el.labels?.length&&!el.getAttribute('aria-label')).length};})()");
      assert.equal(layout.overflow,false,"Overflow: "+hash+" at "+width);
      assert.ok(layout.nav,"Navigation missing at "+width);
      assert.deepEqual(layout.small,[],"Small touch targets: "+hash+" at "+width);
      assert.equal(layout.unnamed,0,"Unnamed input: "+hash);
    }
    await route("#dashboard","#dashboard-title");
    await capture("home-"+width+"x"+height);
    await route("#workout",".workout-page");
    await capture("workout-"+width+"x"+height);
  }
  pass("Six views at 320/390/430/768/844 landscape/1440px: overflow, navigation, labels and touch heights");

  await viewport(390,844);
  await route("#workout",".workout-page");
  await send("Fetch.disable");
  await stopServer();
  await assert.rejects(fetch(appUrl), "The test server must be unreachable");
  await reload(".workout-page");
  // Chrome resets navigator overrides on a new renderer. Reapply the OS-level
  // connectivity signal separately; the server remains genuinely unreachable.
  await send("Network.overrideNetworkState",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0,connectionType:"none"});
  assert.equal(await evaluate("navigator.onLine"),false,"Browser must report offline after reload");
  await fill(weight,"57");
  await tap(first+' [data-result="success"]');
  assert.equal((await saved()).activeWorkout.exercises[0].sets[0].weight,"57");
  await tap('.is-active [data-action="technique"]');
  await tap('#technique-dialog [data-action="load-video"]');
  assert.equal(await evaluate("document.querySelector('#technique-dialog iframe')"),null);
  assert.ok(await evaluate("document.querySelector('#toast').textContent.includes('internet')"));
  await tap('#technique-dialog button[value="close"]');
  await route("#dashboard","#dashboard-title");
  assert.ok(await evaluate("document.querySelector('.resume-card') !== null"));
  await send("Network.overrideNetworkState",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:"wifi"});
  const ax=await send("Accessibility.getFullAXTree");
  assert.ok(ax.nodes.some(n=>n.role?.value==="navigation"&&n.name?.value.includes("mobile")));
  assert.ok(ax.nodes.some(n=>n.role?.value==="main"));
  assert.ok(await evaluate("(async()=> (await caches.keys()).includes('lift-journal-shell-v5'))()"));
  pass("Offline reload/logging, video fallback, draft, service worker and accessibility landmarks");

  await route("#workout",".workout-page");
  await tap(".session-details > summary");
  await tap('[data-action="abandon-workout"]');
  await tap('#confirm-dialog button[value="cancel"]');
  assert.ok((await saved()).activeWorkout);
  await tap('[data-action="abandon-workout"]');
  await tap("#confirm-action");
  assert.equal((await saved()).activeWorkout,null);
  await route("#history","#history-title");
  await tap(".history-session > summary");
  await tap('.history-session-actions [data-action="delete-session"]');
  await tap("#confirm-action");
  assert.equal((await saved()).sessions.length,1);
  pass("Cancel/confirm discard and session deletion");
  assert.deepEqual(errors,[],"Browser errors");
  await writeFile(output+"/report.json",JSON.stringify({passed,screenshots,errors},null,2));
  console.log("\nEnd-to-end suite passed. Artifacts: "+output);
} catch(error) {
  await capture("failure").catch(()=>{});
  console.error(error);
  console.error("Browser errors:",errors);
  process.exitCode=1;
} finally {
  if(contextId) await send("Target.disposeBrowserContext",{browserContextId:contextId},true).catch(()=>{});
  for(const p of pending.values()) clearTimeout(p.timer);
  socket.close();
  await stopServer();
}
