import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "Coach photo uploads answer once saved, tag afterwards and survive a retried upload",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { saveUserImage, readUserImage } = await import("../lib/user-images");
    const pool = getPool();
    const userId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Upload test',$1||'@example.test',true)",
      [userId],
    );
    try {
      const image = (
        await sharp({
          create: { width: 64, height: 48, channels: 3, background: "#c8553d" },
        })
          .jpeg()
          .toBuffer()
      ).toString("base64");
      // A classifier that answers only when told to, like a slow model call.
      let answer!: () => void;
      const answered = new Promise<void>((resolve) => (answer = resolve));
      let calls = 0;
      const model = async (): Promise<ModelMessage> => {
        calls++;
        await answered;
        return {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "classify_image",
                arguments: {
                  category: "food",
                  confidence: "high",
                  tags: ["meal"],
                },
              },
            },
          ],
        };
      };
      const input = {
        id: crypto.randomUUID(),
        label: "Coach photo",
        date: "2026-10-02",
        autoTag: true,
        tagInBackground: true,
        image,
      };
      // Saved and answered before the classifier has replied.
      const saved = await saveUserImage(userId, input, model);
      assert.equal(saved.id, input.id);
      assert.equal(saved.classification.status, "pending");
      // A retry after a dropped connection gets the same image back.
      const again = await saveUserImage(userId, input, model);
      assert.equal(again.id, input.id);
      assert.equal(calls, 1, "the retry doesn't classify again");
      answer();
      for (let i = 0; i < 50; i++) {
        if ((await readUserImage(userId, input.id)).category === "food") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const tagged = await readUserImage(userId, input.id);
      assert.equal(tagged.category, "food");
      assert.equal(tagged.classification.status, "ready");
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [userId]);
      await pool.end();
    }
  },
);
