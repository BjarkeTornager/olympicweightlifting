// Opt-in real-provider verification using synthetic library images, never real user data.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { mealSchema } from "../lib/nutrition";
import { offsetDate } from "../lib/health";
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
const { getPool } = await import("../lib/db");
const { runTurn, athleteDate } = await import("../lib/agent/engine");
const { saveUserImage, patchUserImage } = await import("../lib/user-images");
const { readJournal, writeJournal } = await import("../lib/server");
const { callModel } = await import("../lib/agent/provider");
const pool = getPool(),
  userId = crypto.randomUUID(),
  timezone = "Europe/Copenhagen",
  date = athleteDate(timezone);
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic photo test','coach-photos-smoke-'||$1||'@example.test',true)",
  [userId],
);
try {
  const pixels = async (text: string) =>
    (
      await sharp(
        Buffer.from(
          `<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="white"/><text x="45" y="160" font-family="sans-serif" font-size="60" fill="black">${text}</text></svg>`,
        ),
      )
        .jpeg()
        .toBuffer()
    ).toString("base64");
  const food = await saveUserImage(userId, {
    id: crypto.randomUUID(),
    date: offsetDate(date, -1),
    label: "Lunch photo",
    image: await pixels("Synthetic meal photo"),
  });
  await patchUserImage(userId, food.id, {
    version: food.version,
    category: "food",
    tags: ["lunch"],
  });
  const sleep = await saveUserImage(userId, {
    id: crypto.randomUUID(),
    date,
    label: "Sleep screenshot",
    image: await pixels("Time asleep: 7 h 45 min"),
  });
  await patchUserImage(userId, sleep.id, {
    version: sleep.version,
    category: "sleep",
    tags: ["sleep report"],
  });
  const snapshot = await readJournal(userId);
  snapshot.state.nutrition.meals.push(
    mealSchema.parse({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date,
      name: "Rice bowl",
      type: "lunch",
      source: "photo",
      estimated: true,
      notes: "Synthetic fixture",
      items: [
        {
          name: "Rice and vegetables",
          portion: "One bowl",
          calories: 400,
          protein: 8,
          carbs: 80,
          fat: 5,
        },
      ],
      photoIds: [food.id],
    }),
  );
  await writeJournal(userId, { ...snapshot, mutationId: crypto.randomUUID() });
  // An old capability denial should not override the new tools and instructions.
  await pool.query(
    "INSERT INTO agent_turns(id,user_id,question,status,response) VALUES($1,$2,$3,'done',$4)",
    [
      crypto.randomUUID(),
      userId,
      "Can you show my photos?",
      JSON.stringify({
        reply:
          "I can only list catalog metadata and cannot display photos in chat.",
        proposals: [],
      }),
    ],
  );
  const calls: string[] = [];
  const shown = await runTurn(
    userId,
    {
      id: crypto.randomUUID(),
      revision: 1,
      timezone,
      message: "Show me images of what I ate today",
    },
    async (...args) => {
      assert.equal(
        args[0].some((m) => m.images?.length),
        false,
        "display must not send pixels to the provider",
      );
      const response = await callModel(...args);
      calls.push(...(response.tool_calls?.map((c) => c.function.name) ?? []));
      return response;
    },
  );
  assert.ok(calls.includes("food_journal"));
  assert.ok(calls.includes("show_images"));
  assert.equal(calls.includes("inspect_images"), false);
  const gallery = shown.visuals?.find(
    (v) => v.content.kind === "photo_gallery",
  )?.content;
  assert.equal(gallery?.kind, "photo_gallery", shown.reply);
  if (gallery?.kind === "photo_gallery")
    assert.deepEqual(gallery.imageIds, [food.id]);
  assert.equal(shown.proposals.length, 0);
  calls.length = 0;
  const read = await runTurn(
    userId,
    {
      id: crypto.randomUUID(),
      revision: 1,
      timezone,
      message:
        "Read my saved sleep screenshot for today and tell me the time asleep shown. Just explain it; don't log anything.",
    },
    async (...args) => {
      const response = await callModel(...args);
      calls.push(...(response.tool_calls?.map((c) => c.function.name) ?? []));
      return response;
    },
  );
  assert.ok(calls.includes("inspect_images"), read.reply);
  assert.match(read.reply, /7.*45/s);
  assert.equal(read.proposals.length, 0);
  assert.equal((await readJournal(userId)).revision, 1);
  assert.equal((await readJournal(userId)).state.health.checkins.length, 0);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "gallery despite earlier capability denial",
          "meal date rather than image date",
          "food gallery excludes sleep",
          "display without model pixels",
          "read existing screenshot pixels",
          "no journal mutation",
        ],
        syntheticReplies: { gallery: shown.reply, inspection: read.reply },
      },
      null,
      2,
    ),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
