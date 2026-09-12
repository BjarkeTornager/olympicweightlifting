import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelMessage } from "../lib/agent/provider";
import { prepareAction } from "../lib/agent/actions";
config({ path: ".env.local", quiet: true });

test(
  "workout continuity reads, append, merge, atomic retry, account isolation, undo and stale safety",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { runTurn, applyProposal } = await import("../lib/agent/engine");
    const { readJournal, writeJournal, RevisionConflict } =
      await import("../lib/server");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      date = "2026-09-07";
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic continuity','continuity-'||$1||'@example.test',true),($2,'Synthetic continuity','continuity-'||$2||'@example.test',true)",
      [a, b],
    );
    const workout = {
      title: "Lower body",
      date,
      category: "accessories",
      exercises: [
        {
          exerciseId: "romanian_deadlift",
          sets: [{ weight: 60, reps: 10, result: "success" }],
        },
      ],
    };
    const tool = (
      name: string,
      args: Record<string, unknown>,
    ): ModelMessage => ({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name, arguments: args } }],
    });
    const reads: ModelMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { function: { name: "current_workout", arguments: {} } },
        {
          function: {
            name: "find_sessions",
            arguments: { from: date, to: date },
          },
        },
      ],
    };
    const ask = async (
      userId: string,
      model: (messages: ModelMessage[]) => Promise<ModelMessage>,
    ) =>
      runTurn(
        userId,
        {
          id: crypto.randomUUID(),
          message: "Update my workout as requested; keep all reported sets.",
          timezone: "Europe/Copenhagen",
          revision: (await readJournal(userId)).revision,
        },
        model,
      );
    try {
      let round = 0;
      const progress = {
        kind: "log_workout_progress",
        workout,
        completion: "ongoing",
      };
      const first = await ask(a, async (messages) => {
        if (++round === 1) return tool("prepare_change", progress);
        if (round === 2) {
          assert.match(messages.at(-1)!.content, /Read find_sessions/);
          return reads;
        }
        return tool("prepare_change", progress);
      });
      assert.equal(first.proposals.length, 1);
      assert.equal(first.proposals[0].workoutReview!.status, "ongoing");
      await assert.rejects(() => applyProposal(b, first.proposals[0].id));
      const [saved, retry] = await Promise.all([
        applyProposal(a, first.proposals[0].id),
        applyProposal(a, first.proposals[0].id),
      ]);
      assert.equal(saved.revision, retry.revision);
      assert.equal(saved.state.sessions.length, 0);
      assert.equal(saved.state.activeWorkout!.exercises[0].sets.length, 1);
      round = 0;
      const second = await ask(a, async () =>
        ++round === 1
          ? reads
          : tool("prepare_change", { ...progress, completion: "completed" }),
      );
      const done = await applyProposal(a, second.proposals[0].id);
      assert.equal(done.state.activeWorkout, null);
      assert.equal(done.state.sessions.length, 1);
      assert.equal(done.state.sessions[0].exercises[0].sets.length, 2);
      const split = prepareAction(
        done.state,
        {
          kind: "record_session",
          workout: { ...workout, title: "Final exercise" },
          separateSession: true,
        },
        date,
      ).state;
      await writeJournal(a, {
        state: split,
        revision: done.revision,
        mutationId: crypto.randomUUID(),
      });
      const ids = split.sessions.map((s) => s.id),
        merge = {
          kind: "merge_sessions",
          sessionIds: ids,
          name: "Combined lower body",
          completion: "completed",
        };
      round = 0;
      const repaired = await ask(a, async (messages) => {
        if (++round === 1) return tool("prepare_change", merge);
        if (round === 2) {
          assert.match(messages.at(-1)!.content, /Read every full source/);
          return {
            role: "assistant",
            content: "",
            tool_calls: [
              { function: { name: "current_workout", arguments: {} } },
              ...ids.map((sessionId) => ({
                function: { name: "read_session", arguments: { sessionId } },
              })),
            ],
          };
        }
        return tool("prepare_change", merge);
      });
      assert.equal(repaired.proposals[0].workoutReview!.sources!.length, 2);
      await assert.rejects(() => applyProposal(b, repaired.proposals[0].id));
      const repair = await applyProposal(a, repaired.proposals[0].id);
      assert.equal(repair.state.sessions.length, 1);
      assert.equal(
        repair.state.sessions[0].exercises.flatMap((e) => e.sets).length,
        3,
      );
      const undone = await applyProposal(a, repaired.proposals[0].id, true);
      assert.deepEqual(undone.state.sessions, split.sessions);
      round = 0;
      const stale = await ask(a, async () =>
        ++round === 1
          ? {
              role: "assistant",
              content: "",
              tool_calls: [
                { function: { name: "current_workout", arguments: {} } },
                ...ids.map((sessionId) => ({
                  function: { name: "read_session", arguments: { sessionId } },
                })),
              ],
            }
          : tool("prepare_change", merge),
      );
      await writeJournal(a, {
        ...undone,
        state: {
          ...undone.state,
          sessions: undone.state.sessions.map((s, i) =>
            i === 0 ? { ...s, athleteNotes: "Later correction" } : s,
          ),
        },
        mutationId: crypto.randomUUID(),
      });
      await assert.rejects(
        () => applyProposal(a, stale.proposals[0].id),
        RevisionConflict,
      );
      assert.equal((await readJournal(a)).state.sessions.length, 2);
      let foreignRead = "";
      round = 0;
      await ask(b, async (messages) => {
        if (++round === 1) return tool("read_session", { sessionId: ids[0] });
        foreignRead = messages.at(-1)!.content;
        return { role: "assistant", content: "No matching session." };
      });
      assert.match(foreignRead, /not in your journal/);
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
