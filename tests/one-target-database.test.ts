import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// One weight, one target, on a synthetic account: Apple Health weights
// reach the plan, the iPhone takes or keeps the plan's suggested targets
// once each, and an older client's save keeps the weights it doesn't know.

const tz = "Europe/Copenhagen";
const now = new Date("2026-09-26T18:00:00Z");

test(
  "Apple Health weights move the plan, and the iPhone's choice of its suggested targets is saved once",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { readJournal, writeJournal } = await import("../lib/server"),
      { applyNativeAction } = await import("../lib/native-actions"),
      { syncHealth } = await import("../lib/health-sync"),
      { applyGoals } = await import("../lib/body-goals"),
      { buildToday } = await import("../lib/native-api"),
      { currentWeightKg } = await import("../lib/target-history"),
      { targetsProposal } = await import("../lib/target-proposals");
    const pool = getPool();
    const id = crypto.randomUUID(),
      email = `one-target-${id}@example.test`;
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA',$2,true)",
      [id, email],
    );
    await pool.query(
      "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
      [crypto.randomUUID(), email, id],
    );
    try {
      // Goals saved on 1 September at 88 kg, heading for 81 kg.
      const start = await readJournal(id);
      start.state.profile.timezone = tz;
      applyGoals(
        start.state,
        {
          age: 34,
          sex: "male",
          heightCm: 182,
          weightKg: 88,
          targetWeightKg: 81,
          targetDate: null,
          activity: "moderate",
          trainingDays: 4,
          sessionMinutes: 75,
          experience: "developing",
        },
        "2026-09-01",
      );
      await writeJournal(id, {
        state: start.state,
        revision: start.revision,
        mutationId: crypto.randomUUID(),
      });
      // A week of a smart scale's morning weights, about 85.5 kg.
      const synced = await syncHealth(
        id,
        {
          timezone: tz,
          days: [
            { date: "2026-09-20", bodyMassKg: 85.84 },
            { date: "2026-09-23", bodyMassKg: 85.5, steps: 8000 },
            { date: "2026-09-26", bodyMassKg: 85.2 },
          ],
        },
        now,
      );
      assert.equal(synced.bodyMassUpdated, 3);
      // The same batch again changes nothing.
      const again = await syncHealth(
        id,
        { timezone: tz, days: [{ date: "2026-09-26", bodyMassKg: 85.2 }] },
        now,
      );
      assert.equal(again.bodyMassUpdated, 0);
      assert.equal(again.changed, false);
      let journal = await readJournal(id);
      assert.deepEqual(
        journal.state.health.bodyMass?.map((m) => [m.date, m.kg]),
        [
          ["2026-09-20", 85.8],
          ["2026-09-23", 85.5],
          ["2026-09-26", 85.2],
        ],
      );
      assert.equal(currentWeightKg(journal.state, "2026-09-26"), 85.5);
      // An older web client's save, which drops what it doesn't know, keeps
      // them.
      const older = structuredClone(journal.state);
      delete older.health.bodyMass;
      await writeJournal(id, {
        state: older,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      });
      journal = await readJournal(id);
      assert.equal(journal.state.health.bodyMass?.length, 3);
      // Today shows Apple Health's weight, the saved target and the plan's
      // suggestion.
      const today = buildToday(
        journal.state,
        journal.revision,
        "2026-09-26",
        new Set(),
      );
      assert.equal(today.body?.bodyweight, 85.2);
      assert.equal(today.body?.bodyweightFromAppleHealth, true);
      assert.equal(today.nutrition.targetCalories, 2640);
      const suggestion = today.targetsProposal!;
      assert.match(suggestion.reasons[0], /^Your weight is about 85\.5 kg now/);
      const shown = suggestion.suggested;
      // A suggestion that has changed since it was shown is refused.
      await assert.rejects(
        applyNativeAction(
          id,
          {
            id: crypto.randomUUID(),
            timezone: tz,
            action: {
              kind: "take_suggested_targets",
              targets: { ...shown, calories: shown.calories! - 50 },
            },
          },
          now,
        ),
        /Your goals plan has changed since these targets were suggested/,
      );
      // Still a deficit, with no answers to the low-energy questions: Today
      // asks them, and the targets aren't taken without an answer.
      assert.equal(suggestion.energyCheck?.questions.length, 2);
      await assert.rejects(
        applyNativeAction(
          id,
          {
            id: crypto.randomUUID(),
            timezone: tz,
            action: { kind: "take_suggested_targets", targets: shown },
          },
          now,
        ),
        /a few health questions come first/,
      );
      // Taken with a no to all, once, however often the app retries.
      const take = {
        id: crypto.randomUUID(),
        timezone: tz,
        action: {
          kind: "take_suggested_targets",
          targets: shown,
          energyAnswer: "no",
        },
      };
      const saved = await applyNativeAction(id, take, now);
      assert.equal(saved.status, "saved");
      assert.match(
        saved.detail,
        new RegExp(
          `^Your daily target is now ${shown.calories!.toLocaleString("en-GB")} kcal, a starting estimate\\.`,
        ),
      );
      assert.equal(
        (await applyNativeAction(id, take, now)).status,
        "duplicate",
      );
      journal = await readJournal(id);
      assert.equal(journal.state.nutrition.targets.calories, shown.calories);
      assert.deepEqual(journal.state.profile.energyCheck, {
        date: "2026-09-26",
        signs: false,
      });
      assert.deepEqual(
        (({ source, from, weightKgAtSet }) => ({
          source,
          from,
          weightKgAtSet,
        }))(journal.state.profile.targetHistory!.at(-1)!),
        { source: "plan", from: "2026-09-26", weightKgAtSet: 85.5 },
      );
      // A plan that still loses agrees the goals check with the new targets.
      assert.ok(
        journal.state.profile.coaching?.plans?.some(
          (p) =>
            p.status === "active" &&
            p.title === "Check my weight trend against my goals plan",
        ),
      );
      assert.equal(targetsProposal(journal.state, "2026-09-26"), null);
      // Nothing left to keep over.
      await assert.rejects(
        applyNativeAction(
          id,
          {
            id: crypto.randomUUID(),
            timezone: tz,
            action: { kind: "keep_current_targets", targets: shown },
          },
          now,
        ),
        /Your goals plan has changed since these targets were suggested/,
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
