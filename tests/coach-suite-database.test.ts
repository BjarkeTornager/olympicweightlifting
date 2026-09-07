import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { today } from "../lib/domain";
import { coachSettings } from "../lib/coaching";
import { mealSchema, favouriteFromMeal } from "../lib/nutrition";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
test(
  "Coach suite: atomic approval/retry/undo, stale protection, bundle guards, durable context and legacy writes stay private",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { runTurn, applyProposal } = await import("../lib/agent/engine");
    const pool = getPool(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      date = today();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Synthetic','suite-'||$1||'@example.test',true),($2,'Synthetic','suite-'||$2||'@example.test',true)",
      [a, b],
    );
    const tool = (
      name: string,
      args: Record<string, unknown>,
    ): ModelMessage => ({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name, arguments: args } }],
    });
    const input = (revision: number) => ({
      id: crypto.randomUUID(),
      revision,
      message: "I slept seven hours and ran for 30 minutes. Please log both.",
      timezone: "Europe/Copenhagen",
    });
    const bundle = {
      kind: "record_bundle",
      entries: [
        { kind: "record_checkin", checkin: { date, sleepHours: 7 } },
        {
          kind: "record_cardio",
          cardio: { date, activity: "running", durationSeconds: 1800 },
        },
      ],
    };
    try {
      let round = 0;
      const review = await runTurn(a, input(0), async (messages) => {
        round++;
        if (round === 1) return tool("prepare_change", bundle);
        if (round === 2) {
          assert.match(messages.at(-1)!.content, /Read the health overview/);
          return tool("health_overview", { date });
        }
        if (round === 3)
          return tool("cardio_journal", { from: date, to: date });
        return tool("prepare_change", bundle);
      });
      assert.equal(review.proposals[0].entries?.length, 2);
      assert.equal((await readJournal(a)).state.health.checkins.length, 0);
      await assert.rejects(() => applyProposal(b, review.proposals[0].id));
      const saved = await applyProposal(a, review.proposals[0].id);
      assert.equal(saved.state.health.checkins[0].sleepHours, 7);
      assert.equal(saved.state.cardio.sessions.length, 1);
      const replay = await applyProposal(a, review.proposals[0].id);
      assert.equal(replay.revision, saved.revision);
      assert.equal(replay.state.cardio.sessions.length, 1);
      const undone = await applyProposal(a, review.proposals[0].id, true);
      assert.equal(undone.state.cardio.sessions.length, 0);
      assert.equal(undone.state.health.checkins.length, 0);
      round = 0;
      const memory = await runTurn(
        a,
        {
          ...input(undone.revision),
          message: "Remember that I prefer vegetarian lunches.",
        },
        async () =>
          ++round === 1
            ? tool("coach_memory", {})
            : tool("prepare_change", {
                kind: "save_memory",
                memory: {
                  category: "food",
                  text: "I prefer vegetarian lunches.",
                },
              }),
      );
      assert.equal((await readJournal(a)).state.profile.coaching, undefined);
      const remembered = await applyProposal(a, memory.proposals[0].id);
      assert.equal(remembered.state.profile.coaching?.memories?.length, 1);
      round = 0;
      await runTurn(b, input(0), async (messages) => {
        assert.doesNotMatch(JSON.stringify(messages), /vegetarian lunches/);
        return ++round === 1
          ? tool("coach_memory", {})
          : { role: "assistant", content: "No approved preferences yet." };
      });
      // An old cached app can edit known fields without erasing new private data.
      let current = await readJournal(a);
      const m = mealSchema.parse({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        date,
        name: "Synthetic rice",
        type: "lunch",
        source: "manual",
        estimated: false,
        items: [
          {
            name: "Rice",
            portion: "One bowl",
            calories: 200,
            protein: 4,
            carbs: 40,
            fat: 1,
          },
        ],
      });
      current.state.nutrition.meals = [m];
      current.state.nutrition.favourites = [favouriteFromMeal(m)];
      current.state.nutrition.completeDays = [date];
      coachSettings(current.state).plans = [
        {
          id: crypto.randomUUID(),
          title: "Prepare lunch",
          notes: "",
          followUpDate: date,
          status: "active",
          outcome: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      current = await writeJournal(a, {
        ...current,
        mutationId: crypto.randomUUID(),
      });
      const legacy = structuredClone(current.state);
      delete legacy.profile.coaching!.memories;
      delete legacy.profile.coaching!.plans;
      delete legacy.nutrition.favourites;
      delete legacy.nutrition.completeDays;
      legacy.profile.coaching!.focus = "Keep lunch simple";
      const legacyInput = {
        state: legacy,
        revision: current.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      };
      const legacySaved = await writeJournal(a, legacyInput);
      assert.equal(legacySaved.state.profile.coaching!.memories!.length, 1);
      assert.equal(legacySaved.state.profile.coaching!.plans!.length, 1);
      assert.equal(legacySaved.state.nutrition.favourites!.length, 1);
      assert.deepEqual(legacySaved.state.nutrition.completeDays, [date]);
      assert.equal(
        (await writeJournal(a, legacyInput)).revision,
        legacySaved.revision,
      );
      const editedLegacy = structuredClone(legacySaved.state);
      editedLegacy.nutrition.meals[0].items[0].calories = 210;
      delete editedLegacy.nutrition.completeDays;
      const edited = await writeJournal(a, {
        state: editedLegacy,
        revision: legacySaved.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingCoachData: true,
      });
      assert.deepEqual(edited.state.nutrition.completeDays, []);
      await assert.rejects(
        () => applyProposal(a, memory.proposals[0].id, true),
        /Another device|newer|changed/i,
      );
      // No memory ID or favourite from another account can become a proposal.
      round = 0;
      await runTurn(
        b,
        { ...input(0), message: "Update a preference" },
        async (messages) => {
          round++;
          if (round === 1) return tool("coach_memory", {});
          if (round === 2)
            return tool("prepare_change", {
              kind: "forget_memory",
              memoryId: remembered.state.profile.coaching!.memories![0].id,
            });
          assert.match(messages.at(-1)!.content, /not in your journal/);
          return { role: "assistant", content: "No matching approved memory." };
        },
      );
      const own = await readJournal(b);
      assert.equal(own.revision, 0);
      assert.equal(own.state.profile.coaching, undefined);
      // A missing prerequisite on ANY entry stops the whole bundle.
      round = 0;
      const guarded = await runTurn(b, input(0), async (messages) => {
        round++;
        if (round === 1) return tool("health_overview", { date });
        if (round === 2) return tool("prepare_change", bundle);
        assert.match(messages.at(-1)!.content, /Read the cardio journal/);
        return { role: "assistant", content: "Nothing saved." };
      });
      assert.equal(guarded.proposals.length, 0);
      assert.equal((await readJournal(b)).state.health.checkins.length, 0);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [
        [a, b],
      ]);
      await pool.end();
    }
  },
);

test("old Coach clients must refresh before saving review cards they cannot render", async () => {
  const { requireCurrentCoach } = await import("../lib/agent/http");
  assert.throws(
    () =>
      requireCurrentCoach(new Request("https://example.test/api/agent/action")),
    /Refresh the website/,
  );
  assert.doesNotThrow(() =>
    requireCurrentCoach(
      new Request("https://example.test/api/agent/action", {
        headers: { "X-Coach-Journal-Version": "1" },
      }),
    ),
  );
});
