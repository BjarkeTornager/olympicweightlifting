import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

const date = "2026-09-08";
const call = (name: string, args: Record<string, unknown> = {}) => ({
  function: { name, arguments: args },
});
function sequence(...rounds: ReturnType<typeof call>[][]) {
  let round = 0;
  return async (): Promise<ModelMessage> => ({
    role: "assistant",
    content: "No entry saved.",
    tool_calls: rounds[round++] ?? [],
  });
}
const food = (photoIds: string[] = []) => ({
  kind: "record_meal",
  meal: {
    date,
    name: "Morning coffee",
    type: "breakfast",
    source: photoIds.length ? "photo" : "text",
    estimated: false,
    photoIds,
    notes:
      "Estimated black coffee, 200 ml. Breakfast inferred from morning context.",
    items: [
      {
        name: "Coffee",
        portion: "200 ml",
        calories: 2,
        protein: 0,
        carbs: 0,
        fat: 0,
        classification: {
          foodGroups: ["drinks"],
          ingredients: [{ name: "coffee", evidence: "reported" }],
        },
      },
    ],
  },
});
const health = { kind: "record_checkin", checkin: { date, sleepHours: 7.5 } };
const cardio = {
  kind: "record_cardio",
  cardio: { date, activity: "running", durationSeconds: 1680, distanceKm: 5 },
};
const reads = () => [
  call("food_journal", { from: date, to: date }),
  call("health_overview", { date }),
  call("cardio_journal", { from: date, to: date }),
];

