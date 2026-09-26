import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { addDrink } from "../lib/hydration";
config({ path: ".env.local", quiet: true });

test(
  "drinks survive saves from an older app and are logged by the voice coach",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { runVoiceTool } = await import("../lib/voice-actions");
    const pool = getPool();
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Hydration test',$1||'@example.test',true)",
      [id],
    );
    try {
      const date = "2026-09-26";
      let snapshot = await readJournal(id);
      const state = structuredClone(snapshot.state);
      addDrink(state, { date, ml: 500, kind: "water" });
      snapshot = await writeJournal(id, {
        state,
        revision: snapshot.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      });
      // An app from before drink tracking saves without the field.
      const old = structuredClone(snapshot.state);
      delete old.health.drinks;
      old.profile.bodyweight = 80;
      snapshot = await writeJournal(id, {
        state: old,
        revision: snapshot.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      });
      assert.equal(snapshot.state.health.drinks?.length, 1);
      assert.equal(snapshot.state.profile.bodyweight, 80);
      // The current app clearing its list really clears it.
      const cleared = structuredClone(snapshot.state);
      cleared.health.drinks = [];
      snapshot = await writeJournal(id, {
        state: cleared,
        revision: snapshot.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      });
      assert.deepEqual(snapshot.state.health.drinks, []);

      const saved = await runVoiceTool(id, {
        id: crypto.randomUUID(),
        name: "log_drink",
        args: {
          summary: "A bottle of water after training",
          date,
          ml: 500,
          kind: "water",
        },
        today: date,
        seenPhotoIds: [],
      });
      assert.ok(saved.ok && "detail" in saved);
      assert.match(saved.detail, /0\.5 L of about 2\.8 L/);
      assert.equal((await readJournal(id)).state.health.drinks?.length, 1);
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
