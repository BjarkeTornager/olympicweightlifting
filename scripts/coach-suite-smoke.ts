// Explicit opt-in. Uses synthetic data and a disposable database only.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mealSchema } from "../lib/nutrition";
import { offsetDate } from "../lib/health";
config({ path: ".env.local", quiet: true });
if (
  process.env.COACH_SUITE_SMOKE !== "true" ||
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw Error(
    "Opt in with COACH_SUITE_SMOKE=true and a disposable _test database.",
  );
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
const { runTurn, applyProposal, athleteDate } =
  await import("../lib/agent/engine");
const { readJournal, writeJournal } = await import("../lib/server");
const { callModel } = await import("../lib/agent/provider");
const pool = getPool(),
  userId = crypto.randomUUID(),
  timezone = "Europe/Copenhagen",
  date = athleteDate(timezone);
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic suite test','suite-smoke-'||$1||'@example.test',true)",
  [userId],
);
const results: Record<string, unknown>[] = [];
async function ask(message: string) {
  const snapshot = await readJournal(userId),
    calls: string[] = [];
  const response = await runTurn(
    userId,
    { id: crypto.randomUUID(), revision: snapshot.revision, timezone, message },
    async (...args) => {
      const result = await callModel(...args);
      calls.push(...(result.tool_calls?.map((c) => c.function.name) ?? []));
      return result;
    },
  );
  results.push({
    message,
    calls,
    reply: response.reply,
    proposals: response.proposals.map((p) => ({
      title: p.title,
      entries: p.entries?.length,
      memory: p.memory?.text,
      plan: p.plan?.title,
    })),
  });
  return { response, calls, snapshot };
}
try {
  let initial = await readJournal(userId);
  const breakfast = mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    date: offsetDate(date, -1),
    name: "Yogurt and oats",
    type: "breakfast",
    source: "manual",
    estimated: false,
    items: [
      {
        name: "Yogurt and oats",
        portion: "200 g yogurt and 40 g oats",
        calories: 320,
        protein: 24,
        carbs: 35,
        fat: 9,
        classification: {
          foodGroups: ["dairy", "grains"],
          ingredients: [
            { name: "yogurt", evidence: "reported" },
            { name: "oats", evidence: "reported" },
          ],
        },
      },
    ],
  });
  initial.state.nutrition.meals = [breakfast];
  initial = await writeJournal(userId, {
    ...initial,
    mutationId: crypto.randomUUID(),
  });
  const multi = await ask(
    "Please log all three for today: last night I slept 7 hours 47 minutes, I ran 5 km in 30 minutes, and for lunch I ate 200 g cooked rice and 150 g cooked chicken breast, with no sauce or oil. Estimate lunch nutrition. Put everything in one review.",
  );
  assert.equal(multi.response.proposals.length, 1);
  const entries = multi.response.proposals[0].entries!;
  assert.equal(entries.length, 3);
  assert.ok(
    entries.some(
      (e) =>
        e.checkin && Math.abs(e.checkin.sleepHours! - (7 + 47 / 60)) < 0.001,
    ),
  );
  assert.ok(
    entries.some(
      (e) => e.cardio?.distanceKm === 5 && e.cardio.durationSeconds === 1800,
    ),
  );
  const meal = entries.find((e) => e.meal)?.meal;
  assert.equal(meal?.type, "lunch");
  assert.ok(meal?.estimated);
  const tags = meal!.items.flatMap((i) => i.classification?.ingredients ?? []);
  assert.ok(tags.some((t) => /rice/.test(t.name)));
  assert.ok(tags.some((t) => /chicken/.test(t.name)));
  assert.ok(!tags.some((t) => /oil|sauce/.test(t.name)));
  assert.equal((await readJournal(userId)).revision, initial.revision);
  await applyProposal(userId, multi.response.proposals[0].id);
  const repeated = await ask(
    "I had exactly the same breakfast as yesterday today. Please log it, with the same portions.",
  );
  assert.equal(repeated.response.proposals.length, 1);
  assert.deepEqual(repeated.response.proposals[0].meal?.items, breakfast.items);
  assert.deepEqual(repeated.response.proposals[0].meal?.photoIds, []);
  await applyProposal(userId, repeated.response.proposals[0].id);
  const remembered = await ask(
    "Please remember for future conversations that I prefer quick vegetarian lunches.",
  );
  assert.equal(remembered.response.proposals.length, 1);
  assert.match(
    remembered.response.proposals[0].memory?.text ?? "",
    /vegetarian/i,
  );
  assert.equal(
    (await readJournal(userId)).state.profile.coaching?.memories,
    undefined,
  );
  await applyProposal(userId, remembered.response.proposals[0].id);
  const memory = await ask(
    "What lunch preference have I approved for you to remember? I am only asking, not changing anything.",
  );
  assert.equal(memory.response.proposals.length, 0);
  assert.match(memory.response.reply, /vegetarian/i);
  const agreed = await ask(
    `I agree to try preparing one vegetarian lunch this evening. Please save that as my agreed plan and follow up when I visit from ${offsetDate(date, 1)}. I haven't done it yet.`,
  );
  assert.equal(agreed.response.proposals.length, 1);
  assert.equal(agreed.response.proposals[0].plan?.status, "active");
  assert.equal(
    agreed.response.proposals[0].plan?.followUpDate,
    offsetDate(date, 1),
  );
  if (agreed.response.proposals[0].plan?.outcome)
    assert.match(
      agreed.response.proposals[0].plan.outcome,
      /not|yet|pending|await/i,
    );
  await applyProposal(userId, agreed.response.proposals[0].id);
  const weekly = await ask(
    `Please reflect on my seven days ending ${date}. These food logs are partial, and I haven't marked any days complete. Tell me what went well, one change if there is enough evidence, and ONE optional adjustment. Don't save or change anything.`,
  );
  assert.ok(weekly.calls.includes("weekly_review"));
  assert.equal(weekly.response.proposals.length, 0);
  assert.match(
    weekly.response.reply,
    /partial|incomplete|complete (?:food )?days/i,
  );
  assert.doesNotMatch(
    weekly.response.reply,
    /calorie deficit|under.?eating|met your (calorie|nutrition)/i,
  );
  const dismissed = await ask(
    "I changed my mind about preparing the vegetarian lunch. Please dismiss that agreed plan; I haven't tried it and don't want follow-up about it.",
  );
  assert.equal(dismissed.response.proposals.length, 1);
  assert.equal(dismissed.response.proposals[0].plan?.status, "dismissed");
  await applyProposal(userId, dismissed.response.proposals[0].id);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "multi-entry review and approval",
          "sleep precision",
          "food ingredient evidence",
          "exact meal reuse",
          "explicit durable memory",
          "agreed plan approval",
          "grounded weekly reflection",
          "dismissal",
        ],
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
