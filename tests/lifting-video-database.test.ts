import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
test(
  "video sheets remain private Activity images and knowledge reads never change the journal",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { saveUserImage, readUserImage, listUserImages, deleteUserImage } =
      await import("../lib/user-images");
    const { readJournal } = await import("../lib/server");
    const { runTurn } = await import("../lib/agent/engine");
    const pool = getPool(),
      ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids)
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic video',$1||'@example.test',true)",
        [id],
      );
    try {
      const image = (
        await sharp({
          create: {
            width: 1280,
            height: 1920,
            channels: 3,
            background: "#6688aa",
          },
        })
          .jpeg()
          .toBuffer()
      ).toString("base64");
      const input = {
        id: crypto.randomUUID(),
        label: "Snatch · video test · sheet 1/4",
        date: "2026-09-10",
        image,
        purpose: "lifting-video-frames",
        autoTag: false,
      };
      const never = async (): Promise<ModelMessage> => {
        throw Error("No classification/provider processing was authorized");
      };
      const photo = await saveUserImage(ids[0], input, never);
      assert.equal(photo.category, "activity");
      assert.deepEqual(photo.classification.tags, [
        "weightlifting",
        "video-frames",
      ]);
      assert.equal((await saveUserImage(ids[0], input, never)).id, photo.id);
      assert.equal((await listUserImages(ids[0])).length, 1);
      assert.deepEqual(await listUserImages(ids[0], "food"), []);
      await assert.rejects(readUserImage(ids[1], photo.id), /not found/);
      let count = 0;
      const outputs: string[] = [];
      const model = async (messages: ModelMessage[]): Promise<ModelMessage> => {
        if (count++ === 0) {
          assert.equal(messages.at(-1)?.images?.length, 1);
          assert.match(messages.at(-1)!.content, /video-frames/);
          return {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "lifting_knowledge",
                  arguments: { topic: "technique" },
                },
              },
              {
                function: {
                  name: "lifting_knowledge",
                  arguments: { topic: "nutrition" },
                },
              },
            ],
          };
        }
        outputs.push(
          ...messages.filter((m) => m.role === "tool").map((m) => m.content),
        );
        return {
          role: "assistant",
          content: "The synthetic test image does not show a lift.",
        };
      };
      const result = await runTurn(
        ids[0],
        {
          id: crypto.randomUUID(),
          message: "Review these frames; advice only.",
          photoIds: [photo.id],
          revision: 0,
          timezone: "UTC",
        },
        model,
        { directLogging: true },
      );
      assert.deepEqual(result.proposals, []);
      assert.ok(
        outputs.some(
          (s) =>
            s.includes("catalystathletics.com") &&
            s.includes("not calibrated capture times"),
        ),
      );
      assert.ok(
        outputs.some(
          (s) => s.includes("food_journal") && s.includes("under-fuelling"),
        ),
      );
      assert.equal((await readJournal(ids[0])).revision, 0);
      let foreignCalled = false;
      await assert.rejects(
        runTurn(
          ids[1],
          {
            id: crypto.randomUUID(),
            message: "Read image",
            photoIds: [photo.id],
            revision: 0,
            timezone: "UTC",
          },
          async () => {
            foreignCalled = true;
            return { role: "assistant", content: "" };
          },
        ),
        /not found/,
      );
      assert.equal(foreignCalled, false);
      await deleteUserImage(ids[0], photo.id);
      await assert.rejects(readUserImage(ids[0], photo.id), /not found/);
    } finally {
      for (const id of ids)
        await pool.query("DELETE FROM users WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
