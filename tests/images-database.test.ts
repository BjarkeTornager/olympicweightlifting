import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
const response = (category: string, confidence = "high"): ModelMessage => ({
  role: "assistant",
  content: "",
  tool_calls: [
    {
      function: {
        name: "classify_image",
        arguments: { category, confidence, tags: [category, "screenshot"] },
      },
    },
  ],
});
test(
  "images: automatic sorting, failures, ownership, manual precedence and meal isolation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const {
      saveUserImage,
      patchUserImage,
      tagUserImage,
      listUserImages,
      readUserImage,
    } = await import("../lib/user-images");
    const { listFoodPhotos } = await import("../lib/food-photos");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { runTurn, applyProposal } = await import("../lib/agent/engine");
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const pool = getPool();
    for (const id of ids)
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Image test',$1||'@example.test',true)",
        [id],
      );
    try {
      const image = (
        await sharp({
          create: { width: 64, height: 80, channels: 3, background: "#b9acd1" },
        })
          .png()
          .toBuffer()
      ).toString("base64");
      const input = {
        id: crypto.randomUUID(),
        date: "2026-09-06",
        label: "Lunch (misleading user label)",
        image,
        autoTag: true,
      };
      let calls = 0;
      const model = async (messages: ModelMessage[]) => {
        calls++;
        assert.doesNotMatch(messages.at(-1)!.content, /Lunch/);
        return response("sleep");
      };
      const sleep = await saveUserImage(ids[0], input, model);
      assert.equal(sleep.category, "sleep");
      assert.equal(sleep.classification.source, "automatic");
      assert.equal((await listFoodPhotos(ids[0])).length, 0);
      assert.equal((await listUserImages(ids[0], "sleep")).length, 1);
      assert.equal((await listUserImages(ids[1])).length, 0);
      assert.equal((await saveUserImage(ids[0], input, model)).id, sleep.id);
      assert.equal(calls, 1, "retries do not duplicate inference or images");
      await assert.rejects(
        tagUserImage(ids[1], sleep.id, sleep.version, model),
        /not found/,
      );
      await assert.rejects(
        patchUserImage(ids[1], sleep.id, {
          category: "food",
          tags: [],
          version: 0,
        }),
        /not found/,
      );
      assert.equal(calls, 1, "foreign images never reach provider");
      const uncertain = await saveUserImage(
        ids[0],
        { ...input, id: crypto.randomUUID() },
        async () => response("food", "medium"),
      );
      assert.equal(uncertain.category, "unclassified");
      assert.equal(uncertain.classification.status, "review");
      const failed = await saveUserImage(
        ids[0],
        { ...input, id: crypto.randomUUID() },
        async () => {
          throw Error("provider unavailable");
        },
      );
      assert.equal(failed.category, "unclassified");
      assert.equal(failed.classification.status, "failed");
      assert.ok((await readUserImage(ids[0], failed.id)).data.length > 0);
      const privateUpload = await saveUserImage(
        ids[0],
        { ...input, id: crypto.randomUUID(), autoTag: false },
        async () => {
          throw Error("Must not call provider");
        },
      );
      assert.equal(privateUpload.classification.source, "legacy");
      assert.equal(privateUpload.classification.status, "review");
      const corrected = await patchUserImage(ids[0], uncertain.id, {
        category: "activity",
        tags: ["running"],
        version: uncertain.version,
      });
      assert.equal(corrected.classification.source, "manual");
      await assert.rejects(
        patchUserImage(ids[0], uncertain.id, {
          category: "food",
          tags: [],
          version: uncertain.version,
        }),
        /changed/,
      );

      // A manual correction during an in-flight classifier must win.
      let finish!: (value: ModelMessage) => void;
      let started!: () => void;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const delayed = tagUserImage(
        ids[0],
        privateUpload.id,
        privateUpload.version,
        async () => {
          started();
          return new Promise<ModelMessage>((resolve) => {
            finish = resolve;
          });
        },
      );
      await began;
      await patchUserImage(ids[0], privateUpload.id, {
        category: "health",
        tags: ["my category"],
        version: privateUpload.version,
      });
      finish(response("food"));
      const final = await delayed;
      assert.equal(final.category, "health");
      assert.deepEqual(final.classification.tags, ["my category"]);

      const meal = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        date: "2026-09-06",
        name: "Invalid image meal",
        type: "lunch" as const,
        source: "photo" as const,
        estimated: true,
        notes: "",
        photoIds: [sleep.id],
        items: [
          {
            name: "Not observed food",
            portion: "unknown",
            calories: 100,
            protein: 0,
            carbs: 0,
            fat: 0,
          },
        ],
      };
      const snapshot = await readJournal(ids[0]);
      const attempted = structuredClone(snapshot);
      attempted.state.nutrition.meals.push(meal);
      await assert.rejects(
        writeJournal(ids[0], { ...attempted, mutationId: crypto.randomUUID() }),
        /Only images categorised as Food/,
      );
      let round = 0;
      const rejected = await runTurn(
        ids[0],
        {
          id: crypto.randomUUID(),
          message: "Read this sleep report",
          revision: snapshot.revision,
          timezone: "Europe/Copenhagen",
          photoIds: [sleep.id],
        },
        async (messages) => {
          if (round++ === 0) {
            assert.match(messages.at(-1)!.content, /"category":"sleep"/);
            return {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  function: {
                    name: "prepare_change",
                    arguments: {
                      kind: "record_meal",
                      meal: {
                        date: meal.date,
                        name: meal.name,
                        type: meal.type,
                        source: meal.source,
                        estimated: meal.estimated,
                        notes: meal.notes,
                        photoIds: meal.photoIds,
                        items: meal.items,
                      },
                    },
                  },
                },
              ],
            };
          }
          assert.match(
            messages.at(-1)!.content,
            /Only images categorised as Food/,
          );
          return {
            role: "assistant",
            content: "This is a sleep image. No meal was created.",
          };
        },
      );
      assert.equal(rejected.proposals.length, 0);

      // The same screenshot can support a requested, reviewed health entry.
      round = 0;
      const health = await runTurn(
        ids[0],
        {
          id: crypto.randomUUID(),
          message:
            "Log 7 hours asleep for 6 September 2026 from this sleep screenshot.",
          revision: snapshot.revision,
          timezone: "Europe/Copenhagen",
          photoIds: [sleep.id],
        },
        async () => ({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function:
                round++ === 0
                  ? {
                      name: "health_overview",
                      arguments: { date: "2026-09-06" },
                    }
                  : {
                      name: "prepare_change",
                      arguments: {
                        kind: "record_checkin",
                        checkin: { date: "2026-09-06", sleepHours: 7 },
                      },
                    },
            },
          ],
        }),
      );
      assert.equal(health.proposals.length, 1);
      assert.equal((await readJournal(ids[0])).state.health.checkins.length, 0);
      await applyProposal(ids[0], health.proposals[0].id);
      assert.equal(
        (await readJournal(ids[0])).state.health.checkins[0].sleepHours,
        7,
      );
      assert.equal((await readJournal(ids[0])).state.nutrition.meals.length, 0);

      const food = await patchUserImage(ids[0], failed.id, {
        category: "food",
        tags: ["meal"],
        version: failed.version,
      });
      const journal = await readJournal(ids[0]);
      journal.state.nutrition.meals.push({ ...meal, photoIds: [food.id] });
      await writeJournal(ids[0], {
        ...journal,
        mutationId: crypto.randomUUID(),
      });
      await assert.rejects(
        patchUserImage(ids[0], food.id, {
          category: "sleep",
          tags: [],
          version: food.version,
        }),
        /linked to a meal/,
      );
      assert.equal((await listFoodPhotos(ids[0])).length, 1);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [ids]);
      await pool.end();
    }
  },
);
