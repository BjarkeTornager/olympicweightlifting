import { test } from "node:test";
import assert from "node:assert/strict";
import {
  identifyLift,
  identificationMessages,
  identificationSummary,
  feedbackMatchesLift,
} from "../lib/video/identification";
import type { VideoAnalysis } from "../lib/video/types";
import { videoUploadSchema } from "../lib/video/types";
const analysis: VideoAnalysis = {
  version: 1,
  width: 320,
  height: 480,
  duration: 15,
  frameCount: 450,
  sampleTimes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  tracking: {
    status: "not_requested",
    reason: "No marker",
    points: [],
    coverage: 0,
    horizontalRangeCm: null,
    riseCm: null,
    peakUpwardVelocity: null,
    velocities: [],
  },
};
const phase = (kind: string, frame: number) => ({
  kind,
  frame,
  evidence: "Synthetic observation of this movement phase.",
});
const identify = (
  phases: ReturnType<typeof phase>[],
  visibility = "sufficient",
) =>
  identifyLift(
    JSON.stringify({ visibility, phases, limitation: "" }),
    analysis,
  );

test("clean then rack then jerk is not reclassified as a snatch by a selected label", () => {
  const result = identify([
    phase("pull", 2),
    phase("front_rack_receive", 5),
    phase("front_rack_hold", 8),
    phase("leg_drive_from_rack", 11),
    phase("overhead_receive", 13),
  ]);
  assert.equal(result.lift, "Clean & jerk");
  assert.match(
    identificationSummary(result, "Snatch"),
    /You selected Snatch; the visible sequence instead suggests Clean & jerk/,
  );
  assert.equal(
    feedbackMatchesLift("This is a clear snatch attempt.", result.lift!),
    false,
  );
  const messages = identificationMessages(analysis, ["synthetic"]);
  assert.equal(JSON.parse(messages[1].content).lift, undefined);
  assert.deepEqual(messages[1].images, ["synthetic"]);
  assert.ok(
    videoUploadSchema.safeParse({
      id: crypto.randomUUID(),
      lift: "Identify from video",
      date: "2026-09-11",
      start: 0,
      end: 15,
    }).success,
  );
});

test("a final overhead position, sparse gap or conflicting phases cannot establish a snatch", () => {
  for (const phases of [
    [phase("pull", 2), phase("overhead_receive", 13)],
    [phase("front_rack_hold", 5), phase("overhead_receive", 13)],
    [
      phase("pull", 2),
      phase("front_rack_receive", 5),
      phase("direct_pull_to_overhead", 11),
      phase("overhead_receive", 13),
    ],
    [
      phase("pull", 2),
      phase("front_rack_receive", 5),
      phase("leg_drive_from_rack", 11),
      phase("overhead_receive", 13),
    ],
  ]) {
    const result = identify(
      phases,
      phases.length === 4 && phases[2].kind === "leg_drive_from_rack"
        ? "limited"
        : "sufficient",
    );
    assert.equal(result.lift, null);
    assert.match(
      identificationSummary(result, "Snatch"),
      /withheld lift-specific/,
    );
  }
});

test("distinct clean, jerk-only and continuous snatch sequences remain distinguishable", () => {
  assert.equal(
    identify([phase("pull", 2), phase("front_rack_receive", 5)]).lift,
    "Clean",
  );
  assert.equal(
    identify([
      phase("front_rack_hold", 2),
      phase("leg_drive_from_rack", 5),
      phase("overhead_receive", 8),
    ]).lift,
    "Jerk",
  );
  assert.equal(
    identify([
      phase("pull", 2),
      phase("direct_pull_to_overhead", 5),
      phase("overhead_receive", 8),
    ]).lift,
    "Snatch",
  );
  assert.equal(
    feedbackMatchesLift(
      "The front rack is visible; review the jerk separately.",
      "Clean",
    ),
    false,
  );
});

test("invalid timestamps, repeated lifts, invented frame numbers and malformed output withhold classification", () => {
  for (const phases of [
    [phase("pull", 9), phase("front_rack_receive", 3)],
    [phase("pull", 1), phase("front_rack_receive", 90)],
    [phase("pull", 2), phase("front_rack_receive", 2)],
    [
      phase("pull", 2),
      phase("front_rack_receive", 5),
      phase("pull", 8),
      phase("front_rack_receive", 10),
    ],
  ])
    assert.equal(identify(phases).lift, null);
  assert.equal(
    identifyLift("This is a clear snatch attempt.", analysis).lift,
    null,
  );
  assert.equal(identify([], "not_lifting").lift, null);
});
