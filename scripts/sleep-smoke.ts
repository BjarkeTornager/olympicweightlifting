// Opt-in real-model check; synthetic pixels and a disposable test account only.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { sleepLoggingPrompt } from "../lib/images";
import { offsetDate, saveCheckin, formatSleepDuration } from "../lib/health";
config({ path: ".env.local", quiet: true });
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw Error("Disposable _test database required.");
if (
  process.env.AGENT_PROVIDER === "openrouter" &&
  !process.env.OPENROUTER_API_KEY
)
  process.env.OPENROUTER_API_KEY = (
    await readFile(
      join(homedir(), ".config/lift-journal/openrouter.key"),
      "utf8",
    )
  ).trim();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getPool } = await import("../lib/db"),
  { runTurn, applyProposal, athleteDate } = await import("../lib/agent/engine"),
  { readJournal, writeJournal } = await import("../lib/server"),
  { saveUserImage } = await import("../lib/user-images"),
  { listFoodPhotos } = await import("../lib/food-photos");
const userId = crypto.randomUUID(),
  pool = getPool(),
  timezone = "Europe/Copenhagen",
  date = athleteDate(timezone),
  priorDate = offsetDate(date, -1);
const render = async (lines: string[]) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#f7f5fc"/><g fill="#28324b" font-family="sans-serif" font-size="34">${lines.map((line, i) => `<text x="50" y="${90 + i * 100}">${line}</text>`).join("")}</g></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic sleep test',$1||'@example.test',true)",
  [userId],
);
try {
  const original = await readJournal(userId);
  saveCheckin(
    original.state,
    { date, waterMl: 750, bodyweight: 80, notes: "Keep my daily note" },
    date,
  );
  await writeJournal(userId, {
    state: original.state,
    revision: 0,
    mutationId: crypto.randomUUID(),
  });
  const turn = async (message: string, photoIds: string[] = []) =>
    runTurn(userId, {
      id: crypto.randomUUID(),
      revision: (await readJournal(userId)).revision,
      timezone,
      message,
      photoIds,
    });
  const typed = await turn("I slept 7 hours 47 minutes last night.");
  assert.equal(typed.proposals.length, 1, typed.reply);
  assert.equal(typed.proposals[0].checkin?.date, date);
  assert.equal(
    formatSleepDuration(typed.proposals[0].checkin!.sleepHours!),
    "7 h 47 min",
  );
  assert.equal(typed.proposals[0].checkin?.waterMl, 750);
  assert.equal(typed.proposals[0].checkin?.bodyweight, 80);
  assert.equal(typed.proposals[0].checkin?.notes, "Keep my daily note");
  assert.equal(
    (await readJournal(userId)).state.health.checkins[0].sleepHours,
    null,
  );
  await applyProposal(userId, typed.proposals[0].id);
  const savedRevision = (await readJournal(userId)).revision;
  await applyProposal(userId, typed.proposals[0].id);
  assert.equal((await readJournal(userId)).revision, savedRevision);
  console.log(
    "Passed: spoken-style hours/minutes, local last-night date, reviewed save, retry and preservation.",
  );

  const pixels = await render([
    "Apple Health - Sleep",
    `Wake-up date: ${priorDate}`,
    "TIME ASLEEP: 6 hr 38 min",
    "TIME IN BED: 8 hr 10 min",
    "7-DAY AVERAGE: 7 hr 15 min",
    "Synthetic sleep report",
  ]);
  const photo = await saveUserImage(userId, {
    id: crypto.randomUUID(),
    date,
    label: "Synthetic sleep screenshot",
    image: pixels.toString("base64"),
    autoTag: true,
  });
  assert.equal(photo.category, "sleep");
  const screenshot = await turn(sleepLoggingPrompt(true), [photo.id]);
  assert.equal(screenshot.proposals.length, 1, screenshot.reply);
  assert.equal(screenshot.proposals[0].checkin?.date, priorDate);
  assert.equal(
    formatSleepDuration(screenshot.proposals[0].checkin!.sleepHours!),
    "6 h 38 min",
  );
  assert.equal((await readJournal(userId)).state.health.checkins.length, 1);
  await applyProposal(userId, screenshot.proposals[0].id);
  assert.equal((await listFoodPhotos(userId)).length, 0);
  console.log(
    "Passed: screenshot time asleep rather than time in bed/average, screenshot date rather than upload date, Food isolation.",
  );

  const correction = await turn(
    `Correction: log 7 hours 30 minutes for ${date}, replacing my earlier sleep value. Keep my other daily values and notes.`,
  );
  assert.equal(correction.proposals.length, 1, correction.reply);
  assert.equal(correction.proposals[0].checkin?.sleepHours, 7.5);
  await applyProposal(userId, correction.proposals[0].id);
  const state = (await readJournal(userId)).state;
  assert.equal(state.health.checkins.length, 2);
  assert.equal(
    state.health.checkins.find((c) => c.date === date)?.waterMl,
    750,
  );
  assert.equal(
    state.health.checkins.find((c) => c.date === date)?.bodyweight,
    80,
  );
  assert.equal(
    state.health.checkins.find((c) => c.date === date)?.notes,
    "Keep my daily note",
  );
  assert.equal(state.nutrition.meals.length, 0);

  const unclear = await saveUserImage(userId, {
    id: crypto.randomUUID(),
    date,
    label: "Undated weekly sleep average",
    autoTag: false,
    image: (
      await render([
        "Sleep - Weekly report",
        "AVERAGE TIME ASLEEP",
        "7 hr 15 min",
        "No individual night shown",
        "Synthetic test fixture",
      ])
    ).toString("base64"),
  });
  const revision = (await readJournal(userId)).revision;
  const ambiguous = await turn(
    "Log a nightly sleep entry from this new screenshot. Its date and nightly total are not supplied elsewhere in this conversation; ask me if they are missing.",
    [unclear.id],
  );
  assert.equal(ambiguous.proposals.length, 0, ambiguous.reply);
  assert.equal((await readJournal(userId)).revision, revision);
  console.log(
    "Passed: same-date correction, no duplicate night, ambiguous weekly report requires clarification without saving.",
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
