import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { canonicalJson } from "../lib/json";
import { emptyJournal, today } from "../lib/domain";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
test(
  "Cardio database: private Coach reads, reviewed save/retry/undo, guarded corrections, and pre-release sync recovery",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn, applyProposal } = await import("../lib/agent/engine"),
      { readJournal, writeJournal } = await import("../lib/server");
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      date = today(),
      pool = getPool();
    await pool.query(
      "INSERT INTO users (id,name,email,email_verified) VALUES ($1,'Synthetic','cardio-'||$1||'@example.test',true),($2,'Synthetic','cardio-'||$2||'@example.test',true)",
      [a, b],
    );
    const input = (revision = 0) => ({
      id: crypto.randomUUID(),
      message: "Log my 5 km run today in 28 minutes.",
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
    const finished: ModelMessage = {
      role: "assistant",
      content: "Ready for your review.",
    };
    const action = {
      kind: "record_cardio",
      cardio: {
        activity: "running",
        date,
        durationSeconds: 1680,
        distanceKm: 5,
        notes: "Preserve note",
      },
    };
    try {
      let step = 0;
      const proposed = await runTurn(a, input(), async (messages) => {
        if (++step === 1) return tool("prepare_change", action);
        if (step === 2) {
          assert.match(messages.at(-1)!.content, /Read the cardio journal/);
          return tool("cardio_journal", { from: date, to: date });
        }
        if (step === 3) return tool("prepare_change", action);
        return finished;
      });
      assert.equal(proposed.proposals.length, 1);
      assert.equal((await readJournal(a)).state.cardio.sessions.length, 0);
      await assert.rejects(
        applyProposal(b, proposed.proposals[0].id),
        /expired/,
      );
      const saved = await applyProposal(a, proposed.proposals[0].id);
      assert.equal(saved.state.cardio.sessions[0].durationSeconds, 1680);
      assert.equal(
        (await applyProposal(a, proposed.proposals[0].id)).revision,
        saved.revision,
      );
      step = 0;
      await runTurn(
        b,
        { ...input(), message: "Show my cardio." },
        async (messages) => {
          if (++step === 1)
            return tool("cardio_journal", { from: date, to: date });
          const output = JSON.parse(messages.at(-1)!.content);
          assert.equal(output.sessions, 0);
          assert.deepEqual(output.entries, []);
          return finished;
        },
      );
      step = 0;
      const correction = await runTurn(
        a,
        {
          ...input(saved.revision),
          message: "Correct that run to 29 minutes, keep the other details.",
        },
        async (messages) => {
          const update = {
            kind: "update_cardio",
            cardioId: saved.state.cardio.sessions[0].id,
            changes: { durationSeconds: 1740 },
          };
          if (++step === 1) return tool("prepare_change", update);
          if (step === 2) {
            assert.match(
              messages.at(-1)!.content,
              /Read the full original cardio/,
            );
            return tool("cardio_journal", { from: date, to: date });
          }
          if (step === 3) return tool("prepare_change", update);
          return finished;
        },
      );
      const corrected = await applyProposal(a, correction.proposals[0].id);
      assert.equal(corrected.state.cardio.sessions[0].notes, "Preserve note");
      assert.equal(corrected.state.cardio.sessions[0].distanceKm, 5);
      const undone = await applyProposal(a, correction.proposals[0].id, true);
      assert.equal(undone.state.cardio.sessions[0].durationSeconds, 1680);
      assert.equal(undone.state.nutrition.meals.length, 0);
      assert.equal(undone.state.sessions.length, 0);

      // A cached client omitting the new domain must not erase activities.
      const olderClient = JSON.parse(JSON.stringify(undone.state));
      delete olderClient.cardio;
      olderClient.profile.bodyweight = 90;
      const olderInput = {
        state: olderClient,
        revision: undone.revision,
        mutationId: crypto.randomUUID(),
      };
      const compatible = await writeJournal(a, olderInput);
      assert.deepEqual(compatible.state.cardio, undone.state.cardio);
      assert.equal(compatible.state.profile.bodyweight, 90);
      assert.equal(
        (await writeJournal(a, olderInput)).revision,
        compatible.revision,
      );
      const explicitRemoval = await writeJournal(a, {
        state: { ...compatible.state, cardio: { sessions: [] } },
        revision: compatible.revision,
        mutationId: crypto.randomUUID(),
      });
      assert.equal(explicitRemoval.state.cardio.sessions.length, 0);

      // Simulate an old client retry after a successful pre-cardio save lost its acknowledgement.
      const legacy = JSON.parse(JSON.stringify(emptyJournal()));
      delete legacy.cardio;
      const mutationId = crypto.randomUUID();
      await pool.query(
        "UPDATE journals SET state=$1,revision=1 WHERE user_id=$2",
        [JSON.stringify(legacy), b],
      );
      const hash = createHash("sha256")
        .update(canonicalJson({ state: legacy, revision: 0 }))
        .digest("hex");
      await pool.query(
        "INSERT INTO sync_mutations (user_id,id,hash,revision) VALUES ($1,$2,$3,1)",
        [b, mutationId, hash],
      );
      const recovered = await writeJournal(b, {
        state: legacy,
        revision: 0,
        mutationId,
      });
      assert.equal(recovered.revision, 1);
      assert.deepEqual(recovered.state.cardio, { sessions: [] });
      const changed = structuredClone(legacy);
      changed.profile.bodyweight = 90;
      await assert.rejects(
        writeJournal(b, { state: changed, revision: 0, mutationId }),
        /reused with different content/,
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
