import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { prepareAction } from "../lib/agent/actions";
import { saveCardio } from "../lib/cardio";
import type { ModelMessage } from "../lib/agent/provider";

config({ path: ".env.local", quiet: true });
const date = "2026-09-19";
const tool = (name: string, args: Record<string, unknown>): ModelMessage => ({
  role: "assistant",
  content: "No entry saved.",
  tool_calls: [{ function: { name, arguments: args } }],
});
const plain = (content = "Nothing was changed."): ModelMessage => ({
  role: "assistant",
  content,
});

test(
  "Coach corrections and additional answers preserve transactional receipts and explicit reviews",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { runTurn, findTurn, applyProposal } =
      await import("../lib/agent/engine");
    const pool = getPool(),
      users: string[] = [];
    const user = async () => {
      const id = crypto.randomUUID();
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic workflow fix',$1||'@example.test',true)",
        [id],
      );
      users.push(id);
      return id;
    };
    const input = async (id: string, message: string) => ({
      id: crypto.randomUUID(),
      revision: (await readJournal(id)).revision,
      timezone: "Europe/Copenhagen",
      message,
    });
    const direct = { directLogging: true };
    try {
      await t.test(
        "current workout exposes exact set IDs; correction requires a read, saves once, preserves siblings, and supports isolated Undo",
        async () => {
          const a = await user(),
            b = await user(),
            snapshot = await readJournal(a);
          snapshot.state = prepareAction(
            snapshot.state,
            {
              kind: "log_workout_progress",
              completion: "ongoing",
              workout: {
                title: "Squat",
                date,
                category: "weightlifting",
                exercises: [
                  {
                    exerciseId: "back_squat",
                    sets: [
                      { weight: 80, reps: 5, result: "success", rpe: 8 },
                      { weight: 80, reps: 5, result: "success", rpe: 9 },
                    ],
                  },
                ],
              },
            },
            date,
          ).state;
          await writeJournal(a, {
            ...snapshot,
            mutationId: crypto.randomUUID(),
          });
          const before = await readJournal(a),
            w = before.state.activeWorkout!,
            e = w.exercises[0];
          const action = {
            kind: "correct_workout_set",
            workoutId: w.id,
            entryId: e.id,
            setId: e.sets[0].id,
            setChanges: { weight: 85 },
          };
          let round = 0;
          const request = await input(
            a,
            "Correct my first ongoing squat set to 85 kg, preserving its reps and RPE.",
          );
          const result = await runTurn(
            a,
            request,
            async (messages) => {
              if (++round === 1) return tool("log_entry", action);
              if (round === 2) {
                assert.match(messages.at(-1)!.content, /Read current_workout/);
                assert.deepEqual((await readJournal(a)).state, before.state);
                return tool("current_workout", {});
              }
              const read = JSON.parse(messages.at(-1)!.content);
              assert.equal(read.exercises[0].sets[0].id, e.sets[0].id);
              assert.equal(read.exercises[0].sets[1].id, e.sets[1].id);
              return tool("log_entry", action);
            },
            direct,
          );
          const after = await readJournal(a),
            expected = structuredClone(before.state);
          expected.activeWorkout!.exercises[0].sets[0].weight = 85;
          // writeJournal updates only the journal's bookkeeping timestamp as well.
          expected.updatedAt = after.state.updatedAt;
          assert.deepEqual(after.state, expected);
          assert.equal(after.revision, before.revision + 1);
          assert.equal(result.proposals[0].status, "saved");
          assert.deepEqual(
            await runTurn(
              a,
              request,
              async () => {
                throw Error("A replay must not invoke the model");
              },
              direct,
            ),
            result,
          );
          await assert.rejects(() =>
            applyProposal(b, result.proposals[0].id, true),
          );
          const undone = await applyProposal(a, result.proposals[0].id, true);
          assert.deepEqual(
            undone.state.activeWorkout,
            before.state.activeWorkout,
          );
          assert.equal(undone.state.sessions.length, 0);
          await assert.rejects(
            () =>
              runTurn(
                a,
                { ...request, id: crypto.randomUUID() },
                async () => plain(),
                direct,
              ),
            /Sync your latest/,
          );
        },
      );
      await t.test(
        "a mixed save-and-question retains its answer in the durable result without trusting incidental model prose",
        async () => {
          const a = await user(),
            request = await input(
              a,
              "Save 8 hours of sleep and explain the two lifts.",
            );
          const answer =
            "A snatch lifts the bar overhead in one movement; a clean and jerk brings it to the shoulders first.";
          let round = 0;
          const result = await runTurn(
            a,
            request,
            async () =>
              ++round === 1
                ? tool("health_overview", { date })
                : tool("log_entry", {
                    kind: "record_checkin",
                    checkin: { date, sleepHours: 8 },
                    answer,
                  }),
            direct,
          );
          assert.match(result.reply, /^Saved to your journal\./);
          assert.ok(result.reply.endsWith(answer));
          assert.doesNotMatch(result.reply, /No entry saved/);
          assert.equal(
            (await readJournal(a)).state.health.checkins[0].sleepHours,
            8,
          );
          assert.equal((await findTurn(a, request.id))?.reply, result.reply);
          assert.deepEqual(
            await runTurn(
              a,
              request,
              async () => {
                throw Error("No second save");
              },
              direct,
            ),
            result,
          );
        },
      );
      await t.test(
        "an unintended cardio review is rejected without writing, then the requested patch can save directly",
        async () => {
          const a = await user(),
            snapshot = await readJournal(a);
          const cardio = saveCardio(
            snapshot.state,
            {
              date,
              activity: "running",
              durationSeconds: 1710,
              distanceKm: 5,
              averageHeartRate: 145,
              notes: "Keep this note",
            },
            date,
          );
          await writeJournal(a, {
            ...snapshot,
            mutationId: crypto.randomUUID(),
          });
          const before = await readJournal(a),
            action = {
              kind: "update_cardio",
              cardioId: cardio.id,
              changes: { distanceKm: 4.8 },
            };
          let round = 0;
          const result = await runTurn(
            a,
            await input(
              a,
              "Rettelse: løbeturen var 4,8 km, ikke 5. Behold tid og puls.",
            ),
            async (messages) => {
              if (++round === 1)
                return tool("cardio_journal", { from: date, to: date });
              if (round === 2) return tool("prepare_change", action);
              assert.match(messages.at(-1)!.content, /Use log_entry/);
              assert.equal((await readJournal(a)).revision, before.revision);
              return tool("log_entry", action);
            },
            direct,
          );
          assert.equal(result.proposals[0].status, "saved");
          const after = (await readJournal(a)).state.cardio.sessions;
          assert.equal(after.length, 1);
          assert.deepEqual(
            { ...after[0], updatedAt: cardio.updatedAt },
            { ...cardio, distanceKm: 4.8 },
          );
        },
      );
      await t.test(
        "explicit previews retain extra answers without saving; reviewed-only clients remain compatible",
        async () => {
          for (const directLogging of [true, false]) {
            const a = await user();
            let round = 0;
            const answer =
              "Træk foregår i én bevægelse; stød har først et clean og derefter et jerk.";
            const result = await runTurn(
              a,
              await input(
                a,
                "Forhåndsvis 8 timers søvn. Gem ikke endnu. Forklar også træk og stød.",
              ),
              async () =>
                ++round === 1
                  ? tool("health_overview", { date })
                  : tool("prepare_change", {
                      kind: "record_checkin",
                      checkin: { date, sleepHours: 8 },
                      answer,
                      ...(directLogging ? { reviewRequested: true } : {}),
                    }),
              { directLogging },
            );
            assert.equal((await readJournal(a)).revision, 0);
            assert.equal(result.proposals[0].status, undefined);
            assert.match(result.reply, /^Ready for your review/);
            assert.ok(result.reply.endsWith(answer));
          }
        },
      );
      await t.test(
        "invalid answer metadata never commits a save or returns the proposed answer",
        async () => {
          const a = await user();
          let round = 0;
          const result = await runTurn(
            a,
            await input(a, "Save my sleep and answer a question"),
            async (messages) => {
              if (++round === 1) return tool("health_overview", { date });
              if (round === 2)
                return tool("log_entry", {
                  kind: "record_checkin",
                  checkin: { date, sleepHours: 8 },
                  answer: "x".repeat(8001),
                });
              assert.match(messages.at(-1)!.content, /answer/);
              return plain();
            },
            direct,
          );
          assert.equal(result.proposals.length, 0);
          assert.equal((await readJournal(a)).revision, 0);
          assert.equal(result.reply, "Nothing was changed.");
        },
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [users]);
      await pool.end();
    }
  },
);
