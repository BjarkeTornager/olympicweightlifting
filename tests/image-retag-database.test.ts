import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelResponse } from "../lib/agent/provider";
type Model = () => Promise<ModelResponse>;
config({ path: ".env.local", quiet: true });

test(
  "an image whose tagging was cut off is tagged again, up to three tries, then marked failed",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    // Access is decided by invitation, as in production.
    process.env.OWNER_EMAIL = "retag-owner@example.test";
    const { getPool } = await import("../lib/db");
    const {
      saveUserImage,
      readUserImage,
      retagStalledImages,
      IMAGE_TAG_RETRY_MS,
      IMAGE_TAG_TRIES,
    } = await import("../lib/user-images");
    const pool = getPool();
    const userId = crypto.randomUUID(),
      revoked = crypto.randomUUID();
    for (const id of [userId, revoked])
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Retag test','retag-'||$1||'@example.test',true)",
        [id],
      );
    await pool.query(
      "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,'retag-'||$2||'@example.test',$2)",
      [crypto.randomUUID(), userId],
    );
    const image = (
      await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#3d8bc8" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    const food: ModelResponse = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          function: {
            name: "classify_image",
            arguments: { category: "food", confidence: "high", tags: ["meal"] },
          },
        },
      ],
    };
    // A model call that answers only when released; one never released is a
    // run cut off by a restart.
    const held = () => {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let calls = 0;
      return {
        release,
        calls: () => calls,
        model: (async () => {
          calls++;
          await released;
          return food;
        }) as Model,
      };
    };
    let answered = 0;
    const answering: Model = async () => {
      answered++;
      return food;
    };
    const upload = async (owner: string, model: Model) => {
      const id = crypto.randomUUID();
      await saveUserImage(
        owner,
        {
          id,
          label: "Coach photo",
          date: "2026-10-03",
          autoTag: true,
          tagInBackground: true,
          image,
        },
        model,
      );
      return id;
    };
    const tries = async (owner: string, id: string) =>
      (
        await pool.query(
          "SELECT tag_attempts FROM food_photos WHERE user_id=$1 AND id=$2",
          [owner, id],
        )
      ).rows[0].tag_attempts as number;
    const until = async (check: () => Promise<boolean>) => {
      for (let i = 0; i < 250 && !(await check()); i++)
        await new Promise((r) => setTimeout(r, 20));
    };
    const later = (ms: number) => new Date(Date.now() + ms);
    const sweep = (model: Model, at: Date, owner = userId) =>
      retagStalledImages({ model, now: at, userId: owner });
    try {
      // The upload's own run is cut off: the image is saved, still pending.
      const killed = held();
      const first = await upload(userId, killed.model);
      await until(async () => killed.calls() === 1);
      assert.equal(await tries(userId, first), 1, "the upload's run counts");

      // Not yet: that run may still be going.
      assert.deepEqual(await sweep(answering, new Date()), {
        retagged: 0,
        failed: 0,
      });
      assert.equal(answered, 0);

      const t1 = later(IMAGE_TAG_RETRY_MS + 1000);
      assert.deepEqual(await sweep(answering, t1), { retagged: 1, failed: 0 });
      assert.equal(answered, 1);
      let photo = await readUserImage(userId, first);
      assert.equal(photo.category, "food");
      assert.equal(photo.classification.status, "ready");
      assert.equal(await tries(userId, first), 2);
      // The cut-off run answering late doesn't overwrite the newer tags.
      killed.release();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await readUserImage(userId, first)).version, photo.version);

      // Every run cut off: three tries, then failed, with no fourth call.
      const second = await upload(userId, held().model);
      const runs = [held(), held()];
      const sweeps = runs.map((run, i) => {
        const at = later((i + 1) * (IMAGE_TAG_RETRY_MS + 1000));
        return { at, done: undefined as Promise<unknown> | undefined, run };
      });
      for (const [i, s] of sweeps.entries()) {
        s.done = sweep(s.run.model, s.at);
        // Claimed, then sent to the model, and cut off there.
        await until(async () => s.run.calls() === 1);
        assert.equal(await tries(userId, second), i + 2);
      }
      assert.equal(await tries(userId, second), IMAGE_TAG_TRIES);
      const beforeGivingUp = await readUserImage(userId, second);
      assert.deepEqual(
        await sweep(answering, later(3 * (IMAGE_TAG_RETRY_MS + 1000))),
        { retagged: 0, failed: 1 },
      );
      assert.equal(answered, 1, "no fourth try");
      photo = await readUserImage(userId, second);
      assert.equal(photo.classification.status, "failed");
      assert.equal(photo.category, "unclassified");
      assert.equal(photo.version, beforeGivingUp.version + 1);
      // A cut-off run that answers after all doesn't undo that.
      runs.forEach((run) => run.release());
      await Promise.all(sweeps.map((s) => s.done));
      assert.equal(
        (await readUserImage(userId, second)).classification.status,
        "failed",
      );

      // An account that lost access is never sent to the provider.
      const blocked = await upload(revoked, held().model);
      assert.deepEqual(
        await sweep(answering, later(IMAGE_TAG_RETRY_MS + 1000), revoked),
        { retagged: 0, failed: 1 },
      );
      assert.equal(answered, 1);
      assert.equal(
        (await readUserImage(revoked, blocked)).classification.status,
        "failed",
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1)", [
        [userId, revoked],
      ]);
      await pool.end();
    }
  },
);
