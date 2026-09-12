import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "Coach receives local request, original-message and image times while retaining editable meal categories",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    t.mock.timers.enable({
      apis: ["Date"],
      now: new Date("2026-09-08T18:30:00Z"),
    });
    const { getPool } = await import("../lib/db");
    const { saveUserImage, patchUserImage } =
      await import("../lib/user-images");
    const { runTurn, applyProposal } = await import("../lib/agent/engine");
    const { readJournal } = await import("../lib/server");
    const pool = getPool(),
      owner = crypto.randomUUID();
    try {
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Meal time test',$1||'@example.test',true)",
        [owner],
      );
      const pixels = (
        await sharp({
          create: { width: 48, height: 48, channels: 3, background: "#e8d9ba" },
        })
          .jpeg()
          .toBuffer()
      ).toString("base64");
      const photos: string[] = [];
      for (const date of ["2026-09-08", "2026-09-07"]) {
        const p = await saveUserImage(owner, {
          id: crypto.randomUUID(),
          date,
          label: "Synthetic food photo",
          image: pixels,
        });
        await patchUserImage(owner, p.id, {
          category: "food",
          tags: [],
          version: p.version,
        });
        await pool.query(
          "UPDATE food_photos SET created_at=$1 WHERE id=$2 AND user_id=$3",
          ["2026-09-08T06:15:00Z", p.id, owner],
        );
        photos.push(p.id);
      }
      await pool.query(
        "INSERT INTO agent_turns(id,user_id,question,photo_ids,status,response,created_at) VALUES($1,$2,$3,$4,'done',$5,$6)",
        [
          crypto.randomUUID(),
          owner,
          "Estimate this food photo and prepare an entry.",
          JSON.stringify([photos[0]]),
          JSON.stringify({ reply: "An earlier food request.", proposals: [] }),
          "2026-09-08T06:15:00Z",
        ],
      );
      const tool = (
        name: string,
        args: Record<string, unknown>,
      ): ModelMessage => ({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name, arguments: args } }],
      });
      let round = 0;
      const response = await runTurn(
        owner,
        {
          id: crypto.randomUUID(),
          message: "Log the oats and coffee I sent this morning.",
          photoIds: [],
          revision: 0,
          timezone: "Europe/Copenhagen",
        },
        async (messages) => {
          if (round++ === 0) {
            assert.match(messages[0].content, /local request time is 20:30/);
            const earlier = messages.find((m) =>
              m.content.startsWith("Earlier message sent at"),
            )!;
            assert.match(
              earlier.content,
              /"date":"2026-09-08","time":"08:15","timezone":"Europe\/Copenhagen"/,
            );
            assert.equal(
              messages.some((m) => m.images?.length),
              false,
            );
            return tool("food_photos", {
              from: "2026-09-07",
              to: "2026-09-08",
            });
          }
          if (round === 2) {
            const catalog = JSON.parse(messages.at(-1)!.content).photos;
            assert.equal(
              catalog.find((p: { id: string }) => p.id === photos[0])
                .mealTimeHint,
              "08:15",
            );
            assert.equal(
              catalog.find((p: { id: string }) => p.id === photos[1])
                .mealTimeHint,
              null,
            );
            return tool("inspect_images", { imageIds: [photos[0]] });
          }
          assert.match(messages.at(-1)!.content, /"mealTimeHint":"08:15"/);
          assert.ok(messages.at(-1)!.images?.length);
          return tool("prepare_change", {
            kind: "record_meal",
            meal: {
              date: "2026-09-08",
              name: "Oats and coffee",
              type: "breakfast",
              source: "photo",
              estimated: true,
              photoIds: [photos[0]],
              notes:
                "Breakfast inferred from the original morning request and foods; editable in the food journal.",
              items: [
                {
                  name: "Oats",
                  portion: "Estimated bowl",
                  calories: 200,
                  protein: 6,
                  carbs: 34,
                  fat: 4,
                  classification: {
                    foodGroups: ["grains"],
                    ingredients: [{ name: "oats", evidence: "visible" }],
                  },
                },
              ],
            },
          });
        },
      );
      assert.equal(response.proposals.length, 1);
      const review = response.proposals[0];
      assert.equal(review.meal?.type, "breakfast");
      assert.equal((await readJournal(owner)).state.nutrition.meals.length, 0);
      const saved = await applyProposal(owner, review.id);
      assert.equal(saved.state.nutrition.meals[0].type, "breakfast");
      // Existing meal categories survive later corrections made at another hour.
      round = 0;
      const corrected = await runTurn(
        owner,
        {
          id: crypto.randomUUID(),
          message:
            "It was a late breakfast. Keep breakfast and correct the oats to 180 kcal.",
          photoIds: [],
          revision: saved.revision,
          timezone: "Europe/Copenhagen",
        },
        async () =>
          round++ === 0
            ? tool("food_journal", { from: "2026-09-08", to: "2026-09-08" })
            : tool("prepare_change", {
                kind: "update_meal",
                mealId: review.meal!.id,
                meal: {
                  date: "2026-09-08",
                  name: "Oats and coffee",
                  type: "breakfast",
                  source: "photo",
                  estimated: true,
                  photoIds: [photos[0]],
                  notes: "User confirmed late breakfast.",
                  items: [{ ...review.meal!.items[0], calories: 180 }],
                },
              }),
      );
      assert.equal(corrected.proposals[0].meal?.type, "breakfast");
      assert.equal(corrected.proposals[0].meal?.items[0].calories, 180);
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [owner]);
      await pool.end();
      t.mock.timers.reset();
    }
  },
);
