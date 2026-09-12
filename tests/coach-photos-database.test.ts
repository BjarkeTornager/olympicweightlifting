import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
import { savedVisualSchema, visualToolSchema } from "../lib/coach-visuals";
config({ path: ".env.local", quiet: true });

test("gallery display data accepts only bounded, unique image IDs, never arbitrary URLs", () => {
  const gallery = {
    id: crypto.randomUUID(),
    content: {
      kind: "photo_gallery",
      title: "Lunch photos",
      imageIds: [crypto.randomUUID()],
    },
  };
  assert.equal(savedVisualSchema.safeParse(gallery).success, true);
  for (const imageIds of [
    [],
    ["https://example.test/photo.jpg"],
    [gallery.content.imageIds[0], gallery.content.imageIds[0]],
    Array.from({ length: 9 }, () => crypto.randomUUID()),
  ]) {
    assert.equal(
      savedVisualSchema.safeParse({
        ...gallery,
        content: { ...gallery.content, imageIds },
      }).success,
      false,
    );
  }
  assert.equal(
    savedVisualSchema.safeParse({
      ...gallery,
      content: { ...gallery.content, url: "https://example.test/tracker" },
    }).success,
    false,
  );
  assert.equal(
    visualToolSchema.safeParse(gallery.content).success,
    false,
    "the generic visual tool cannot bypass image ownership validation",
  );
});

test(
  "Coach galleries and inspection recheck image ownership, preserve categories and never store retrieved pixels",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { saveUserImage, patchUserImage, deleteUserImage, readUserImage } =
      await import("../lib/user-images");
    const { runTurn, history, athleteDate } =
      await import("../lib/agent/engine");
    const { readJournal } = await import("../lib/server");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Photo test','gallery-a-'||$1||'@example.test',true),($2,'Photo test','gallery-b-'||$2||'@example.test',true)",
      [a, b],
    );
    try {
      const pixels = (
        await sharp({
          create: { width: 48, height: 64, channels: 3, background: "#edd7ab" },
        })
          .jpeg()
          .toBuffer()
      ).toString("base64");
      const date = athleteDate("Europe/Copenhagen");
      const images: Awaited<ReturnType<typeof patchUserImage>>[] = [];
      for (let i = 0; i < 6; i++) {
        const owner = i === 5 ? b : a;
        const saved = await saveUserImage(owner, {
          id: crypto.randomUUID(),
          label: i === 5 ? "Foreign private image" : `Synthetic image ${i}`,
          date,
          image: pixels,
        });
        images.push(
          await patchUserImage(owner, saved.id, {
            version: saved.version,
            category: i === 1 ? "sleep" : "food",
            tags: [],
          }),
        );
      }
      const input = (message: string) => ({
        id: crypto.randomUUID(),
        revision: 0,
        timezone: "Europe/Copenhagen",
        message,
      });
      const tool = (
        name: string,
        args: Record<string, unknown>,
      ): ModelMessage => ({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name, arguments: args } }],
      });
      const events: unknown[] = [];
      let round = 0;
      const shown = await runTurn(
        a,
        input("Show my food photos from today."),
        async (messages) => {
          assert.equal(
            messages.some((m) => m.images?.length),
            false,
            "displaying never sends image pixels to the provider",
          );
          if (round++ === 0)
            return tool("image_library", {
              category: "food",
              from: date,
              to: date,
            });
          if (round === 2) {
            const found = JSON.parse(messages.at(-1)!.content);
            assert.equal(found.total, 4);
            assert.equal(
              found.images.some(
                (p: { id: string }) =>
                  p.id === images[1].id || p.id === images[5].id,
              ),
              false,
            );
            return tool("show_images", {
              title: "Your food photos",
              imageIds: [images[0].id, images[2].id],
            });
          }
          return {
            role: "assistant",
            content: "Here are two food photos from your private library.",
          };
        },
        { emit: (event) => events.push(event) },
      );
      assert.deepEqual(shown.visuals?.[0].content, {
        kind: "photo_gallery",
        title: "Your food photos",
        imageIds: [images[0].id, images[2].id],
        caption:
          "Private photos · Library dates shown below.",
      });
      assert.match(JSON.stringify(events), /coach.visual/);
      assert.deepEqual((await history(a)).at(-1)?.visuals, shown.visuals);
      assert.equal((await history(b)).length, 0);

      for (const name of ["show_images", "inspect_images"]) {
        const deniedEvents: unknown[] = [];
        let attempts = 0;
        const denied = await runTurn(
          a,
          input("Show and read these photos."),
          async (messages) => {
            if (attempts++ === 0)
              return tool(name, {
                imageIds: [images[0].id, images[5].id],
                ...(name === "show_images" ? { title: "A gallery" } : {}),
              });
            assert.match(messages.at(-1)!.content, /not found in your library/);
            assert.equal(
              messages.some((m) => m.images?.length),
              false,
            );
            assert.doesNotMatch(
              JSON.stringify(messages),
              /Foreign private image/,
            );
            return { role: "assistant", content: "That photo is unavailable." };
          },
          { emit: (event) => deniedEvents.push(event) },
        );
        assert.equal(denied.visuals, undefined);
        assert.doesNotMatch(
          JSON.stringify(deniedEvents),
          /coach.visual|Foreign private image/,
        );
      }

      let inspections = 0;
      const inspected = await runTurn(
        a,
        input("Read my saved sleep screenshot."),
        async (messages) => {
          if (inspections++ === 0)
            return tool("inspect_images", { imageIds: [images[1].id] });
          const retrieved = messages.filter((m) => m.images?.length);
          assert.equal(retrieved.length, 1);
          assert.equal(retrieved[0].role, "user");
          assert.match(retrieved[0].content, /"category":"sleep"/);
          assert.equal(
            retrieved[0].images![0],
            (await readUserImage(a, images[1].id)).data.toString("base64"),
          );
          if (inspections === 2)
            return tool("inspect_images", { imageIds: [images[1].id] });
          return {
            role: "assistant",
            content: "The synthetic image has no readable sleep values.",
          };
        },
      );
      assert.equal(inspected.proposals.length, 0);
      assert.equal((await readJournal(a)).revision, 0);
      assert.equal((await readJournal(a)).state.health.checkins.length, 0);
      assert.doesNotMatch(
        JSON.stringify(await history(a)),
        new RegExp(pixels.slice(0, 80)),
      );
      assert.doesNotMatch(JSON.stringify(events), /data:image|base64/);

      let limited = 0;
      await runTurn(
        a,
        {
          ...input("Read these images."),
          photoIds: images.slice(0, 4).map((p) => p.id),
        },
        async (messages) => {
          if (limited++ === 0)
            return tool("inspect_images", { imageIds: [images[4].id] });
          assert.match(
            messages.at(-1)!.content,
            /at most four distinct images/,
          );
          return {
            role: "assistant",
            content: "Please ask about the fifth image separately.",
          };
        },
      );
      await deleteUserImage(a, images[0].id);
      let deleted = 0;
      const missing = await runTurn(
        a,
        input("Show that deleted photo again."),
        async (messages) => {
          if (deleted++ === 0)
            return tool("show_images", {
              title: "Old image",
              imageIds: [images[0].id],
            });
          assert.match(messages.at(-1)!.content, /not found in your library/);
          return {
            role: "assistant",
            content: "That image is no longer available.",
          };
        },
      );
      assert.equal(missing.visuals, undefined);
    } finally {
      await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[a, b]]);
      await pool.end();
    }
  },
);
