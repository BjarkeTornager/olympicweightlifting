import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelResponse } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

const date = "2026-09-08";
const call = (name: string, args: Record<string, unknown> = {}) => ({
  function: { name, arguments: args },
});
const tools = (...calls: ReturnType<typeof call>[]): ModelResponse => ({
  role: "assistant",
  content: "",
  tool_calls: calls,
});

test(
  "a save from elsewhere during a Coach turn no longer throws the reply away",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn, findTurn } = await import("../lib/agent/engine"),
      { readJournal, writeJournal, RevisionConflict } =
        await import("../lib/server"),
      { saveCardio } = await import("../lib/cardio");
    const pool = getPool(),
      accounts: string[] = [];
    const user = async () => {
      const id = crypto.randomUUID();
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','commit-'||$1||'@example.test',true)",
        [id],
      );
      return id;
    };
    const input = async (userId: string, message: string) => ({
      id: crypto.randomUUID(),
      message,
      revision: (await readJournal(userId)).revision,
      timezone: "Europe/Copenhagen",
    });
    // What a voice call or the phone saving at the same moment does.
    const saveElsewhere = async (
      userId: string,
      change: (state: Awaited<ReturnType<typeof readJournal>>["state"]) => void,
    ) => {
      const current = await readJournal(userId);
      change(current.state);
      await writeJournal(userId, {
        ...current,
        mutationId: crypto.randomUUID(),
      });
    };
    const hooks = { directLogging: true };
    try {
      await t.test(
        "the change is made on top of the newer journal, without another model call",
        async () => {
          const a = await user(),
            request = await input(a, "I slept 7.5 hours last night");
          const checkin = {
            kind: "record_checkin",
            checkin: { date, sleepHours: 7.5 },
          };
          let calls = 0;
          const response = await runTurn(
            a,
            request,
            async () => {
              if (++calls === 1)
                return tools(call("health_overview", { date }));
              await saveElsewhere(a, (state) => {
                state.profile.bodyweight = 81;
              });
              return tools(call("log_entry", checkin));
            },
            hooks,
          );
          assert.equal(calls, 2, "the commit made no model call");
          assert.match(response.reply, /^Saved to your journal/);
          const journal = await readJournal(a);
          assert.equal(journal.revision, 2);
          assert.equal(journal.state.profile.bodyweight, 81);
          assert.equal(journal.state.health.checkins[0].sleepHours, 7.5);

          const {
            rows: [proposal],
          } = await pool.query(
            "SELECT revision, before_state, after_state, preview, requested, status FROM agent_proposals WHERE turn_id=$1",
            [request.id],
          );
          assert.equal(proposal.status, "saved");
          // Undo goes back to the other save, not to before it.
          assert.equal(proposal.revision, 1);
          assert.equal(proposal.before_state.profile.bodyweight, 81);
          assert.equal(proposal.before_state.health.checkins.length, 0);
          assert.equal(proposal.after_state.profile.bodyweight, 81);
          assert.deepEqual(
            proposal.after_state.health,
            JSON.parse(JSON.stringify(journal.state.health)),
          );
          // Kept, so the change can be made again without the model.
          assert.deepEqual(proposal.requested, {
            action: checkin,
            date: proposal.requested.date,
          });
          assert.match(proposal.requested.date, /^\d{4}-\d{2}-\d{2}$/);
          assert.deepEqual(proposal.preview, response.proposals[0]);
          assert.deepEqual(
            (await findTurn(a, request.id))?.proposals,
            response.proposals,
          );
          // Sending the same message again returns the saved reply.
          assert.deepEqual(
            await runTurn(
              a,
              request,
              async () => {
                throw Error("A retry must reuse the saved reply");
              },
              hooks,
            ),
            response,
          );
        },
      );
      await t.test(
        "a change that no longer applies isn't forced: nothing is saved and the conflict is reported",
        async () => {
          const a = await user();
          const logged = await runTurn(
            a,
            await input(a, "I ran 5 km in 28 minutes"),
            (() => {
              let round = 0;
              return async () =>
                ++round === 1
                  ? tools(call("cardio_journal", { from: date, to: date }))
                  : tools(
                      call("log_entry", {
                        kind: "record_cardio",
                        cardio: {
                          date,
                          activity: "running",
                          durationSeconds: 1680,
                          distanceKm: 5,
                        },
                      }),
                    );
            })(),
            hooks,
          );
          const cardioId = logged.proposals[0].cardio!.id;
          const request = await input(a, "That run was 5.2 km");
          let round = 0;
          await assert.rejects(
            runTurn(
              a,
              request,
              async () => {
                if (++round === 1)
                  return tools(
                    call("cardio_journal", { from: date, to: date }),
                  );
                // The athlete deletes the run on the phone meanwhile.
                await saveElsewhere(a, (state) => {
                  state.cardio.sessions = [];
                });
                return tools(
                  call("log_entry", {
                    kind: "update_cardio",
                    cardioId,
                    changes: { distanceKm: 5.2 },
                  }),
                );
              },
              hooks,
            ),
            RevisionConflict,
          );
          assert.equal(
            (await readJournal(a)).state.cardio.sessions.length,
            0,
            "the deleted run isn't brought back",
          );
          assert.equal((await findTurn(a, request.id))?.status, "failed");
          assert.equal(
            (
              await pool.query(
                "SELECT id FROM agent_proposals WHERE turn_id=$1",
                [request.id],
              )
            ).rows.length,
            0,
          );
        },
      );
      const proposalsFor = async (turnId: string) =>
        (
          await pool.query("SELECT id FROM agent_proposals WHERE turn_id=$1", [
            turnId,
          ])
        ).rows.length;
      await t.test(
        "a run Health imports for the same day meanwhile isn't logged twice: the conflict is reported",
        async () => {
          const run = {
            date,
            activity: "running",
            durationSeconds: 1500,
            distanceKm: 5,
          };
          // What opening the iPhone app does while Coach answers: import the
          // Watch's activities.
          const logRun = async (imported: typeof run) => {
            const a = await user(),
              request = await input(a, "Just ran 5k in 25 min");
            let round = 0;
            const result = runTurn(
              a,
              request,
              async () => {
                if (++round === 1)
                  return tools(
                    call("cardio_journal", { from: date, to: date }),
                  );
                await saveElsewhere(a, (state) => {
                  saveCardio(state, imported, date);
                });
                return tools(
                  call("log_entry", { kind: "record_cardio", cardio: run }),
                );
              },
              hooks,
            );
            return { a, request, result };
          };
          // A walk from the day before doesn't touch this run: it is saved.
          const walk = await logRun({
            date: "2026-09-07",
            activity: "walking",
            durationSeconds: 1800,
            distanceKm: 2.5,
          });
          assert.equal((await walk.result).proposals[0].status, "saved");
          let journal = await readJournal(walk.a);
          assert.equal(journal.revision, 2);
          assert.equal(journal.state.cardio.sessions.length, 2);

          // The Watch's record of this very run: saving Coach's too would
          // log it twice.
          const same = await logRun(run);
          await assert.rejects(same.result, RevisionConflict);
          journal = await readJournal(same.a);
          assert.equal(journal.revision, 1, "only the import was saved");
          assert.equal(journal.state.cardio.sessions.length, 1);
          assert.equal(
            (await findTurn(same.a, same.request.id))?.status,
            "failed",
          );
          assert.equal(await proposalsFor(same.request.id), 0);
        },
      );
      await t.test(
        "a meal edited elsewhere meanwhile isn't overwritten: the conflict is reported",
        async () => {
          const a = await user();
          const meal = (day: string, name: string) => ({
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            date: day,
            name,
            type: "lunch" as const,
            items: [
              {
                name,
                portion: "1 bowl",
                calories: 500,
                protein: 30,
                carbs: 50,
                fat: 15,
              },
            ],
            source: "text" as const,
            estimated: true,
            notes: "",
            photoIds: [],
          });
          const lunch = meal(date, "Chicken salad"),
            yesterday = meal("2026-09-07", "Pasta");
          await saveElsewhere(a, (state) => {
            state.nutrition.meals.push(lunch, yesterday);
          });
          const correct = (
            request: Awaited<ReturnType<typeof input>>,
            phoneEdit: (meals: (typeof lunch)[]) => void,
          ) => {
            let round = 0;
            return runTurn(
              a,
              request,
              async () => {
                if (++round === 1)
                  return tools(call("food_journal", { from: date, to: date }));
                // The athlete edits a meal in Food on the phone meanwhile.
                await saveElsewhere(a, (state) =>
                  phoneEdit(state.nutrition.meals as (typeof lunch)[]),
                );
                const { id, createdAt, ...fields } = lunch;
                void id;
                void createdAt;
                return tools(
                  call("log_entry", {
                    kind: "update_meal",
                    mealId: lunch.id,
                    meal: {
                      ...fields,
                      items: [{ ...lunch.items[0], calories: 600 }],
                    },
                  }),
                );
              },
              hooks,
            );
          };
          // An edit to another day's meal doesn't touch this one: saved.
          const first = await input(a, "Make that lunch 600 kcal");
          await correct(first, (meals) => {
            meals.find((m) => m.id === yesterday.id)!.name = "Pasta bake";
          });
          let meals = (await readJournal(a)).state.nutrition.meals;
          assert.equal(
            meals.find((m) => m.id === lunch.id)?.items[0].calories,
            600,
          );
          assert.equal(
            meals.find((m) => m.id === yesterday.id)?.name,
            "Pasta bake",
          );

          // An edit to this lunch: Coach's whole-meal update would undo it.
          const second = await input(a, "Make that lunch 600 kcal");
          const before = (await readJournal(a)).revision;
          await assert.rejects(
            correct(second, (meals) => {
              meals.find((m) => m.id === lunch.id)!.name = "Caesar salad";
            }),
            RevisionConflict,
          );
          const journal = await readJournal(a);
          assert.equal(journal.revision, before + 1, "only the phone's edit");
          meals = journal.state.nutrition.meals;
          assert.equal(
            meals.find((m) => m.id === lunch.id)?.name,
            "Caesar salad",
          );
          assert.equal((await findTurn(a, second.id))?.status, "failed");
          assert.equal(await proposalsFor(second.id), 0);
        },
      );
      await t.test(
        "COACH_SAVE_RETRY=0 switches it off: the conflict is reported",
        async () => {
          const a = await user(),
            request = await input(a, "I slept 7.5 hours last night");
          let round = 0;
          process.env.COACH_SAVE_RETRY = "0";
          try {
            await assert.rejects(
              runTurn(
                a,
                request,
                async () => {
                  if (++round === 1)
                    return tools(call("health_overview", { date }));
                  await saveElsewhere(a, (state) => {
                    state.profile.bodyweight = 81;
                  });
                  return tools(
                    call("log_entry", {
                      kind: "record_checkin",
                      checkin: { date, sleepHours: 7.5 },
                    }),
                  );
                },
                hooks,
              ),
              RevisionConflict,
            );
          } finally {
            delete process.env.COACH_SAVE_RETRY;
          }
          const journal = await readJournal(a);
          assert.equal(journal.revision, 1);
          assert.equal(journal.state.health.checkins.length, 0);
          assert.equal(await proposalsFor(request.id), 0);
        },
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1)", [accounts]);
      await pool.end();
    }
  },
);
