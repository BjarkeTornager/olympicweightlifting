import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// The release's one-time check of goal targets saved before the plan's
// safety limits, on synthetic accounts only.

test(
  "the release brings an old target that breaks a limit back to the plan, and leaves targets set by hand",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { readJournal, writeJournal } = await import("../lib/server"),
      { planForState, planTargets } = await import("../lib/body-goals"),
      { regateSavedGoalTargets } = await import("../lib/legacy-goal-targets");
    const pool = getPool(),
      accounts: string[] = [],
      now = new Date("2026-09-26T09:00:00Z");
    // A 16-year-old's goals saved on 1 September, with the targets the old
    // plan gave them (1,730 kcal, lose) or a target she set herself.
    const account = async (calories: number) => {
      const id = crypto.randomUUID(),
        email = `goal-targets-${id}@example.test`;
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA',$2,true)",
        [id, email],
      );
      await pool.query(
        "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
        [crypto.randomUUID(), email, id],
      );
      const { state, revision } = await readJournal(id);
      state.profile.timezone = "Europe/Copenhagen";
      state.profile.body = {
        age: 16,
        sex: "female",
        heightCm: 165,
        weightKg: 60,
        targetWeightKg: 55,
        targetDate: null,
        activity: "moderate",
        trainingDays: 3,
        sessionMinutes: 75,
        experience: "developing",
        updatedAt: "2026-09-01T10:00:00.000Z",
      };
      state.nutrition.targets = {
        goal: "lose",
        calories,
        protein: 120,
        carbs: 204,
        fat: 48,
      };
      await writeJournal(id, {
        state,
        revision,
        mutationId: crypto.randomUUID(),
      });
      return id;
    };
    try {
      const planned = await account(1730),
        own = await account(1800);
      const before = {
        planned: await readJournal(planned),
        own: await readJournal(own),
      };
      assert.equal(
        await regateSavedGoalTargets({ userIds: [planned, own], now }),
        1,
      );
      const after = await readJournal(planned);
      assert.equal(after.revision, before.planned.revision + 1);
      assert.deepEqual(
        after.state.nutrition.targets,
        planTargets(planForState(after.state, "2026-09-26")!),
      );
      assert.equal(after.state.nutrition.targets.goal, "maintain");
      // Hers, set by hand, stays, and so does the journal's revision.
      const kept = await readJournal(own);
      assert.equal(kept.revision, before.own.revision);
      assert.equal(kept.state.nutrition.targets.calories, 1800);
      // The next release finds nothing more to change.
      assert.equal(
        await regateSavedGoalTargets({ userIds: [planned, own], now }),
        0,
      );
      assert.equal((await readJournal(planned)).revision, after.revision);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [accounts]);
    }
  },
);
