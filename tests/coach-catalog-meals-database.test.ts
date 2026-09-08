import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "Coach logs inspected catalog food photos with review, source links and account isolation",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { saveUserImage, patchUserImage, deleteUserImage } =
      await import("../lib/user-images");
    const { runTurn, applyProposal, history } =
      await import("../lib/agent/engine");
    const { readJournal } = await import("../lib/server");
    const pool = getPool();
    const [owner, other] = [crypto.randomUUID(), crypto.randomUUID()];
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Catalog test',$1||'@example.test',true),($2,'Catalog test',$2||'@example.test',true)",
      [owner, other],
    );
    try {
      const date = "2026-09-08";
      const pixels = await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#cba876" },
      })
        .jpeg()
        .toBuffer();
      const photo = async (
        category: "food" | "sleep" = "food",
        user = owner,
      ) => {
        const saved = await saveUserImage(user, {
          id: crypto.randomUUID(),
          date,
          label: "Synthetic catalog image",
          image: pixels.toString("base64"),
        });
        return patchUserImage(user, saved.id, {
          category,
          tags: [],
          version: saved.version,
        });
      };
      const meal = (id: string) => ({
        date,
        name: "Breakfast from saved photo",
        type: "breakfast",
        source: "photo",
        estimated: true,
        photoIds: [id],
        notes: "Synthetic estimate; portion reported by the user.",
        items: [
          {
            name: "Oats",
            portion: "40 g dry",
            calories: 150,
            protein: 5,
            carbs: 27,
            fat: 3,
            classification: {
              foodGroups: ["grains"],
              ingredients: [{ name: "oats", evidence: "visible" }],
            },
          },
        ],
      });
      const tool = (
        name: string,
        args: Record<string, unknown>,
      ): ModelMessage => ({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name, arguments: args } }],
      });
      const batch = (...messages: ModelMessage[]): ModelMessage => ({
        role: "assistant",
        content: "",
        tool_calls: messages.flatMap((m) => m.tool_calls ?? []),
      });
      const done: ModelMessage = {
        role: "assistant",
        content: "No change prepared.",
      };
      const run = async (
        model: Parameters<typeof runTurn>[2],
        events: unknown[] = [],
      ) =>
        runTurn(
          owner,
          {
            id: crypto.randomUUID(),
            message: "Log breakfast from the saved food photo for 8 September.",
            revision: (await readJournal(owner)).revision,
            timezone: "Europe/Copenhagen",
            photoIds: [],
          },
          model,
          { emit: (event) => events.push(event) },
        );

      await t.test(
        "catalog lookup → inspection → review → correction → save, update and undo",
        async () => {
          const source = await photo();
          let round = 0;
          const events: unknown[] = [];
          const response = await run(async (messages) => {
            if (round++ === 0)
              return batch(
                tool("food_journal", { from: date, to: date }),
                tool("food_photos", { from: date, to: date }),
              );
            if (round === 2) {
              assert.equal(
                messages.some((m) => m.images?.length),
                false,
              );
              assert.match(messages.at(-1)!.content, new RegExp(source.id));
              return tool("inspect_images", { imageIds: [source.id] });
            }
            assert.equal(messages.filter((m) => m.images?.length).length, 1);
            assert.match(messages.at(-1)!.content, new RegExp(source.id));
            return tool("prepare_change", {
              kind: "record_meal",
              meal: meal(source.id),
            });
          }, events);
          assert.equal(response.proposals.length, 1);
          assert.deepEqual(response.proposals[0].meal?.photoIds, [source.id]);
          assert.equal(
            (await readJournal(owner)).state.nutrition.meals.length,
            0,
          );
          assert.deepEqual((await history(owner)).at(-1)?.photoIds, []);
          assert.doesNotMatch(JSON.stringify(events), /data:image|base64/);
          assert.doesNotMatch(
            JSON.stringify(await history(owner)),
            /"images":/,
          );

          // A follow-up correction retains the inspected source without another upload/read.
          const correction = await run(async (messages) => {
            assert.equal(
              messages.some((m) => m.images?.length),
              false,
            );
            return tool("prepare_change", {
              kind: "record_meal",
              meal: {
                ...meal(source.id),
                notes: "Corrected portion estimate.",
              },
            });
          });
          assert.equal(correction.proposals.length, 1);
          const review = correction.proposals[0];
          await assert.rejects(applyProposal(other, review.id), /expired/);
          const saved = await applyProposal(owner, review.id);
          assert.equal(saved.state.nutrition.meals.length, 1);
          assert.deepEqual(saved.state.nutrition.meals[0].photoIds, [
            source.id,
          ]);
          assert.equal(
            (await applyProposal(owner, review.id)).revision,
            saved.revision,
          );

          const additional = await photo();
          round = 0;
          const updated = await run(async () =>
            round++ === 0
              ? batch(
                  tool("food_journal", { from: date, to: date }),
                  tool("inspect_images", { imageIds: [additional.id] }),
                )
              : tool("prepare_change", {
                  kind: "update_meal",
                  mealId: review.meal!.id,
                  meal: {
                    ...meal(source.id),
                    photoIds: [source.id, additional.id],
                  },
                }),
          );
          assert.equal(updated.proposals.length, 1);
          const changed = await applyProposal(owner, updated.proposals[0].id);
          assert.equal(changed.state.nutrition.meals.length, 1);
          assert.deepEqual(changed.state.nutrition.meals[0].photoIds, [
            source.id,
            additional.id,
          ]);
          const undone = await applyProposal(
            owner,
            updated.proposals[0].id,
            true,
          );
          assert.deepEqual(undone.state.nutrition.meals[0].photoIds, [
            source.id,
          ]);
          assert.equal(
            (await readJournal(other)).state.nutrition.meals.length,
            0,
          );
        },
      );

      await t.test(
        "metadata and gallery display alone cannot authorize a photo meal; the tool explains recovery",
        async () => {
          for (const lookup of ["food_photos", "show_images"]) {
            const source = await photo();
            let round = 0;
            const response = await run(async (messages) => {
              assert.equal(
                messages.some((m) => m.images?.length),
                false,
              );
              if (round++ === 0)
                return tool(
                  lookup,
                  lookup === "show_images"
                    ? { title: "Saved breakfast", imageIds: [source.id] }
                    : { from: date, to: date },
                );
              if (round === 2)
                return tool("prepare_change", {
                  kind: "record_meal",
                  meal: meal(source.id),
                });
              assert.match(
                messages.at(-1)!.content,
                /call inspect_images.*no re-upload/,
              );
              return done;
            });
            assert.equal(response.proposals.length, 0);
          }
        },
      );

      await t.test(
        "same-batch inspection is rejected, then succeeds once the pixels have been read",
        async () => {
          const source = await photo();
          let round = 0;
          const response = await run(async (messages) => {
            if (round++ === 0)
              return batch(
                tool("inspect_images", { imageIds: [source.id] }),
                tool("prepare_change", {
                  kind: "record_meal",
                  meal: meal(source.id),
                }),
              );
            assert.match(
              messages.filter((m) => m.role === "tool").at(-1)!.content,
              /call inspect_images/,
            );
            assert.equal(
              messages.some((m) => m.images?.length),
              true,
            );
            return tool("prepare_change", {
              kind: "record_meal",
              meal: meal(source.id),
            });
          });
          assert.equal(response.proposals.length, 1);
        },
      );

      await t.test(
        "inspected food sources remain linked, including atomic meal bundles",
        async () => {
          const source = await photo();
          let round = 0;
          const response = await run(async (messages) => {
            if (round++ === 0)
              return tool("inspect_images", { imageIds: [source.id] });
            if (round === 2)
              return tool("prepare_change", {
                kind: "record_meal",
                meal: { ...meal(source.id), photoIds: [], source: "text" },
              });
            assert.match(
              messages.at(-1)!.content,
              /must link its source photo/,
            );
            return tool("prepare_change", {
              kind: "record_bundle",
              entries: [
                { kind: "record_meal", meal: meal(source.id) },
                {
                  kind: "record_meal",
                  meal: {
                    ...meal(source.id),
                    name: "Reported snack",
                    type: "snack",
                    photoIds: [],
                    source: "text",
                    items: [
                      {
                        ...meal(source.id).items[0],
                        classification: {
                          foodGroups: ["grains"],
                          ingredients: [{ name: "oats", evidence: "reported" }],
                        },
                      },
                    ],
                  },
                },
              ],
            });
          });
          assert.equal(response.proposals.length, 1);
          assert.equal(response.proposals[0].entries?.length, 2);
          assert.deepEqual(response.proposals[0].entries?.[0].meal?.photoIds, [
            source.id,
          ]);
          assert.deepEqual(
            response.proposals[0].entries?.[1].meal?.photoIds,
            [],
          );
        },
      );

      await t.test(
        "foreign, non-food, deleted and recategorised images cannot become meal sources",
        async () => {
          for (const failure of [
            "foreign",
            "sleep",
            "deleted",
            "recategorised",
          ]) {
            const source = await photo(
              failure === "sleep" ? "sleep" : "food",
              failure === "foreign" ? other : owner,
            );
            let round = 0;
            const response = await run(async (messages) => {
              if (round++ === 0)
                return tool("inspect_images", { imageIds: [source.id] });
              if (round === 2) {
                if (failure === "foreign") {
                  assert.match(
                    messages.at(-1)!.content,
                    /not found in your library/,
                  );
                  assert.equal(
                    messages.some((m) => m.images?.length),
                    false,
                  );
                }
                if (failure === "deleted")
                  await deleteUserImage(owner, source.id);
                if (failure === "recategorised")
                  await patchUserImage(owner, source.id, {
                    category: "sleep",
                    tags: [],
                    version: source.version,
                  });
                return tool("prepare_change", {
                  kind: "record_meal",
                  meal: meal(source.id),
                });
              }
              assert.match(
                messages.at(-1)!.content,
                failure === "foreign"
                  ? /call inspect_images/
                  : failure === "deleted"
                    ? /not found in your library/
                    : /Only images categorised as Food/,
              );
              return done;
            });
            assert.equal(response.proposals.length, 0, failure);
          }
        },
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [
        [owner, other],
      ]);
      await pool.end();
    }
  },
);
