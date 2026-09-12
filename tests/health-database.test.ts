import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
test(
  "health tools read one account, require context, save a reviewed patch once and preserve other fields",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn, applyProposal } = await import("../lib/agent/engine"),
      { readJournal, writeJournal } = await import("../lib/server");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','health-'||$1||'@example.test',true),($2,'QA','health-'||$2||'@example.test',true)",
      [a, b],
    );
    const input = (revision = 0) => ({
      id: crypto.randomUUID(),
      message: "Please log 7 hours sleep last night and energy 2 out of 5.",
      timezone: "Europe/Copenhagen",
      revision,
    });
    const tool = (
      name: string,
      args: Record<string, unknown>,
    ): ModelMessage => ({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name, arguments: args } }],
    });
    try {
      let step = 0,
        denied = false;
      const proposal = await runTurn(a, input(), async (messages) => {
        step++;
        if (step === 1)
          return tool("prepare_change", {
            kind: "record_checkin",
            checkin: { date: "2026-09-06", sleepHours: 7, energy: 2 },
          });
        if (step === 2) {
          denied = messages
            .at(-1)!
            .content.includes("Read the health overview");
          return tool("health_overview", { date: "2026-09-06" });
        }
        return tool("prepare_change", {
          kind: "record_checkin",
          checkin: { date: "2026-09-06", sleepHours: 7, energy: 2 },
        });
      });
      assert.ok(denied);
      assert.equal(proposal.proposals.length, 1);
      assert.equal((await readJournal(a)).state.health.checkins.length, 0);
      await assert.rejects(
        applyProposal(b, proposal.proposals[0].id),
        /expired/,
      );
      await applyProposal(a, proposal.proposals[0].id);
      assert.equal(
        (await applyProposal(a, proposal.proposals[0].id)).revision,
        1,
      );
      let seen: unknown,
        round = 0;
      await runTurn(
        b,
        { ...input(), message: "Help me plan today" },
        async (messages) => {
          if (++round === 1)
            return tool("health_overview", { date: "2026-09-06" });
          seen = JSON.parse(messages.at(-1)!.content);
          return {
            role: "assistant",
            content: "Start with a check-in so I know how you feel.",
          };
        },
      );
      assert.equal(
        (seen as { checkin: unknown }).checkin,
        null,
        "B cannot see A's health details",
      );
      const saved = await readJournal(a);
      saved.state.health.checkins[0].notes = "Keep my original note";
      await writeJournal(a, { ...saved, mutationId: crypto.randomUUID() });
      step = 0;
      const update = await runTurn(
        a,
        { ...input(2), message: "Record my total water today as 750 ml" },
        async () =>
          ++step === 1
            ? tool("health_overview", { date: "2026-09-06" })
            : tool("prepare_change", {
                kind: "record_checkin",
                checkin: { date: "2026-09-06", waterMl: 750 },
              }),
      );
      const result = await applyProposal(a, update.proposals[0].id);
      assert.equal(result.state.health.checkins[0].sleepHours, 7);
      assert.equal(result.state.health.checkins[0].waterMl, 750);
      assert.equal(
        result.state.health.checkins[0].notes,
        "Keep my original note",
      );
      const undo = await applyProposal(a, update.proposals[0].id, true);
      assert.equal(undo.state.health.checkins[0].waterMl, null);
      assert.equal(undo.state.health.checkins[0].sleepHours, 7);
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
