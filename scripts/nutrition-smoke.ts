// Explicit opt-in, synthetic content only. Never points at the production database.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
config({ path: ".env.local", quiet: true });
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw Error("A disposable _test database is required.");
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
  { runTurn, applyProposal } = await import("../lib/agent/engine"),
  { saveFoodPhoto } = await import("../lib/food-photos"),
  { readJournal } = await import("../lib/server");
const pool = getPool(),
  userId = crypto.randomUUID();
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic food test','food-smoke-'||$1||'@example.test',true)",
  [userId],
);
try {
  const text = await runTurn(userId, {
    id: crypto.randomUUID(),
    revision: 0,
    timezone: "Europe/Copenhagen",
    message:
      "Log my breakfast on 6 September 2026: two large boiled eggs, one medium banana and 200 ml whole milk. No oil or other foods. Estimate the nutrition and prepare a meal for review.",
  });
  assert.equal(
    text.proposals.length,
    1,
    `Text proposal missing: ${text.reply}`,
  );
  assert.ok(text.proposals[0].meal?.items.length);
  assert.equal((await readJournal(userId)).state.nutrition.meals.length, 0);
  await applyProposal(userId, text.proposals[0].id);
  const label = Buffer.from(
    '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="white"/><g fill="black" font-family="sans-serif" font-size="36"><text x="40" y="70">SYNTHETIC TEST YOGURT LABEL</text><text x="40" y="150">Nutrition per tub (200 g)</text><text x="40" y="230">Energy: 180 kcal</text><text x="40" y="300">Protein: 20 g</text><text x="40" y="370">Carbohydrate: 16 g</text><text x="40" y="440">Fat: 4 g</text></g></svg>',
  );
  const bytes = await sharp(label).jpeg().toBuffer();
  const photo = await saveFoodPhoto(userId, {
    id: crypto.randomUUID(),
    date: "2026-09-06",
    label: "Synthetic yogurt label",
    image: bytes.toString("base64"),
  });
  const vision = await runTurn(userId, {
    id: crypto.randomUUID(),
    revision: 1,
    timezone: "Europe/Copenhagen",
    photoIds: [photo.id],
    message:
      "I ate exactly one whole 200 g tub of the yogurt shown in this label for a snack on 6 September 2026. Read the nutrition from the attached image, then prepare a separate meal entry. No other ingredients.",
  });
  assert.equal(
    vision.proposals.length,
    1,
    `Photo proposal missing: ${vision.reply}`,
  );
  const meal = vision.proposals[0].meal!;
  assert.ok(meal);
  assert.deepEqual(meal.photoIds, [photo.id]);
  assert.equal(meal.source, "photo");
  assert.equal(
    meal.items.reduce((n, i) => n + i.calories, 0),
    180,
  );
  assert.equal(
    meal.items.reduce((n, i) => n + i.protein, 0),
    20,
  );
  assert.equal((await readJournal(userId)).state.nutrition.meals.length, 1);
  await applyProposal(userId, vision.proposals[0].id);
  assert.equal((await readJournal(userId)).state.nutrition.meals.length, 2);
  await applyProposal(userId, vision.proposals[0].id, true);
  assert.equal((await readJournal(userId)).state.nutrition.meals.length, 1);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "real text meal estimation",
        "real image label reading",
        "private image linkage",
        "review before save",
        "saved nutrition",
        "undo",
      ],
    }),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
