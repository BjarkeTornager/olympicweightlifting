import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
test(
  "agent uses owned tools, persists chat, commits once, prevents stale writes and guards undo",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn, applyProposal, history } = await import("../lib/agent/engine"),
      { readJournal, writeJournal, RevisionConflict } =
        await import("../lib/server");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','agent-a-'||$1||'@example.test',true),($2,'QA','agent-b-'||$2||'@example.test',true)",
      [a, b],
    );
    const makeInput = (revision = 0) => ({
      id: crypto.randomUUID(),
      message:
        "Log my accessory training on 5 September 2026: strict press 40 kg for 8 reps, made.",
      revision,
      timezone: "Europe/Copenhagen",
    });
    const action = {
      kind: "record_session",
      workout: {
        title: "Accessory training",
        date: "2026-09-05",
        category: "accessories",
        exercises: [
          {
            exerciseId: "strict_press",
            sets: [{ weight: 40, reps: 8, result: "success" }],
          },
        ],
      },
    };
    const proposalModel = async (): Promise<ModelMessage> => ({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "prepare_change", arguments: action } }],
    });
    try {
      const firstInput = makeInput(),
        response = await runTurn(a, firstInput, proposalModel);
      assert.equal(
        (await readJournal(a)).state.sessions.length,
        0,
        "preparation never writes training",
      );
      assert.equal(response.proposals.length, 1);
      assert.match(response.reply, /review/);
      assert.deepEqual(
        await runTurn(a, firstInput, async () => {
          throw Error("must not call provider twice");
        }),
        response,
      );
      const id = response.proposals[0].id;
      await assert.rejects(applyProposal(b, id), /expired/);
      const [saved, retry] = await Promise.all([
        applyProposal(a, id),
        applyProposal(a, id),
      ]);
      assert.equal(saved.revision, 1);
      assert.equal(retry.revision, 1);
      assert.equal(saved.state.sessions.length, 1);
      const undone = await applyProposal(a, id, true);
      assert.equal(undone.revision, 2);
      assert.equal(undone.state.sessions.length, 0);
      assert.equal((await applyProposal(a, id, true)).revision, 2);
      await assert.rejects(applyProposal(a, id), /undone/);
      const second = await runTurn(a, makeInput(2), proposalModel),
        stale = second.proposals[0].id;
      const journal = await readJournal(a);
      journal.state.profile.bodyweight = 80;
      await writeJournal(a, { ...journal, mutationId: crypto.randomUUID() });
      await assert.rejects(applyProposal(a, stale), RevisionConflict);
      const third = await runTurn(a, makeInput(3), proposalModel),
        thirdId = third.proposals[0].id;
      await applyProposal(a, thirdId);
      const current = await readJournal(a);
      current.state.profile.bodyweight = 81;
      await writeJournal(a, { ...current, mutationId: crypto.randomUUID() });
      await assert.rejects(applyProposal(a, thirdId, true), RevisionConflict);
      assert.equal((await readJournal(a)).state.profile.bodyweight, 81);
      assert.equal((await history(b)).length, 0);
      let round = 0;
      const messages: ModelMessage[][] = [];
      await runTurn(
        b,
        { ...makeInput(), message: "What was my last session?" },
        async (input) => {
          messages.push(structuredClone(input));
          return ++round === 1
            ? {
                role: "assistant",
                content: "",
                tool_calls: [
                  { function: { name: "find_sessions", arguments: {} } },
                ],
              }
            : {
                role: "assistant",
                content: "Your journal has no sessions yet.",
              };
        },
      );
      const result = JSON.parse(
        messages[1].find((m) => m.role === "tool")!.content,
      );
      assert.equal(result.total, 0, "athlete B never sees A's records");
      const events: unknown[] = [];
      let visualRound = 0;
      const visual = {
        kind: "bar_chart",
        title: "Illustrative example",
        caption: "Example values, not journal observations.",
        unit: "hours",
        points: [{ label: "Example night", value: 7.5 }],
      };
      const shown = await runTurn(
        b,
        { ...makeInput(), message: "Show an illustrative sleep chart" },
        async (_messages, _tools, _signal, onText) => {
          if (++visualRound === 1)
            return {
              role: "assistant",
              content: "",
              tool_calls: [
                { function: { name: "show_visual", arguments: visual } },
              ],
            };
          onText?.("Here is an illustrative example.");
          return {
            role: "assistant",
            content: "Here is an illustrative example.",
          };
        },
        {
          emit: (event) => {
            events.push(event);
          },
        },
      );
      assert.equal(shown.visuals?.[0].content.title, "Illustrative example");
      assert.ok(events.some((e) => (e as { type: string }).type === "CUSTOM"));
      assert.ok(
        events.some(
          (e) => (e as { type: string }).type === "TEXT_MESSAGE_CONTENT",
        ),
      );
      assert.equal(
        (await history(b)).at(-1)?.visuals?.[0].id,
        shown.visuals?.[0].id,
      );
      assert.equal(
        (await readJournal(b)).revision,
        0,
        "a generated visual cannot mutate the journal",
      );
      assert.doesNotMatch(
        JSON.stringify(await history(a)),
        /Illustrative example/,
      );
      assert.doesNotMatch(
        JSON.stringify(events),
        /userId|athleteNotes|bodyweight|api.key/i,
      );
      const abort = new AbortController();
      await assert.rejects(
        runTurn(
          b,
          makeInput(),
          async () => {
            abort.abort();
            return {
              role: "assistant",
              content: "",
              tool_calls: [
                { function: { name: "prepare_change", arguments: action } },
              ],
            };
          },
          { signal: abort.signal },
        ),
      );
      assert.equal(
        (await readJournal(b)).revision,
        0,
        "a cancelled run cannot prepare or apply a journal change",
      );
      await assert.rejects(runTurn(a, makeInput(0), proposalModel), /Sync/);
      const count = (await history(a)).length;
      await assert.rejects(
        runTurn(a, makeInput(5), async () => {
          throw Error("Provider timeout");
        }),
        /timeout/,
      );
      assert.equal((await history(a)).length, count + 1);
      assert.equal(
        (await readJournal(a)).revision,
        5,
        "provider failure has no journal writes",
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
