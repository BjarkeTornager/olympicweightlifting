import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { mealSchema, foodClassificationSchema } from "../lib/nutrition";
import { today } from "../lib/domain";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
test(
  "Food tags: private Coach filters, reviewed classification save/undo and cached-client retry compatibility",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { readJournal, writeJournal } = await import("../lib/server"),
      { runTurn, applyProposal } = await import("../lib/agent/engine");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      date = today();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic','tags-'||$1||'@example.test',true),($2,'Synthetic','tags-'||$2||'@example.test',true)",
      [a, b],
    );
    const meal = mealSchema.parse({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date,
      type: "dinner",
      name: "Synthetic rice",
      source: "manual",
      estimated: false,
      items: [
        {
          name: "Rice",
          portion: "1 bowl",
          calories: 200,
          protein: 4,
          carbs: 40,
          fat: 1,
        },
      ],
    });
    const tags = {
      foodGroups: ["grains"],
      ingredients: [{ name: "rice", evidence: "reported" }],
    } as const;
    const input = (revision: number) => ({
      id: crypto.randomUUID(),
      revision,
      message: "Add rice as a reported ingredient to my dinner.",
      timezone: "Europe/Copenhagen",
    });
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
    try {
      const initial = await readJournal(a);
      initial.state.nutrition.meals = [meal];
      const originalInput = { ...initial, mutationId: crypto.randomUUID() };
      let saved = await writeJournal(a, originalInput);
      const { id, createdAt: _, ...detail } = meal;
      void _;
      const action = {
        kind: "update_meal",
        mealId: id,
        meal: {
          ...detail,
          items: [{ ...meal.items[0], classification: tags }],
        },
      };
      let round = 0;
      const proposed = await runTurn(
        a,
        input(saved.revision),
        async (messages) => {
          if (++round === 1) return tool("prepare_change", action);
          if (round === 2) {
            assert.match(
              messages.at(-1)!.content,
              /Read the full original meal/,
            );
            return tool("food_journal", {
              from: date,
              to: date,
              mealType: "dinner",
            });
          }
          if (round === 3) {
            const result = JSON.parse(messages.at(-1)!.content);
            assert.equal(result.totalMeals, 1);
            assert.equal(result.meals[0].id, id);
            return tool("prepare_change", action);
          }
          return done;
        },
      );
      assert.equal(proposed.proposals.length, 1);
      assert.equal(
        (await readJournal(a)).state.nutrition.meals[0].items[0].classification,
        undefined,
      );
      await assert.rejects(
        applyProposal(b, proposed.proposals[0].id),
        /expired/,
      );
      saved = await applyProposal(a, proposed.proposals[0].id);
      assert.deepEqual(
        saved.state.nutrition.meals[0].items[0].classification,
        tags,
      );
      for (const user of [a, b]) {
        let step = 0;
        await runTurn(
          user,
          input(user === a ? saved.revision : 0),
          async (messages) => {
            if (++step === 1)
              return tool("food_journal", {
                from: date,
                to: date,
                mealType: "dinner",
                ingredient: "RICE",
                foodGroup: "grains",
              });
            const result = JSON.parse(messages.at(-1)!.content);
            assert.equal(result.totalMeals, user === a ? 1 : 0);
            assert.equal(result.totals.calories, user === a ? 200 : 0);
            assert.equal(result.meals.length, user === a ? 1 : 0);
            return done;
          },
        );
      }
      saved = await applyProposal(a, proposed.proposals[0].id, true);
      assert.equal(
        saved.state.nutrition.meals[0].items[0].classification,
        undefined,
        "undo restores unknown metadata exactly",
      );
      saved.state.nutrition.meals[0].items[0].classification =
        foodClassificationSchema.parse(tags);
      saved = await writeJournal(a, {
        ...saved,
        mutationId: crypto.randomUUID(),
      });
      const older = structuredClone(saved.state);
      delete older.nutrition.meals[0].items[0].classification;
      older.profile.bodyweight = 90;
      const legacyInput = {
        state: older,
        revision: saved.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingFoodTags: true,
      };
      saved = await writeJournal(a, legacyInput);
      assert.deepEqual(
        saved.state.nutrition.meals[0].items[0].classification,
        tags,
      );
      assert.equal(
        (await writeJournal(a, legacyInput)).revision,
        saved.revision,
      );
      assert.equal(
        (await writeJournal(a, originalInput)).revision,
        saved.revision,
        "pre-tags acknowledgement can be retried after rollout",
      );
      saved.state.nutrition.meals[0].items[0].classification = {
        foodGroups: [],
        ingredients: [],
      };
      saved = await writeJournal(a, {
        ...saved,
        mutationId: crypto.randomUUID(),
        preserveMissingFoodTags: true,
      });
      assert.deepEqual(saved.state.nutrition.meals[0].items[0].classification, {
        foodGroups: [],
        ingredients: [],
      });
      assert.equal(saved.state.profile.bodyweight, 90);
      assert.equal((await readJournal(b)).state.nutrition.meals.length, 0);
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
