import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { guardChange, type GuardedAction } from "../lib/agent/change-guards";
import { newTurnReads, runReadTool } from "../lib/agent/read-tools";
import type { JournalState } from "../lib/model";

const date = "2026-09-20";
const context = (state: JournalState = emptyJournal()) => ({
  userId: "athlete",
  state,
  reads: newTurnReads(),
  viewedImageIds: new Set<string>(),
  message: "I did some training",
  recent: [],
  saving: true,
});
const action = (value: object) => value as GuardedAction;

test("a workout log needs the date's sessions and the current workout read first", async () => {
  const ctx = context();
  const progress = action({
    kind: "log_workout_progress",
    completion: "ongoing",
    workout: { date, title: "Snatch", exercises: [] },
  });
  await assert.rejects(guardChange(progress, ctx), /Read find_sessions/);
  // A filtered read cannot show an existing workout on that date.
  await runReadTool(
    "find_sessions",
    { from: date, to: date, exerciseId: "snatch" },
    { ...ctx, currentDate: date, timezone: "UTC" },
  );
  await assert.rejects(guardChange(progress, ctx), /Read find_sessions/);
  await runReadTool(
    "find_sessions",
    { from: date, to: date },
    { ...ctx, currentDate: date, timezone: "UTC" },
  );
  await assert.rejects(guardChange(progress, ctx), /Read the current workout/);
  await runReadTool(
    "current_workout",
    {},
    { ...ctx, currentDate: date, timezone: "UTC" },
  );
  assert.equal(ctx.reads.draft, true);
  await guardChange(progress, ctx);
});

test("edits to a session, memory or cardio entry need that record read first", async () => {
  const ctx = context();
  await assert.rejects(
    guardChange(
      action({ kind: "update_session", sessionId: "s1", workout: { date } }),
      ctx,
    ),
    /Read the full original session/,
  );
  await assert.rejects(
    guardChange(action({ kind: "save_memory", memory: {} }), ctx),
    /Read coach_memory/,
  );
  await runReadTool(
    "coach_memory",
    {},
    { ...ctx, currentDate: date, timezone: "UTC" },
  );
  await guardChange(action({ kind: "save_memory", memory: {} }), ctx);
  await assert.rejects(
    guardChange(action({ kind: "delete_cardio", cardioId: "c1" }), ctx),
    /Read the full original cardio activity/,
  );
  await assert.rejects(
    guardChange(action({ kind: "set_lifting_brief", liftingBrief: null }), {
      ...ctx,
      liftingBriefReview: false,
    }),
    /Refresh the app/,
  );
});

test("a directly logged meal needs an unfiltered read of its date; a preview does not", async () => {
  const ctx = context();
  const meal = () =>
    action({
      kind: "record_meal",
      meal: {
        date,
        photoIds: [],
        source: "photo",
        estimated: false,
        items: [],
      },
    });
  await assert.rejects(guardChange(meal(), ctx), /Read food_journal/);
  await runReadTool(
    "food_journal",
    { from: date, to: date, mealType: "lunch" },
    { ...ctx, currentDate: date, timezone: "UTC" },
  );
  assert.equal(ctx.reads.food, true);
  await assert.rejects(guardChange(meal(), ctx), /Read food_journal/);
  // With no image the meal is from text, even if the model said photo.
  const preview = meal();
  await assert.rejects(
    guardChange(preview, { ...ctx, saving: false }),
    /must link its source photo/,
  );
  const text = action({
    kind: "record_meal",
    meal: { date, photoIds: [], source: "text", estimated: false, items: [] },
  });
  await guardChange(text, { ...ctx, saving: false });
  const normalised = (text as { meal: { estimated: boolean; source: string } })
    .meal;
  assert.equal(normalised.estimated, true);
  assert.equal(normalised.source, "text");
});

test("photos the model has not seen cannot back a meal or an activity", async () => {
  const ctx = context();
  ctx.reads.foodRanges.push({ from: date, to: date });
  await assert.rejects(
    guardChange(
      action({
        kind: "record_meal",
        meal: { date, photoIds: ["unseen"], source: "photo", items: [] },
      }),
      ctx,
    ),
    /Use Food photos attached to this message/,
  );
  ctx.reads.cardioRanges.push({ from: date, to: date });
  await assert.rejects(
    guardChange(
      action({
        kind: "record_cardio",
        cardio: { date, photoIds: ["unseen"] },
      }),
      ctx,
    ),
    /Read this activity photo with inspect_images/,
  );
});
