import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelMessage } from "../lib/agent/provider";
import { liftingBrief, liftingFixture } from "./fixtures/lifting-coach";
config({ path: ".env.local", quiet: true });
const call = (name: string, args: Record<string, unknown> = {}) => ({
  function: { name, arguments: args },
});
function sequence(...rounds: ReturnType<typeof call>[][]) {
  let index = 0;
  return async (): Promise<ModelMessage> => ({
    role: "assistant",
    content: "Review the evidence before deciding.",
    tool_calls: rounds[index++] ?? [],
  });
}
test(
  "lifting Coach tools preserve private evidence, reviewed edits, compatibility and Undo",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { readJournal, writeJournal, RevisionConflict } =
        await import("../lib/server"),
      { runTurn, applyProposal, history } = await import("../lib/agent/engine");
    const pool = getPool(),
      accounts: string[] = [];
    const user = async () => {
      const id = crypto.randomUUID();
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic lifting',$1||'@example.test',true)",
        [id],
      );
      return id;
    };
    const ask = async (
      id: string,
      model: (messages: ModelMessage[]) => Promise<ModelMessage>,
    ) =>
      runTurn(
        id,
        {
          id: crypto.randomUUID(),
          revision: (await readJournal(id)).revision,
          message:
            "Help me review my lifting and update my brief as requested.",
          timezone: "UTC",
        },
        model,
        { directLogging: true },
      );
    const change = call("prepare_change", {
      kind: "set_lifting_brief",
      liftingBrief,
    });
    try {
      await t.test(
        "only an owned read enables a reviewed brief, retries commit once and Undo restores absence",
        async () => {
          const a = await user(),
            b = await user();
          const rejected = await ask(a, sequence([change]));
          assert.equal(rejected.proposals.length, 0);
          assert.equal((await readJournal(a)).revision, 0);
          const direct = await ask(
            a,
            sequence(
              [call("lifting_review")],
              [call("log_entry", { kind: "set_lifting_brief", liftingBrief })],
            ),
          );
          assert.equal(direct.proposals.length, 0);
          assert.equal((await readJournal(a)).revision, 0);
          const response = await ask(
            a,
            sequence([call("lifting_review")], [change]),
          );
          assert.equal(response.proposals.length, 1);
          assert.equal(
            response.proposals[0].liftingBrief?.goal,
            liftingBrief.goal,
          );
          assert.equal(response.proposals[0].automatic, undefined);
          assert.equal((await readJournal(a)).state.profile.lifting, undefined);
          const id = response.proposals[0].id;
          await assert.rejects(
            applyProposal(a, id, false, { liftingBriefReview: false }),
            /Refresh the app/,
          );
          const oldClient = await runTurn(
            a,
            {
              id: crypto.randomUUID(),
              revision: 0,
              message: "Update my lifting brief",
              timezone: "UTC",
            },
            sequence([call("lifting_review")], [change]),
            { liftingBriefReview: false },
          );
          assert.equal(oldClient.proposals.length, 0);
          await assert.rejects(applyProposal(b, id), /expired/);
          const [saved, retry] = await Promise.all([
            applyProposal(a, id),
            applyProposal(a, id),
          ]);
          assert.equal(saved.revision, 1);
          assert.equal(retry.revision, 1);
          assert.deepEqual(saved.state.sessions, []);
          assert.equal(saved.state.profile.lifting?.goal, liftingBrief.goal);
          assert.equal((await readJournal(b)).state.profile.lifting, undefined);
          assert.deepEqual(await history(b), []);
          const undone = await applyProposal(a, id, true);
          assert.equal(undone.state.profile.lifting, undefined);
          assert.equal((await applyProposal(a, id, true)).revision, 2);
        },
      );
      await t.test(
        "the report and guide contain only this account's data and are read-only",
        async () => {
          const a = await user(),
            b = await user(),
            state = liftingFixture(new Date().toISOString().slice(0, 10));
          await writeJournal(a, {
            state,
            revision: 0,
            mutationId: crypto.randomUUID(),
          });
          for (const [id, expected] of [
            [a, 1],
            [b, 0],
          ] as const) {
            let step = 0;
            const response = await ask(id, async (messages) => {
              if (++step === 1)
                return {
                  role: "assistant",
                  content: "",
                  tool_calls: [call("lifting_review")],
                };
              const output = JSON.parse(String(messages.at(-1)!.content));
              assert.equal(output.recordedSessions, expected);
              assert.match(output.coachingGuide, /ONE main priority/);
              assert.match(output.coachingGuide, /still image cannot/);
              assert.equal(
                output.brief?.goal ?? null,
                expected ? liftingBrief.goal : null,
              );
              if (!expected)
                assert.ok(
                  !JSON.stringify(output).includes(state.sessions[0].id),
                );
              return {
                role: "assistant",
                content: "I can discuss one next step.",
              };
            });
            assert.equal(response.proposals.length, 0);
          }
          assert.equal((await readJournal(a)).revision, 1);
          let step = 0;
          await ask(a, async (messages) => {
            if (++step === 1)
              return {
                role: "assistant",
                content: "",
                tool_calls: [call("lifting_review", { endDate: "9999-12-31" })],
              };
            assert.match(String(messages.at(-1)!.content), /earlier date/);
            return { role: "assistant", content: "Choose an earlier date." };
          });
        },
      );
      await t.test(
        "summary reads cannot stand in for full-read guards on recorded sessions or current training",
        async () => {
          const a = await user(),
            state = liftingFixture(new Date().toISOString().slice(0, 10));
          await writeJournal(a, {
            state,
            revision: 0,
            mutationId: crypto.randomUUID(),
          });
          const reply = await ask(
            a,
            sequence(
              [call("lifting_review")],
              [call("log_entry", { kind: "finish_workout" })],
            ),
          );
          assert.equal(reply.proposals.length, 0);
          assert.equal((await readJournal(a)).revision, 1);
          assert.equal(
            (await readJournal(a)).state.activeWorkout?.id,
            state.activeWorkout?.id,
          );
        },
      );
      await t.test(
        "legacy omissions preserve the brief, explicit null clears, stale proposals and stale Undo reject",
        async () => {
          const a = await user(),
            response = await ask(
              a,
              sequence([call("lifting_review")], [change]),
            );
          await applyProposal(a, response.proposals[0].id);
          const snapshot = await readJournal(a),
            legacy = structuredClone(snapshot);
          delete legacy.state.profile.lifting;
          legacy.state.profile.bodyweight = 80;
          const request = {
            ...legacy,
            mutationId: crypto.randomUUID(),
            preserveMissingCoachData: true,
          };
          const saved = await writeJournal(a, request);
          assert.equal(saved.state.profile.lifting?.goal, liftingBrief.goal);
          assert.equal((await writeJournal(a, request)).revision, 2);
          await assert.rejects(
            applyProposal(a, response.proposals[0].id, true),
            RevisionConflict,
          );
          const clear = await ask(
            a,
            sequence(
              [call("lifting_review")],
              [
                call("prepare_change", {
                  kind: "set_lifting_brief",
                  liftingBrief: null,
                }),
              ],
            ),
          );
          assert.equal(clear.proposals[0].liftingBrief, null);
          const cleared = await applyProposal(a, clear.proposals[0].id);
          assert.equal(cleared.state.profile.lifting, null);
          const restored = await applyProposal(a, clear.proposals[0].id, true);
          assert.equal(restored.state.profile.lifting?.goal, liftingBrief.goal);
          const stale = await ask(
            a,
            sequence([call("lifting_review")], [change]),
          );
          const explicit = await readJournal(a);
          explicit.state.profile.lifting = null;
          await writeJournal(a, {
            ...explicit,
            mutationId: crypto.randomUUID(),
            preserveMissingCoachData: true,
          });
          assert.equal((await readJournal(a)).state.profile.lifting, null);
          await assert.rejects(
            applyProposal(a, stale.proposals[0].id),
            RevisionConflict,
          );
        },
      );
    } finally {
      for (const id of accounts)
        await pool.query("DELETE FROM users WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
