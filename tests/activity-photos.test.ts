import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { saveCardio } from "../lib/cardio";
import { foodSnapshotForClient } from "../lib/food-compatibility";
import {
  authorizeActivityPhoto,
  consumeActivityPhoto,
} from "../lib/activity-photo-client";

test("Automatic photo logging requires an upload handoff for the same account, once", () => {
  const imageId = crypto.randomUUID();
  assert.equal(consumeActivityPhoto("a", imageId), false);
  authorizeActivityPhoto("a", imageId);
  assert.equal(consumeActivityPhoto("b", imageId), false);
  assert.equal(consumeActivityPhoto("a", imageId), true);
  assert.equal(consumeActivityPhoto("a", imageId), false);
});

test("Cached browsers receive compatible cardio records without discarding stored photo links", () => {
  const state = emptyJournal();
  const photoId = crypto.randomUUID();
  saveCardio(
    state,
    {
      activity: "walking",
      date: "2026-09-12",
      durationSeconds: 1200,
      photoIds: [photoId],
    },
    "2026-09-12",
  );
  const snapshot = { state, revision: 1 };
  const legacy = foodSnapshotForClient(
    new Request("https://example.test/api/journal", {
      headers: { "x-food-tags-version": "1" },
    }),
    snapshot,
  );
  assert.equal(legacy.state.cardio.sessions[0].photoIds, undefined);
  assert.deepEqual(snapshot.state.cardio.sessions[0].photoIds, [photoId]);
  const current = foodSnapshotForClient(
    new Request("https://example.test/api/journal", {
      headers: { "x-activity-photos-version": "1" },
    }),
    snapshot,
  );
  assert.deepEqual(current.state.cardio.sessions[0].photoIds, [photoId]);
});
