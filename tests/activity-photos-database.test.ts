import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import { activityLoggingPrompt, imageCoachPrompt } from "../lib/images";
import { saveCardio } from "../lib/cardio";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

test(
  "Activity photo logging saves inspected sources privately, deduplicates and supports corrections and Undo",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { saveUserImage, patchUserImage, deleteUserImage } =
      await import("../lib/user-images");
    const { runTurn, applyProposal } = await import("../lib/agent/engine");
    const { readJournal, writeJournal } = await import("../lib/server");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      date = "2026-09-12";
    const call = (name: string, args: Record<string, unknown>) => ({
      function: { name, arguments: args },
    });
    const sequence = (...rounds: ReturnType<typeof call>[][]) => {
      let round = 0;
      return async (messages: ModelMessage[]): Promise<ModelMessage> => {
        if (round > 0) assert.ok(messages.some((m) => m.role === "tool"));
        return {
          role: "assistant",
          content: "",
          tool_calls: rounds[round++] ?? [],
        };
      };
    };
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic athlete',$1||'@example.test',true),($2,'Synthetic athlete',$2||'@example.test',true)",
      [a, b],
    );
    try {
      const image = (
        await sharp({
          create: { width: 40, height: 40, channels: 3, background: "#ddd" },
        })
          .jpeg()
          .toBuffer()
      ).toString("base64");
      const photo = await saveUserImage(
        a,
        {
          id: crypto.randomUUID(),
          label: "Synthetic walk summary",
          date,
          image,
        },
        async () => {
          throw Error("No live provider calls");
        },
      );
      await patchUserImage(a, photo.id, {
        version: photo.version,
        category: "activity",
        tags: ["walking", "screenshot"],
      });
      const request = (revision = 0, photoIds: string[] = []) => ({
        id: crypto.randomUUID(),
        revision,
        photoIds,
        message: activityLoggingPrompt(true),
        timezone: "Europe/Copenhagen",
      });
      const action = {
        kind: "record_cardio",
        cardio: {
          date,
          activity: "walking",
          durationSeconds: 2142,
          distanceKm: 2.7,
          durationType: "elapsed",
          photoIds: [photo.id],
        },
      };
      const read = call("cardio_journal", { from: date, to: date });
      const log = call("log_entry", action);
      const hooks = { directLogging: true };
      assert.equal(imageCoachPrompt("activity"), activityLoggingPrompt(true));
      // Merely listing or inspecting in the same batch cannot supply seen pixels.
      for (const rounds of [
        [[read, call("image_library", {})], [log]],
        [[read, call("inspect_images", { imageIds: [photo.id] }), log]],
      ]) {
        const result = await runTurn(a, request(), sequence(...rounds), hooks);
        assert.equal(result.proposals.length, 0);
        assert.equal((await readJournal(a)).revision, 0);
      }
      const missingSource = await runTurn(
        a,
        request(0, [photo.id]),
        sequence(
          [read],
          [
            call("log_entry", {
              ...action,
              cardio: { ...action.cardio, photoIds: [] },
            }),
          ],
        ),
        hooks,
      );
      assert.equal(missingSource.proposals.length, 0);
      const savedRequest = request();
      const saved = await runTurn(
        a,
        savedRequest,
        sequence(
          [read, call("inspect_images", { imageIds: [photo.id] })],
          [log],
        ),
        hooks,
      );
      assert.equal(saved.proposals[0]?.status, "saved");
      let snapshot = await readJournal(a);
      const entry = snapshot.state.cardio.sessions[0];
      assert.equal(entry.durationSeconds, 2142);
      assert.equal(entry.distanceKm, 2.7);
      assert.equal(entry.caloriesKcal, null);
      assert.equal(entry.averageHeartRate, null);
      assert.deepEqual(entry.photoIds, [photo.id]);
      assert.equal(snapshot.state.nutrition.meals.length, 0);
      await runTurn(
        a,
        savedRequest,
        async () => {
          throw Error("Retry must reuse the saved receipt");
        },
        hooks,
      );
      assert.equal((await readJournal(a)).revision, 1);
      const duplicate = await runTurn(
        a,
        request(1, [photo.id]),
        sequence([read], [log]),
        hooks,
      );
      assert.equal(duplicate.proposals.length, 0);
      await assert.rejects(
        deleteUserImage(a, photo.id),
        /linked to an activity/,
      );
      await assert.rejects(
        patchUserImage(a, photo.id, { version: 1, category: "food", tags: [] }),
        /linked to an activity/,
      );
      await assert.rejects(
        runTurn(b, request(0, [photo.id]), sequence(), hooks),
        /not found/,
      );
      const foreign = await readJournal(b);
      saveCardio(foreign.state, action.cardio, date);
      await assert.rejects(
        writeJournal(b, { ...foreign, mutationId: crypto.randomUUID() }),
        /activity photo is unavailable/,
      );
      assert.equal((await readJournal(b)).state.cardio.sessions.length, 0);
      // An old browser may omit the new links; retain them on public sync.
      delete snapshot.state.cardio.sessions[0].photoIds;
      snapshot = await writeJournal(a, {
        ...snapshot,
        mutationId: crypto.randomUUID(),
        preserveMissingActivityPhotos: true,
      });
      assert.deepEqual(snapshot.state.cardio.sessions[0].photoIds, [photo.id]);
      const correction = await runTurn(
        a,
        {
          ...request(snapshot.revision),
          message: "My walk was actually 36 minutes",
        },
        sequence(
          [read],
          [
            call("log_entry", {
              kind: "update_cardio",
              cardioId: entry.id,
              changes: { durationSeconds: 2160 },
            }),
          ],
        ),
        hooks,
      );
      assert.equal(correction.proposals[0]?.status, "saved");
      snapshot = await readJournal(a);
      assert.equal(snapshot.state.cardio.sessions.length, 1);
      assert.equal(snapshot.state.cardio.sessions[0].durationSeconds, 2160);
      assert.deepEqual(snapshot.state.cardio.sessions[0].photoIds, [photo.id]);
      await applyProposal(a, correction.proposals[0].id, true);
      snapshot = await readJournal(a);
      assert.equal(snapshot.state.cardio.sessions[0].durationSeconds, 2142);
      // Explicit unlink enables deletion and is itself reversible.
      const unlink = await runTurn(
        a,
        {
          ...request(snapshot.revision),
          message: "Remove the photo link from my walk",
        },
        sequence(
          [read],
          [
            call("log_entry", {
              kind: "update_cardio",
              cardioId: entry.id,
              changes: { photoIds: [] },
            }),
          ],
        ),
        hooks,
      );
      assert.deepEqual(
        (await readJournal(a)).state.cardio.sessions[0].photoIds,
        [],
      );
      await applyProposal(a, unlink.proposals[0].id, true);
      snapshot = await readJournal(a);
      assert.deepEqual(snapshot.state.cardio.sessions[0].photoIds, [photo.id]);
      snapshot.state.cardio.sessions[0].photoIds = [];
      snapshot = await writeJournal(a, {
        ...snapshot,
        mutationId: crypto.randomUUID(),
      });
      await patchUserImage(a, photo.id, {
        version: 1,
        category: "sleep",
        tags: [],
      });
      const wrongCategory = await runTurn(
        a,
        request(snapshot.revision, [photo.id]),
        sequence([read], [log]),
        hooks,
      );
      assert.equal(wrongCategory.proposals.length, 0);
      await deleteUserImage(a, photo.id);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [
        [a, b],
      ]);
      await pool.end();
    }
  },
);
