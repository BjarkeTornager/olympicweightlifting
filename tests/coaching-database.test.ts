import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

test(
  "Coach reads only the account's saved focus and dated, completed recent conversations",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { runTurn } = await import("../lib/agent/engine");
    const { readJournal, writeJournal } = await import("../lib/server");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','coaching-a-'||$1||'@example.test',true),($2,'QA','coaching-b-'||$2||'@example.test',true)",
      [a, b],
    );
    try {
      for (const id of [a, b]) {
        const journal = await readJournal(id);
        journal.state.profile.coaching = {
          initiative: "on-request",
          focus: id === a ? "A's private focus" : "B's private focus",
        };
        await writeJournal(id, { ...journal, mutationId: crypto.randomUUID() });
      }
      const insertTurn = async (
        userId: string,
        question: string,
        status: string,
        ageMinutes: number,
      ) => {
        await pool.query(
          "INSERT INTO agent_turns(id,user_id,question,status,response,created_at) VALUES($1,$2,$3,$4,$5,now()-($6 * interval '1 minute'))",
          [
            crypto.randomUUID(),
            userId,
            question,
            status,
            JSON.stringify({
              reply: "We discussed an option, not a commitment.",
              proposals: [],
            }),
            ageMinutes,
          ],
        );
      };
      await insertTurn(a, "expired conversation", "done", 91 * 1440);
      for (let i = 0; i < 9; i++)
        await insertTurn(a, `A's exchange ${i}`, "done", 12 - i);
      await insertTurn(a, "failed conversation", "failed", 2);
      await insertTurn(b, "B's private conversation", "done", 1);
      const response = await runTurn(
        a,
        {
          id: crypto.randomUUID(),
          revision: 1,
          timezone: "Europe/Copenhagen",
          message: "Thanks, that helps.",
        },
        async (messages) => {
          const context = messages.find((m) =>
            m.content.startsWith("Private coaching context"),
          )!;
          assert.match(context.content, /A's private focus/);
          assert.match(context.content, /"initiative":"on-request"/);
          assert.match(context.content, /"startingPoint":null/);
          const all = messages.map((m) => m.content).join("\n");
          assert.doesNotMatch(
            all,
            /B's private|expired conversation|failed conversation|A's exchange 0/,
          );
          assert.equal(
            messages.filter((m) =>
              m.content.startsWith("Earlier message sent at "),
            ).length,
            8,
          );
          assert.match(all, /Earlier message sent at \d{4}-\d{2}-\d{2}T/);
          assert.match(all, /A's exchange 1/);
          assert.match(all, /A's exchange 8/);
          assert.equal(messages.at(-1)!.content, "Thanks, that helps.");
          return { role: "assistant", content: "You’re welcome." };
        },
      );
      assert.equal(response.proposals.length, 0);
      assert.equal((await readJournal(a)).revision, 1);
      assert.equal(
        (await readJournal(b)).state.profile.coaching?.focus,
        "B's private focus",
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
