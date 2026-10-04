import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import {
  addDrink,
  drinksForOlderApps,
  hydrationForDay,
} from "../lib/hydration";
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
      // 80 kg, sex not given: 1.2 L + 0.12 L + 9.5 ml a kg, to 2 L.
      assert.match(saved.detail, /0\.5 L of about 2 L/);
      assert.equal((await readJournal(id)).state.health.drinks?.length, 1);
      // Voice logs wine like text Coach: a usual glass is an estimate, and
      // its energy belongs in Food too.
      const wine = await runVoiceTool(id, {
        id: crypto.randomUUID(),
        name: "log_drink",
        args: {
          summary: "A glass of red wine with dinner",
          date,
          ml: 150,
          kind: "wine",
          estimated: true,
        },
        today: date,
        seenPhotoIds: [],
      });
      assert.ok(wine.ok && "detail" in wine);
      assert.match(wine.detail, /^about 150 ml wine\./);
      assert.match(
        wine.detail,
        /Wine has energy too: if it isn't in Food yet, log it there as well/,
      );
      assert.equal(
        (await readJournal(id)).state.health.drinks?.at(-1)?.estimated,
        true,
      );
      // With the wine already in Food, as when the voice coach logs the
      // meal first, the receipt doesn't ask for it again.
      const meal = await runVoiceTool(id, {
        id: crypto.randomUUID(),
        name: "log_meal",
        args: {
          summary: "A glass of white wine",
          date,
          meal_type: "dinner",
          name: "White wine",
          items: [
            {
              name: "White wine",
              portion: "150 ml",
              calories: 120,
              protein_g: 0,
              carbs_g: 4,
              fat_g: 0,
            },
          ],
        },
        today: date,
        seenPhotoIds: [],
      });
      assert.ok(meal.ok);
      const second = await runVoiceTool(id, {
        id: crypto.randomUUID(),
        name: "log_drink",
        args: {
          summary: "A glass of white wine",
          date,
          ml: 150,
          kind: "wine",
          estimated: true,
        },
        today: date,
        seenPhotoIds: [],
      });
      assert.ok(second.ok && "detail" in second);
      assert.doesNotMatch(second.detail, /energy/);
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);

const tz = "Europe/Copenhagen";
const now = new Date("2026-09-26T18:00:00Z");

test(
  "check-in water moves into a drink once, older apps keep drink details, and the app can hide the target",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { applyNativeAction } = await import("../lib/native-actions");
    const { buildToday } = await import("../lib/native-api");
    const pool = getPool();
    const id = crypto.randomUUID();
    const date = "2026-09-26";
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Drinks test',$1||'@example.test',true)",
      [id],
    );
    const checkin = (d: string, waterMl: number, notes = "") => ({
      date: d,
      sleepHours: null,
      energy: null,
      soreness: null,
      waterMl,
      bodyweight: null,
      notes,
      updatedAt: `${d}T20:00:00.000Z`,
    });
    try {
      // A journal stored before drinks: read with the total as a drink.
      const first = await readJournal(id);
      first.state.health.checkins.push(checkin("2026-09-24", 1600, "Hot day"));
      await pool.query("UPDATE journals SET state=$2 WHERE user_id=$1", [
        id,
        JSON.stringify(first.state),
      ]);
      let journal = await readJournal(id);
      assert.equal(hydrationForDay(journal.state, "2026-09-24").totalMl, 1600);
      assert.equal(journal.state.health.checkins[0].waterMl, null);
      assert.equal(journal.state.health.checkins[0].notes, "Hot day");

      // A cached app from before drinks omits them and still sends a
      // check-in total for a day that has drinks: those drinks stay, and
      // the total is not added on top.
      await writeJournal(id, {
        state: journal.state,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
      });
      journal = await readJournal(id);
      addDrink(journal.state, { date, ml: 500, kind: "water" }, now);
      await writeJournal(id, {
        state: journal.state,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
      });
      journal = await readJournal(id);
      const old = structuredClone(journal.state);
      delete old.health.drinks;
      old.health.checkins.push(checkin(date, 2000));
      await writeJournal(id, {
        state: old,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      });
      journal = await readJournal(id);
      assert.equal(hydrationForDay(journal.state, date).totalMl, 500);
      assert.equal(hydrationForDay(journal.state, "2026-09-24").totalMl, 1600);
      assert.equal(
        journal.state.health.checkins.some((c) => c.date === date),
        false,
      );

      // A cached app from before alcohol saves wine back as "other": it
      // stays wine, and an estimated glass stays estimated.
      addDrink(journal.state, { date, ml: 150, kind: "wine" }, now);
      addDrink(
        journal.state,
        { date, ml: 250, kind: "water", estimated: true },
        now,
      );
      await writeJournal(id, {
        state: journal.state,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
      });
      journal = await readJournal(id);
      const older = structuredClone(journal.state);
      older.health.drinks = drinksForOlderApps(older.health.drinks!);
      older.profile.name = "Older app";
      await writeJournal(id, {
        state: older,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
        preserveDrinkDetails: true,
      });
      journal = await readJournal(id);
      assert.equal(journal.state.profile.name, "Older app");
      assert.deepEqual(
        hydrationForDay(journal.state, date).drinks.map((d) => [
          d.kind,
          d.estimated,
        ]),
        [
          ["water", undefined],
          ["wine", undefined],
          ["water", true],
        ],
      );

      // The iPhone hides the drinks target and shows it again.
      const save = (hidden: boolean) =>
        applyNativeAction(
          id,
          {
            id: crypto.randomUUID(),
            timezone: tz,
            action: { kind: "set_hydration_target", hidden },
          },
          now,
        );
      assert.equal((await save(true)).title, "Hide the drinks target");
      journal = await readJournal(id);
      assert.equal(journal.state.preferences.hideHydrationTarget, true);
      assert.equal(
        buildToday(journal.state, journal.revision, date, new Set()).hydration
          .targetHidden,
        true,
      );
      await save(false);
      journal = await readJournal(id);
      assert.equal("hideHydrationTarget" in journal.state.preferences, false);
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
