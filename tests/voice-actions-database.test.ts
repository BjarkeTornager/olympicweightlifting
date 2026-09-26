import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { createWorkout, days } from "../lib/domain";
config({ path: ".env.local", quiet: true });

const today = "2026-09-26";

test(
  "voice saves are direct, fix an old unfinished workout, and keep Undo",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { runVoiceTool } = await import("../lib/voice-actions");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { history } = await import("../lib/agent/engine");
    const pool = getPool(),
      accounts: string[] = [];
    const user = async () => {
      const id = crypto.randomUUID();
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Voice test',$1||'@example.test',true)",
        [id],
      );
      return id;
    };
    // An empty workout left open days ago, as found in production.
    const withStaleDraft = async (id: string) => {
      const snapshot = await readJournal(id);
      const state = structuredClone(snapshot.state);
      state.activeWorkout = createWorkout(state, days[0], "2026-09-20");
      await writeJournal(id, {
        state,
        revision: snapshot.revision,
        mutationId: crypto.randomUUID(),
      });
    };
    const run = (
      id: string,
      name: Parameters<typeof runVoiceTool>[1]["name"],
      args: Record<string, unknown>,
      seenPhotoIds: string[] = [],
    ) =>
      runVoiceTool(id, {
        id: crypto.randomUUID(),
        name,
        args,
        today,
        seenPhotoIds,
      });
    const cleanAndJerk = {
      summary: "Clean and jerk doubles at 40, 50, 60 and 80",
      date: today,
      title: "Clean & jerk",
      exercises: [
        {
          exercise: "clean_and_jerk",
          sets: [40, 50, 60, 80].map((w) => ({
            weight_kg: w,
            reps: 2,
            made: true,
          })),
        },
      ],
    };
    try {
      await t.test(
        "a finished session saves despite an old empty draft",
        async () => {
          const a = await user();
          await withStaleDraft(a);
          const saved = await run(a, "log_training", cleanAndJerk);
          assert.equal(saved.ok, true);
          const { state } = await readJournal(a);
          assert.equal(state.sessions.length, 1);
          assert.equal(state.sessions[0].date, today);
          assert.deepEqual(
            state.sessions[0].exercises[0].sets.map((s) => [
              s.weight,
              s.reps,
              s.result,
            ]),
            [40, 50, 60, 80].map((w) => [w, 2, "success"]),
          );
          // The old draft is untouched until the athlete asks.
          assert.equal(state.activeWorkout?.date, "2026-09-20");
          // The receipt shows in Coach, labelled as a voice save, with Undo.
          const turns = await history(a);
          assert.equal(
            turns.at(-1)?.question,
            `[voice] ${cleanAndJerk.summary}`,
          );
          assert.equal(turns.at(-1)?.proposals?.[0].status, "saved");
        },
      );

      await t.test(
        "the coach can clear the empty draft and undo a save",
        async () => {
          const a = await user();
          await withStaleDraft(a);
          const cleared = await run(a, "clear_unfinished_workout", {
            summary: "Clear the old workout",
          });
          assert.equal(cleared.ok, true);
          assert.equal((await readJournal(a)).state.activeWorkout, null);
          const sleep = await run(a, "log_sleep", {
            summary: "Slept seven and a half hours",
            date: today,
            hours: 7.5,
          });
          assert.ok(sleep.ok && sleep.saveId);
          assert.equal(
            (await readJournal(a)).state.health.checkins[0].sleepHours,
            7.5,
          );
          const undone = await run(a, "undo_save", { save_id: sleep.saveId });
          assert.equal(undone.ok, true);
          assert.equal(
            (await readJournal(a)).state.health.checkins.find(
              (c) => c.date === today,
            )?.sleepHours ?? null,
            null,
          );
        },
      );

      await t.test(
        "a draft with logged sets is finished, never thrown away",
        async () => {
          const a = await user();
          const snapshot = await readJournal(a);
          const state = structuredClone(snapshot.state);
          const draft = createWorkout(state, days[0], "2026-09-20");
          draft.exercises[0].sets[0] = {
            ...draft.exercises[0].sets[0],
            weight: 60,
            reps: 2,
            logged: true,
            result: "success",
          };
          state.activeWorkout = draft;
          await writeJournal(a, {
            state,
            revision: snapshot.revision,
            mutationId: crypto.randomUUID(),
          });
          const result = await run(a, "clear_unfinished_workout", {
            summary: "Clear the old workout",
          });
          assert.equal(result.ok, true);
          const after = (await readJournal(a)).state;
          assert.equal(after.activeWorkout, null);
          assert.equal(after.sessions.length, 1);
          assert.equal(after.sessions[0].exercises[0].sets[0].weight, 60);
        },
      );

      await t.test(
        "meals save with estimates; unseen photos are refused",
        async () => {
          const a = await user();
          const meal = {
            summary: "Chicken and rice for dinner",
            date: today,
            meal_type: "dinner",
            name: "Chicken and rice",
            items: [
              {
                name: "Chicken breast",
                portion: "150 g",
                calories: 250,
                protein_g: 46,
                carbs_g: 0,
                fat_g: 5,
              },
            ],
          };
          await assert.rejects(
            run(a, "log_meal", { ...meal, photo_ids: [crypto.randomUUID()] }),
          );
          const saved = await run(a, "log_meal", meal);
          assert.equal(saved.ok, true);
          const [stored] = (await readJournal(a)).state.nutrition.meals;
          assert.equal(stored.items[0].protein, 46);
          assert.equal(stored.estimated, true);
          assert.equal(stored.source, "text");
        },
      );

      await t.test(
        "goals set by voice save the plan as daily targets",
        async () => {
          const a = await user();
          const saved = await run(a, "set_goals", {
            summary: "34, 182 cm, 88 kg, want to get to 81",
            age: 34,
            sex: "male",
            heightCm: 182,
            weightKg: 88,
            targetWeightKg: 81,
            targetDate: "",
            activity: "moderate",
            trainingDays: 4,
            sessionMinutes: 75,
            experience: "developing",
          });
          assert.ok(saved.ok);
          assert.match(saved.detail, /2,350 kcal a day/);
          const { state } = await readJournal(a);
          assert.equal(state.profile.body?.targetWeightKg, 81);
          assert.equal(state.profile.body?.targetDate, null);
          assert.equal(state.nutrition.targets.calories, 2350);
          // Missing details are refused, not guessed.
          await assert.rejects(
            run(a, "set_goals", {
              summary: "I want to be 80 kg",
              targetWeightKg: 80,
            }),
          );
        },
      );

      await t.test(
        "a repeated call id returns the same save, not a second one",
        async () => {
          const a = await user();
          const id = crypto.randomUUID();
          const call = () =>
            runVoiceTool(a, {
              id,
              name: "log_sleep",
              args: { summary: "Slept 7 hours", date: today, hours: 7 },
              today,
              seenPhotoIds: [],
            });
          const first = await call();
          const second = await call();
          assert.deepEqual(second, first);
          assert.equal((await history(a)).length, 1);
        },
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [accounts]);
    }
  },
);
