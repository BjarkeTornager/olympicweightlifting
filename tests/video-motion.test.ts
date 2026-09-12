import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeSuggestedMotion,
  suggestedMotionSchema,
} from "../lib/video/motion";
import { movementTargets } from "../lib/video/motion-plan";
import { correctionReview } from "./fixtures/correction";
test("motion targets require a supported personal reference and a clear cue", () => {
  const a = correctionReview().analysis!;
  const targets = movementTargets(a);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].referenceTime, 0.5);
  assert.equal(targets[0].focusTime, 1);
  assert.deepEqual(
    targets[0].reference.map((p) => p.id),
    targets[0].observed.map((p) => p.id),
  );
  a.coaching!.moments[0].certainty = "tentative";
  assert.deepEqual(movementTargets(a), []);
  a.coaching!.moments[0].certainty = "clear";
  a.pose = undefined;
  assert.deepEqual(movementTargets(a), []);
});
test("a retried motion replaces old frames rather than retaining stale corrections", () => {
  const old = {
    version: 1 as const,
    status: "available" as const,
    reason: "Synthetic",
    clips: [
      {
        id: "a",
        start: 0,
        end: 1,
        frames: [{ t: 0.5, image: "private-old-image" }],
      },
      {
        id: "b",
        start: 2,
        end: 3,
        frames: [{ t: 2.5, image: "private-good-image" }],
      },
    ],
  };
  const current = {
    version: 1 as const,
    status: "unavailable" as const,
    reason: "Insufficient evidence",
    clips: [{ id: "a", start: 0, end: 1, frames: [{ t: 0.5 }] }],
  };
  const result = mergeSuggestedMotion(old, current, 0, 1)!;
  assert.equal(result.status, "partial");
  assert.equal(result.clips[0].frames[0].image, undefined);
  assert.equal(result.clips[1].frames[0].image, "private-good-image");
  assert.equal(
    suggestedMotionSchema.safeParse(old).success,
    false,
    "external or malformed images cannot render",
  );
});