test(
  "direct Coach logging is atomic, recoverable, private and reversible",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { runTurn, applyProposal, findTurn, history } =
      await import("../lib/agent/engine");
    const { readJournal, writeJournal, RevisionConflict } =
      await import("../lib/server");
    const { saveUserImage, patchUserImage } =
      await import("../lib/user-images");
    const pool = getPool(),
      accounts: string[] = [];
    const user = async () => {
      const id = crypto.randomUUID();
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Direct log test',$1||'@example.test',true)",
        [id],
      );
      return id;
    };
    const input = (
      message = "I had coffee, slept 7.5 hours and ran 5 km in 28 minutes today",
      revision = 0,
    ) => ({
      id: crypto.randomUUID(),
      message,
      revision,
      timezone: "Europe/Copenhagen",
    });
    const hooks = { directLogging: true };
    try {
      await t.test(
        "uncertain tray portions do not block three reported eggs; a correction updates the saved meal",
        async () => {
          const a = await user();
          const request = input("Also eat 3 fried eggs");
          const meal = {
            ...food().meal,
            name: "Lunch",
            type: "lunch",
            estimated: true,
            notes:
              "Estimated the visible serving as consumed. Meat type unknown; assumed three medium eggs with one teaspoon of oil. Correct portions afterward.",
            items: [
              {
                name: "Grilled meat, type uncertain",
                portion: "Estimated 150 g visible serving",
                calories: 330,
                protein: 35,
                carbs: 0,
                fat: 21,
                classification: { foodGroups: ["meat"], ingredients: [] },
              },
              {
                name: "Fried eggs",
                portion: "3 medium eggs; estimated 1 tsp cooking oil",
                calories: 255,
                protein: 18,
                carbs: 1,
                fat: 20,
                classification: {
                  foodGroups: ["eggs", "fats_oils"],
                  ingredients: [
                    { name: "egg", evidence: "reported" },
                    { name: "cooking oil", evidence: "estimated" },
                  ],
                },
              },
            ],
          };
          let calls = 0;
          const saved = await runTurn(
            a,
            request,
            async (messages) => {
              calls++;
              if (calls === 1) {
                assert.match(
                  String(messages[0].content),
                  /save-first estimation/,
                );
                return {
                  role: "assistant",
                  content: "",
                  tool_calls: [call("food_journal", { from: date, to: date })],
                };
              }
              if (calls === 2)
                return {
                  role: "assistant",
                  content:
                    "I still need two details before saving: Did you eat the whole tray, and was the grilled meat chicken, pork, or another meat?",
                };
              assert.equal(calls, 3);
              assert.equal(messages.at(-1)?.role, "system");
              assert.match(
                String(messages.at(-1)?.content),
                /finish the authorised save/,
              );
              return {
                role: "assistant",
                content: "",
                tool_calls: [call("log_entry", { kind: "record_meal", meal })],
              };
            },
            hooks,
          );
          assert.equal(calls, 3);
          assert.equal(saved.proposals[0].status, "saved");
          assert.equal(saved.proposals[0].automatic, true);
          assert.match(saved.reply, /Saved to your journal/);
          const initial = await readJournal(a);
          assert.equal(initial.revision, 1);
          assert.equal(initial.state.nutrition.meals.length, 1);
          const entry = initial.state.nutrition.meals[0];
          assert.equal(entry.estimated, true);
          assert.equal(entry.items[1].portion, meal.items[1].portion);
          assert.deepEqual(entry.items[0].classification?.ingredients, []);
          assert.match(entry.notes, /Meat type unknown/);
          await runTurn(
            a,
            request,
            async () => {
              assert.fail("Retry must recover the existing saved turn");
            },
            hooks,
          );
          assert.equal((await readJournal(a)).revision, 1);
          const correction = await runTurn(
            a,
            input("I ate half the meat, keep the three eggs", 1),
            sequence(
              [call("food_journal", { from: date, to: date })],
              [
                call("log_entry", {
                  kind: "update_meal",
                  mealId: entry.id,
                  meal: {
                    ...meal,
                    items: [
                      {
                        ...meal.items[0],
                        portion: "Half the visible serving, estimated 75 g",
                        calories: 165,
                        protein: 17.5,
                        fat: 10.5,
                      },
                      meal.items[1],
                    ],
                  },
                }),
              ],
            ),
            hooks,
          );
          const updated = await readJournal(a);
          assert.equal(updated.state.nutrition.meals.length, 1);
          assert.equal(updated.state.nutrition.meals[0].id, entry.id);
          assert.deepEqual(
            updated.state.nutrition.meals[0].items[1],
            entry.items[1],
          );
          assert.equal(updated.state.nutrition.meals[0].items[0].calories, 165);
          await applyProposal(a, correction.proposals[0].id, true);
          assert.deepEqual(
            (await readJournal(a)).state.nutrition.meals,
            initial.state.nutrition.meals,
          );
        },
      );
      await t.test(
        "meal recovery is bounded and never enables auto-save for a reviewed client",
        async () => {
          for (const directLogging of [true, false]) {
            const a = await user();
            let calls = 0;
            const response = await runTurn(
              a,
              input("Also eat 3 fried eggs"),
              async () => {
                calls++;
                return {
                  role: "assistant",
                  content:
                    "Did you eat the whole tray? I need that before saving.",
                };
              },
              { directLogging },
            );
            assert.equal(calls, directLogging ? 2 : 1);
            assert.equal((await readJournal(a)).revision, 0);
            assert.equal(response.proposals.length, 0);
          }
        },
      );
      await t.test(
        "queued messages keep submission clock through a failed run and retry",
        async () => {
          const a = await user();
          const { localClock } = await import("../lib/agent/time-context");
          // Simulate time spent waiting; UTC yesterday is a distinct day when possible.
          const submittedAt = new Date(Date.now() - 23 * 3600000).toISOString();
          const request = {
            ...input("Log today's sleep"),
            timezone: "UTC",
            submittedAt,
          };
          const expected = localClock(submittedAt, request.timezone);
          let calls = 0;
          await assert.rejects(() =>
            runTurn(
              a,
              request,
              async (messages) => {
                assert.ok(String(messages[0].content).includes(expected.date));
                assert.ok(String(messages[0].content).includes(expected.time));
                calls++;
                throw Error("Synthetic provider interruption");
              },
              hooks,
            ),
          );
          await runTurn(
            a,
            { ...request, submittedAt: new Date().toISOString() },
            async (messages) => {
              assert.ok(String(messages[0].content).includes(expected.date));
              assert.ok(String(messages[0].content).includes(expected.time));
              calls++;
              return {
                role: "assistant",
                content: "How many hours did you sleep?",
              };
            },
            hooks,
          );
          assert.equal(calls, 2);
          assert.equal((await history(a))[0].createdAt, submittedAt);
          assert.equal((await readJournal(a)).revision, 0);
          for (const offset of [-25 * 3600000, 3600000]) {
            await assert.rejects(
              () =>
                runTurn(
                  a,
                  {
                    ...input(),
                    submittedAt: new Date(Date.now() + offset).toISOString(),
                  },
                  async () => {
                    assert.fail(
                      "Invalid queue time must not reach the provider",
                    );
                  },
                ),
              /out of date/,
            );
          }
        },
      );
      await t.test(
        "a multi-entry report saves once with an atomic receipt and Undo, including after reconnect",
        async () => {
          const a = await user(),
            b = await user(),
            request = input();
          const response = await runTurn(
            a,
            request,
            sequence(reads(), [
              call("log_entry", {
                kind: "record_bundle",
                entries: [food(), health, cardio],
              }),
            ]),
            hooks,
          );
          const saved = await readJournal(a);
          assert.equal(saved.revision, 1);
          assert.equal(saved.state.nutrition.meals.length, 1);
          assert.equal(saved.state.nutrition.meals[0].estimated, true);
          assert.equal(saved.state.health.checkins[0].sleepHours, 7.5);
          assert.equal(saved.state.cardio.sessions[0].distanceKm, 5);
          assert.equal(response.proposals[0].status, "saved");
          assert.equal(response.proposals[0].automatic, true);
          assert.equal(response.proposals[0].entries?.length, 3);
          assert.match(response.reply, /Saved to your journal/);
          assert.doesNotMatch(response.reply, /review|press.*save/i);
          assert.deepEqual(
            (await findTurn(a, request.id))?.proposals,
            response.proposals,
          );
          assert.equal(await findTurn(b, request.id), null);
          assert.equal((await history(b)).length, 0);
          assert.deepEqual(
            await runTurn(
              a,
              request,
              async () => {
                throw Error("No duplicate model call");
              },
              hooks,
            ),
            response,
          );
          const id = response.proposals[0].id;
          await assert.rejects(applyProposal(b, id, true), /expired/);
          // A stale/manual Save click on an already saved receipt is also idempotent.
          assert.equal((await applyProposal(a, id)).revision, 1);
          const undone = await applyProposal(a, id, true);
          assert.equal(undone.revision, 2);
          assert.equal(undone.state.nutrition.meals.length, 0);
          assert.equal(undone.state.health.checkins.length, 0);
          assert.equal(undone.state.cardio.sessions.length, 0);
          assert.equal((await applyProposal(a, id, true)).revision, 2);
          assert.equal(
            (await runTurn(a, request, sequence(), hooks)).proposals[0].status,
            "undone",
          );
          assert.equal((await readJournal(a)).revision, 2);
        },
      );
      await t.test(
        "same workout grows across messages and only finishes when requested",
        async () => {
          const a = await user();
          const workout = {
            title: "Gym",
            date,
            category: "open",
            exercises: [
              {
                exerciseId: "strict_press",
                sets: [{ weight: 40, reps: 8, result: "success" }],
              },
            ],
          };
          const workoutReads = [
            call("current_workout"),
            call("find_sessions", { from: date, to: date }),
          ];
          const progress = {
            kind: "log_workout_progress",
            workout,
            completion: "ongoing",
          };
          await runTurn(
            a,
            input("I did 40 kg strict press for 8 reps. More to come."),
            sequence(workoutReads, [call("log_entry", progress)]),
            hooks,
          );
          const first = await readJournal(a),
            workoutId = first.state.activeWorkout!.id;
          assert.equal(first.state.sessions.length, 0);
          await runTurn(
            a,
            input("Another set of 8 at 40 kg", 1),
            sequence(workoutReads, [call("log_entry", progress)]),
            hooks,
          );
          const next = await readJournal(a);
          assert.equal(next.state.activeWorkout!.id, workoutId);
          assert.equal(
            next.state.activeWorkout!.exercises[0].sets.filter((s) => s.result)
              .length,
            2,
          );
          const finished = await runTurn(
            a,
            input("I am finished with training today", 2),
            sequence(
              [call("current_workout")],
              [call("log_entry", { kind: "finish_workout" })],
            ),
            hooks,
          );
          assert.equal(finished.proposals[0].status, "saved");
          assert.equal((await readJournal(a)).state.sessions.length, 1);
          assert.equal((await readJournal(a)).state.activeWorkout, null);
        },
      );
      await t.test(
        "concurrent manual saves roll back the whole log; retrying the failed run is safe",
        async () => {
          const a = await user(),
            request = input("I slept 7.5 hours last night");
          let round = 0;
          await assert.rejects(
            runTurn(
              a,
              request,
              async () => {
                if (++round === 1)
                  return {
                    role: "assistant",
                    content: "",
                    tool_calls: [call("health_overview", { date })],
                  };
                const current = await readJournal(a);
                current.state.profile.bodyweight = 81;
                await writeJournal(a, {
                  ...current,
                  mutationId: crypto.randomUUID(),
                });
                return {
                  role: "assistant",
                  content: "",
                  tool_calls: [call("log_entry", health)],
                };
              },
              hooks,
            ),
            RevisionConflict,
          );
          assert.equal((await readJournal(a)).state.profile.bodyweight, 81);
          assert.equal((await readJournal(a)).state.health.checkins.length, 0);
          assert.equal((await findTurn(a, request.id))?.status, "failed");
          assert.equal(
            (
              await pool.query(
                "SELECT id FROM agent_proposals WHERE user_id=$1",
                [a],
              )
            ).rows.length,
            0,
          );
          const response = await runTurn(
            a,
            { ...request, revision: 1 },
            sequence(
              [call("health_overview", { date })],
              [call("log_entry", health)],
            ),
            hooks,
          );
          assert.equal(response.proposals[0].status, "saved");
          const current = await readJournal(a);
          current.state.profile.bodyweight = 82;
          await writeJournal(a, {
            ...current,
            mutationId: crypto.randomUUID(),
          });
          await assert.rejects(
            applyProposal(a, response.proposals[0].id, true),
            RevisionConflict,
          );
          assert.equal((await readJournal(a)).state.profile.bodyweight, 82);
        },
      );
      await t.test(
        "provider failure and cancellation before commit save nothing, and cancelled runs can retry",
        async () => {
          const a = await user(),
            request = input();
          await assert.rejects(
            runTurn(
              a,
              request,
              async () => {
                throw Error("Provider unavailable");
              },
              hooks,
            ),
          );
          const abort = new AbortController();
          await assert.rejects(
            runTurn(
              a,
              request,
              sequence(
                [call("health_overview", { date })],
                [call("log_entry", health)],
              ),
              {
                ...hooks,
                signal: abort.signal,
                emit(event) {
                  if (
                    event.type === "STEP_FINISHED" &&
                    (event as { stepName?: string }).stepName ===
                      "Saving your journal entry"
                  )
                    abort.abort();
                },
              },
            ),
          );
          assert.equal((await readJournal(a)).revision, 0);
          assert.equal(
            (
              await pool.query(
                "SELECT id FROM agent_proposals WHERE user_id=$1",
                [a],
              )
            ).rows.length,
            0,
          );
          await runTurn(
            a,
            request,
            sequence(
              [call("health_overview", { date })],
              [call("log_entry", health)],
            ),
            hooks,
          );
          assert.equal((await readJournal(a)).revision, 1);
        },
      );
      await t.test(
        "preview remains unsaved, old clients cannot execute log_entry, and it cannot delete or set targets",
        async () => {
          const a = await user();
          const preview = await runTurn(
            a,
            input("Prepare my sleep for review without saving"),
            sequence(
              [call("health_overview", { date })],
              [call("prepare_change", health)],
            ),
            hooks,
          );
          assert.equal(preview.proposals[0].status, undefined);
          assert.equal((await readJournal(a)).revision, 0);
          await runTurn(
            a,
            input(),
            sequence(reads(), [call("log_entry", health)]),
          );
          for (const action of [
            { kind: "delete_cardio", cardioId: crypto.randomUUID() },
            { kind: "set_pb", exerciseId: "strict_press", weight: 100 },
          ])
            await runTurn(
              a,
              input(),
              sequence(reads(), [call("log_entry", action)]),
              hooks,
            );
          assert.equal((await readJournal(a)).revision, 0);
        },
      );
      await t.test(
        "food reads and ownership are required, source photos stay linked, corrections do not duplicate",
        async () => {
          const a = await user(),
            b = await user();
          const pixels = await sharp({
            create: {
              width: 24,
              height: 24,
              channels: 3,
              background: "#ffffff",
            },
          })
            .jpeg()
            .toBuffer();
          const upload = async (owner: string, category: "food" | "sleep") => {
            const image = await saveUserImage(owner, {
              id: crypto.randomUUID(),
              date,
              label: "Synthetic photo",
              image: pixels.toString("base64"),
            });
            return patchUserImage(owner, image.id, {
              category,
              tags: [],
              version: image.version,
            });
          };
          const image = await upload(a, "food"),
            foreign = await upload(b, "food"),
            sleep = await upload(a, "sleep");
          await runTurn(
            a,
            input(),
            sequence([call("log_entry", food())]),
            hooks,
          );
          assert.equal(
            (await readJournal(a)).revision,
            0,
            "new meals require reading that date first",
          );
          await assert.rejects(
            runTurn(
              a,
              { ...input(), photoIds: [foreign.id] },
              sequence(),
              hooks,
            ),
          );
          await runTurn(
            a,
            { ...input(), photoIds: [sleep.id] },
            sequence(reads(), [call("log_entry", food([sleep.id]))]),
            hooks,
          );
          assert.equal(
            (await readJournal(a)).revision,
            0,
            "sleep photos cannot be logged as food",
          );
          const request = {
            ...input("Log this coffee photo"),
            photoIds: [image.id],
          };
          const result = await runTurn(
            a,
            request,
            sequence(reads(), [call("log_entry", food([image.id]))]),
            hooks,
          );
          const meal = result.proposals[0].meal!;
          assert.deepEqual(meal.photoIds, [image.id]);
          assert.equal(meal.estimated, true);
          const corrected = {
            ...food([image.id]).meal,
            name: "Coffee with corrected portion",
          };
          await runTurn(
            a,
            input("Correct the coffee name", 1),
            sequence(
              [call("food_journal", { from: date, to: date })],
              [
                call("log_entry", {
                  kind: "update_meal",
                  mealId: meal.id,
                  meal: corrected,
                }),
              ],
            ),
            hooks,
          );
          const snapshot = await readJournal(a);
          assert.equal(snapshot.state.nutrition.meals.length, 1);
          assert.equal(snapshot.state.nutrition.meals[0].id, meal.id);
          assert.deepEqual(snapshot.state.nutrition.meals[0].photoIds, [
            image.id,
          ]);
        },
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [
        accounts,
      ]);
      await pool.end();
    }
  },
);
