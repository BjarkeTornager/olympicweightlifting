// Explicit operator smoke test: synthetic pixels, disposable database, no real health images.
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import assert from "node:assert/strict";
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
const { getPool } = await import("../lib/db");
const { saveUserImage, listUserImages } = await import("../lib/user-images");
const { listFoodPhotos } = await import("../lib/food-photos");
const { readJournal } = await import("../lib/server");
const userId = crypto.randomUUID(),
  pool = getPool();
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic image test',$1||'@example.test',true)",
  [userId],
);
const render = async (lines: string[], accent: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#f7f7fa"/><rect x="30" y="32" width="740" height="110" rx="20" fill="${accent}"/><g fill="#182630" font-family="sans-serif" font-size="34">${lines.map((line, i) => `<text x="55" y="${98 + i * 95}">${line}</text>`).join("")}</g><rect x="60" y="825" width="560" height="35" rx="9" fill="${accent}"/><rect x="150" y="875" width="470" height="35" rx="9" fill="${accent}"/></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
try {
  const cases = [
    {
      category: "sleep",
      label: "Dinner photo (intentionally misleading)",
      accent: "#d4c5f4",
      lines: [
        "Apple Health",
        "Sleep",
        "TIME ASLEEP",
        "7 hr 12 min",
        "6 September 2026",
        "REM 1 hr 40 min",
        "Core 4 hr 20 min",
        "Deep 1 hr 12 min",
      ],
    },
    {
      category: "food",
      label: "Health report (intentionally misleading)",
      accent: "#d1e9c7",
      lines: [
        "YOGURT NUTRITION LABEL",
        "Per tub (200 g)",
        "Energy: 180 kcal",
        "Protein: 20 g",
        "Carbohydrate: 16 g",
        "Fat: 4 g",
        "Ingredients: milk, yogurt cultures",
      ],
    },
    {
      category: "activity",
      label: "Lunch calories (intentionally misleading)",
      accent: "#b8dcf3",
      lines: [
        "Apple Fitness",
        "Outdoor Walk",
        "Workout Summary",
        "Duration: 45 minutes",
        "Active Energy: 320 kcal",
        "Distance: 4.2 km",
        "Steps: 5200",
      ],
    },
    {
      category: "other",
      label: "Unrelated upload",
      accent: "#e3e3e3",
      lines: [
        "STATIONERY RECEIPT",
        "Notebooks: 2",
        "Printer paper: 1 ream",
        "Blue pens: 3",
        "Total: 120 DKK",
        "Synthetic test document",
      ],
    },
  ];
  for (const example of cases) {
    const image = await render(example.lines, example.accent);
    const result = await saveUserImage(userId, {
      id: crypto.randomUUID(),
      date: "2026-09-06",
      label: example.label,
      image: image.toString("base64"),
      autoTag: true,
    });
    assert.equal(
      result.category,
      example.category,
      `Expected ${example.category}; got ${JSON.stringify(result.classification)} / ${result.category}`,
    );
    assert.equal(result.classification.source, "automatic");
    console.log(
      JSON.stringify({
        expected: example.category,
        category: result.category,
        tags: result.classification.tags,
      }),
    );
  }
  assert.equal((await listFoodPhotos(userId)).length, 1);
  assert.equal((await listUserImages(userId, "sleep")).length, 1);
  const state = (await readJournal(userId)).state;
  assert.equal(state.nutrition.meals.length, 0);
  assert.equal(state.health.checkins.length, 0);
  console.log(
    "Synthetic image classification and category isolation passed; no meals or health entries were created.",
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
