// Opt-in real-provider check. Uses a disposable account with synthetic data only.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
const { runTurn, athleteDate, history } = await import("../lib/agent/engine");
const { readJournal, writeJournal } = await import("../lib/server");
const { callModel } = await import("../lib/agent/provider");
const { visualSchema } = await import("../lib/coach-visuals");
const pool = getPool(),
  userId = crypto.randomUUID(),
  timezone = "Europe/Copenhagen";
await pool.query(
  "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic visual test','visual-smoke-'||$1||'@example.test',true)",
  [userId],
);
try {
  const journal = await readJournal(userId);
  const date = athleteDate(timezone);
  const days = [2, 1, 0].map((offset) => {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - offset);
    return day.toISOString().slice(0, 10);
  });
  journal.state.health.checkins = days.map((day, i) => ({
    date: day,
    sleepHours: [7, 8, 7.5][i],
    energy: [3, 4, 3][i] as 3 | 4,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "Synthetic test entry",
    updatedAt: new Date().toISOString(),
  }));
  await writeJournal(userId, { ...journal, mutationId: crypto.randomUUID() });
  const calls: string[] = [],
    eventCounts: Record<string, number> = {};
  const toolErrors: string[] = [];
  const result = await runTurn(
    userId,
    {
      id: crypto.randomUUID(),
      revision: 1,
      timezone,
      message: `Read my health overview for ${date}. Show my three logged sleep and energy entries from ${days[0]} through ${date} in a table and a bar chart of sleep hours in chronological order. Also show a simple 3-step diagram for an illustrative morning check-in routine. Please display all three visuals in chat, keep the explanation brief and do not change my journal.`,
    },
    async (...args) => {
      for (const message of args[0].filter((m) => m.role === "tool")) {
        const output = JSON.parse(message.content);
        if (
          typeof output.error === "string" &&
          !toolErrors.includes(output.error)
        )
          toolErrors.push(output.error);
      }
      const response = await callModel(...args);
      for (const call of response.tool_calls ?? []) {
        if (call.function.name === "show_visual") {
          const checked = visualSchema.safeParse(call.function.arguments);
          if (!checked.success)
            console.log(
              JSON.stringify({
                syntheticVisualKeys: Object.keys(call.function.arguments),
                validation: checked.error.issues,
              }),
            );
        }
      }
      calls.push(...(response.tool_calls?.map((c) => c.function.name) ?? []));
      return response;
    },
    {
      emit: (event) => {
        eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      },
    },
  );
  if (result.visuals?.length !== 3)
    console.log(
      JSON.stringify({
        syntheticReply: result.reply,
        calls,
        toolErrors,
        eventCounts,
      }),
    );
  assert.ok(calls.includes("health_overview"), "reads owned health context");
  for (const kind of ["table", "bar_chart", "diagram"])
    assert.ok(
      result.visuals?.some((v) => v.content.kind === kind),
      `renders ${kind}`,
    );
  const chart = result.visuals!.find(
    (v) => v.content.kind === "bar_chart",
  )!.content;
  assert.ok(chart.kind === "bar_chart");
  assert.deepEqual(
    chart.points.map((p) => p.value),
    [7, 8, 7.5],
  );
  assert.equal(result.proposals.length, 0);
  assert.equal((await readJournal(userId)).revision, 1);
  assert.equal((await history(userId)).at(-1)?.visuals?.length, 3);
  assert.ok(
    eventCounts.TEXT_MESSAGE_CONTENT > 0,
    "provider text streams to AG-UI",
  );
  console.log(
    JSON.stringify({
      passed: true,
      visuals: result.visuals!.map((v) => v.content.kind),
      journalUnchanged: true,
      eventCounts,
    }),
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
