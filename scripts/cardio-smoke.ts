// Opt-in real-model verification. Never use production records or a production database.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import sharp from "sharp";
config({ path: ".env.local", quiet: true });
if (
  process.env.CARDIO_SMOKE !== "true" ||
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw Error(
    "Explicit CARDIO_SMOKE=true and a disposable _test database are required.",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (
  process.env.AGENT_PROVIDER === "openrouter" &&
  !process.env.OPENROUTER_API_KEY
)
  process.env.OPENROUTER_API_KEY = (
    await readFile(homedir() + "/.config/lift-journal/openrouter.key", "utf8")
  ).trim();
const { providerConfig } = await import("../lib/agent/provider");
if (!providerConfig())
  throw Error("Configure the approved model provider for this opt-in check.");
const { getPool } = await import("../lib/db"),
  { runTurn, applyProposal } = await import("../lib/agent/engine"),
  { readJournal } = await import("../lib/server"),
  { saveUserImage } = await import("../lib/user-images");
const pool = getPool(),
  id = crypto.randomUUID();
let stage = "setup";
try {
  await pool.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic cardio check','cardio-smoke-'||$1||'@example.test',true)",
    [id],
  );
  stage = "text proposal";
  const text = await runTurn(id, {
    id: crypto.randomUUID(),
    revision: 0,
    timezone: "Europe/Copenhagen",
    message:
      "I ran 5 km in 28 minutes 20 seconds on 5 September 2026. My average heart rate was 145 bpm. Please log this completed run for review.",
  });
  assert.equal(text.proposals.length, 1);
  const run = text.proposals[0].cardio!;
  assert.equal(run.activity, "running");
  assert.equal(run.date, "2026-09-05");
  assert.equal(run.durationSeconds, 1700);
  assert.equal(run.distanceKm, 5);
  assert.equal(run.averageHeartRate, 145);
  assert.equal((await readJournal(id)).state.cardio.sessions.length, 0);
  await applyProposal(id, text.proposals[0].id);
  stage = "activity screenshot";
  const imageId = crypto.randomUUID();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="750"><rect width="850" height="750" fill="white"/><g fill="#182b36" font-family="Arial" font-size="36"><text x="50" y="70">CYCLING ACTIVITY — SYNTHETIC TEST</text><text x="50" y="160">Date: 6 September 2026</text><text x="50" y="250">Distance: 20.00 km</text><text x="50" y="340">Elapsed time: 1 h 00 min 30 sec</text><text x="50" y="430">Average heart rate: 135 bpm</text><text x="50" y="520">Activity energy: 450 kcal</text><text x="50" y="640">Not a meal or food record.</text></g></svg>`;
  const pixels = await sharp(Buffer.from(svg)).png().toBuffer();
  const image = await saveUserImage(id, {
    id: imageId,
    label: "Synthetic cardio report",
    date: "2026-09-06",
    autoTag: true,
    image: pixels.toString("base64"),
  });
  assert.equal(image.category, "activity");
  const screenshot = await runTurn(id, {
    id: crypto.randomUUID(),
    revision: 1,
    timezone: "Europe/Copenhagen",
    photoIds: [imageId],
    message:
      "Please log the completed activity shown in this screenshot, using the date, elapsed duration and measurements visible. Prepare it for review.",
  });
  assert.equal(screenshot.proposals.length, 1);
  const ride = screenshot.proposals[0].cardio!;
  assert.equal(ride.activity, "cycling");
  assert.equal(ride.date, "2026-09-06");
  assert.equal(ride.durationSeconds, 3630);
  assert.equal(ride.distanceKm, 20);
  assert.equal(ride.averageHeartRate, 135);
  assert.equal(ride.caloriesKcal, 450);
  assert.equal((await readJournal(id)).state.nutrition.meals.length, 0);
  await applyProposal(id, screenshot.proposals[0].id);
  stage = "cardio table";
  const summary = await runTurn(id, {
    id: crypto.randomUUID(),
    revision: 2,
    timezone: "Europe/Copenhagen",
    message:
      "Show the two cardio activities I logged on 5 and 6 September 2026 in a table, with activity, date, duration and distance. Use the visual table tool. Do not change my journal.",
  });
  assert.equal(summary.proposals.length, 0);
  const table = summary.visuals?.find((v) => v.content.kind === "table");
  assert.ok(table);
  const encoded = JSON.stringify(table.content).toLowerCase();
  assert.match(encoded, /running|run/);
  assert.match(encoded, /cycling|ride/);
  const saved = await readJournal(id);
  assert.equal(saved.revision, 2);
  assert.equal(saved.state.cardio.sessions.length, 2);
  assert.equal(saved.state.sessions.length, 0);
  assert.equal(saved.state.nutrition.meals.length, 0);
  stage = "undo";
  await applyProposal(id, screenshot.proposals[0].id, true);
  assert.equal((await readJournal(id)).state.cardio.sessions.length, 1);
  console.log(
    JSON.stringify({
      passed: true,
      model: process.env.AGENT_MODEL,
      checks: [
        "exact text proposal",
        "classified activity screenshot",
        "exact image measurements",
        "review before saving",
        "private cardio table",
        "no food or strength changes",
        "undo",
      ],
    }),
  );
} catch {
  console.error(JSON.stringify({ passed: false, stage }));
  process.exitCode = 1;
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
  await pool.end();
}
