import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { simpleRoutine, mixedProgram } from "./fixtures/training-programs";
import { trainingPrograms } from "../lib/training-programs";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "training tools recover from the reported failure and enforce owned reads, atomic approval, retry, undo and stale protection",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal, RevisionConflict } =
      await import("../lib/server");
    const { runTurn, applyProposal } = await import("../lib/agent/engine");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic training','training-'||$1||'@example.test',true),($2,'Synthetic training','training-'||$2||'@example.test',true)",
      [a, b],
    );
    const tool = (
      name: string,
      args: Record<string, unknown>,
    ): ModelMessage => ({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name, arguments: args } }],
    });
    const done: ModelMessage = {
      role: "assistant",
      content: "Ready for your review.",
    };
    const ask = async (
      userId: string,
      model: (messages: ModelMessage[]) => Promise<ModelMessage>,
    ) =>
      runTurn(
        userId,
        {
          id: crypto.randomUUID(),
          revision: (await readJournal(userId)).revision,
          timezone: "Europe/Copenhagen",
          message:
            "Please create or update my reusable training program as discussed.",
        },
        model,
      );
    try {
      let round = 0;
      const create = await ask(a, async (messages) => {
        if (++round === 1)
          return tool("prepare_change", {
            kind: "save_routine",
            routine: simpleRoutine,
          });
        if (round === 2) {
          assert.match(messages.at(-1)!.content, /sessionId/);
          assert.match(messages.at(-1)!.content, /create_routine/);
          return tool("prepare_change", {
            kind: "create_routine",
            routine: simpleRoutine,
          });
        }
        return done;
      });
      assert.equal(create.proposals.length, 1);
      assert.equal(create.proposals[0].training?.kind, "routine");
      assert.equal((await readJournal(a)).state.templates.length, 0);
      await assert.rejects(() => applyProposal(b, create.proposals[0].id));
      const [saved, retried] = await Promise.all([
        applyProposal(a, create.proposals[0].id),
        applyProposal(a, create.proposals[0].id),
      ]);
      assert.equal(saved.revision, retried.revision);
      assert.equal(saved.state.templates.length, 1);
      const routineId = saved.state.templates[0].id;
      round = 0;
      const edit = await ask(a, async (messages) => {
        if (++round === 1) return tool("training_library", {});
        if (round === 2)
          return tool("prepare_change", {
            kind: "update_routine",
            routineId,
            routine: { ...simpleRoutine, name: "Updated accessories" },
          });
        if (round === 3) {
          assert.match(
            messages.at(-1)!.content,
            /Read the full original routine/,
          );
          return tool("training_library", { routineId });
        }
        if (round === 4)
          return tool("prepare_change", {
            kind: "update_routine",
            routineId,
            routine: { ...simpleRoutine, name: "Updated accessories" },
          });
        return done;
      });
      const updated = await applyProposal(a, edit.proposals[0].id);
      assert.equal(updated.state.templates[0].id, routineId);
      assert.equal(updated.state.templates[0].name, "Updated accessories");
      assert.equal(
        edit.proposals[0].training?.before?.name,
        simpleRoutine.name,
      );
      const undone = await applyProposal(a, edit.proposals[0].id, true);
      assert.deepEqual(undone.state.templates, saved.state.templates);
      round = 0;
      const createProgram = await ask(a, async (messages) => {
        if (++round === 1)
          return {
            role: "assistant",
            content: "",
            tool_calls: Array.from({ length: 12 }, (_, i) => ({
              id: `oversized-${i}`,
              function:
                i === 0
                  ? {
                      name: "prepare_change",
                      arguments: {
                        kind: "create_routine",
                        routine: simpleRoutine,
                      },
                    }
                  : { name: "exercises", arguments: { query: "leg curl" } },
            })),
          };
        if (round === 2) {
          const results = messages.slice(-12);
          assert.ok(
            results.every(
              (m) =>
                m.role === "tool" && m.content.includes("none were executed"),
            ),
          );
          assert.deepEqual(
            results.map((m) => m.tool_call_id),
            Array.from({ length: 12 }, (_, i) => `oversized-${i}`),
          );
          return tool("exercises", {
            queries: [
              "seated leg curl",
              "standing calf raise",
              "seated leg curl",
            ],
          });
        }
        if (round === 3) {
          const exercises = JSON.parse(messages.at(-1)!.content);
          assert.equal(
            exercises.length,
            2,
            "Batched lookups deduplicate repeated movements",
          );
          assert.ok(
            exercises.every((e: { loggingNotes: string }) => e.loggingNotes),
          );
          return tool("prepare_change", {
            kind: "create_training_program",
            trainingProgram: mixedProgram,
          });
        }
        return done;
      });
      assert.equal(
        createProgram.proposals.length,
        1,
        "No proposal from the oversized batch executed",
      );
      const programmed = await applyProposal(a, createProgram.proposals[0].id);
      const program = trainingPrograms(programmed.state)[0];
      assert.equal(program.days.length, 3);
      assert.equal(programmed.state.sessions.length, 0);
      assert.equal(programmed.state.activeWorkout, null);
      round = 0;
      const privacy = await ask(b, async (messages) => {
        if (++round === 1) return tool("training_library", {});
        if (round === 2) {
          assert.equal(JSON.parse(messages.at(-1)!.content).total, 0);
          return tool("training_library", { programId: program.id });
        }
        assert.match(messages.at(-1)!.content, /not in your journal/);
        assert.doesNotMatch(
          JSON.stringify(messages),
          /Strength and movement|Lower body accessories/,
        );
        return {
          role: "assistant",
          content: "No saved programs in your journal.",
        };
      });
      assert.equal(privacy.proposals.length, 0);
      round = 0;
      const start = await ask(a, async (messages) => {
        if (++round === 1)
          return tool("training_library", { programId: program.id });
        if (round === 2)
          return tool("prepare_change", {
            kind: "start_training_day",
            trainingProgramId: program.id,
            dayId: program.days[0].id,
            date: "2026-09-07",
          });
        if (round === 3) {
          assert.match(messages.at(-1)!.content, /Read current_workout/);
          return tool("current_workout", {});
        }
        if (round === 4)
          return tool("prepare_change", {
            kind: "start_training_day",
            trainingProgramId: program.id,
            dayId: program.days[0].id,
            date: "2026-09-07",
          });
        return done;
      });
      const started = await applyProposal(a, start.proposals[0].id);
      assert.ok(
        started.state.activeWorkout?.exercises.every((e) =>
          e.sets.every((s) => !s.logged && !s.result),
        ),
      );
      assert.equal(started.state.cardio.sessions.length, 0);
      round = 0;
      const programEdit = await ask(a, async (messages) => {
        if (++round === 1)
          return tool("prepare_change", {
            kind: "update_training_program",
            trainingProgramId: program.id,
            programChanges: { weeks: 8 },
          });
        if (round === 2) {
          assert.match(
            messages.at(-1)!.content,
            /Read the full original program/,
          );
          return tool("training_library", { programId: program.id });
        }
        if (round === 3)
          return tool("prepare_change", {
            kind: "update_training_program",
            trainingProgramId: program.id,
            programChanges: { weeks: 8 },
          });
        return done;
      });
      const editedProgram = await applyProposal(a, programEdit.proposals[0].id);
      assert.equal(trainingPrograms(editedProgram.state)[0].weeks, 8);
      assert.deepEqual(
        trainingPrograms(editedProgram.state)[0].days,
        program.days,
      );
      assert.deepEqual(
        editedProgram.state.activeWorkout,
        started.state.activeWorkout,
      );
      await applyProposal(a, programEdit.proposals[0].id, true);
      // The collection already exists in cached clients as an opaque JSON array:
      // a normal edit keeps custom program payloads verbatim, with no new defaults.
      const legacy = await readJournal(a);
      legacy.state.profile.bodyweight = 80;
      const preserved = await writeJournal(a, {
        ...legacy,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      });
      assert.deepEqual(trainingPrograms(preserved.state)[0], program);
      await assert.rejects(
        () => applyProposal(a, start.proposals[0].id, true),
        RevisionConflict,
      );
      round = 0;
      const stale = await ask(a, async () =>
        ++round === 1
          ? tool("training_library", { programId: program.id })
          : round === 2
            ? tool("prepare_change", {
                kind: "delete_training_program",
                trainingProgramId: program.id,
              })
            : done,
      );
      const newer = await readJournal(a);
      newer.state.profile.bodyweight = 81;
      await writeJournal(a, { ...newer, mutationId: crypto.randomUUID() });
      await assert.rejects(
        () => applyProposal(a, stale.proposals[0].id),
        RevisionConflict,
      );
      assert.equal(trainingPrograms((await readJournal(a)).state).length, 1);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [[a, b]]);
      await pool.end();
    }
  },
);
