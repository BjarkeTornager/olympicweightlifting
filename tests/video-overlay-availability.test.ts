import { test } from "node:test";
import assert from "node:assert/strict";
import { formGuideReview } from "./fixtures/form-guide";
import { createOverlayTrack } from "../lib/video/overlay-renderer";
import { timedObservations } from "../lib/video/observations";
import { barTrailSegments } from "../lib/video/coaching";

test("recorded body and timed observations remain available without invented corrections", () => {
  const a = formGuideReview().analysis!;
  a.pose = undefined;
  a.coaching!.moments = [];
  a.body = {
    version: 1,
    model: "sam-3d-body",
    revision: "11aaa346c7204874a1cbafe3d39a979080b2c55a",
    sourceSha256: "a".repeat(64),
    width: 320,
    height: 480,
    status: "partial",
    reason: "Observed only",
    frames: [
      { t: 0, image: "synthetic" },
      { t: 0.2, image: "synthetic" },
    ],
    motion: {
      version: 1,
      status: "unavailable",
      reason: "No correction justified",
      clips: [],
    },
  };
  const before = JSON.stringify(a);
  const track = createOverlayTrack(a);
  assert.equal(track.formAvailable, false);
  assert.equal(track.bodyAvailable, true);
  assert.equal(track.moments.length, 0);
  assert(track.observations.length > 0);
  for (const observation of track.observations) {
    assert(
      observation.start <= observation.time &&
        observation.end >= observation.time,
    );
    assert(
      a.identification!.phases.some(
        (p) =>
          p.time === observation.time && p.evidence === observation.observation,
      ),
    );
  }
  assert.equal(JSON.stringify(a), before);
  a.body.frames[1].t = 1;
  assert.equal(
    createOverlayTrack(a).bodyAvailable,
    false,
    "isolated images are not a motion layer",
  );
});

test("observations respect source time, attempt boundaries, and current identification", () => {
  const a = formGuideReview().analysis!;
  a.attempts = [
    {
      id: "second",
      start: 1,
      end: 2,
      identification: {
        ...a.identification!,
        phases: [
          {
            kind: "pull",
            time: 0.5,
            frame: 1,
            evidence: "Outside this attempt",
          },
          {
            kind: "overhead_receive",
            time: 1.5,
            frame: 3,
            evidence: "Bar received overhead",
          },
        ],
      },
    },
  ];
  const observations = timedObservations(a);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].start, 1);
  assert.equal(observations[0].end, 2);
  a.reviewVersion = 1;
  assert.deepEqual(timedObservations(a), []);
});

test("automatic bar paths never join different attempts or large spatial jumps", () => {
  const a = formGuideReview().analysis!;
  a.tracking.points = [0, 0.05, 0.1, 0.15].map((t, i) => ({
    t,
    x: 0.4,
    y: 0.6,
    score: 0.8,
    segment: i < 2 ? "first" : "second",
  }));
  assert.equal(barTrailSegments(a, 0.15).length, 2);
  a.tracking.points[3].x = 0.9;
  assert.equal(barTrailSegments(a, 0.15).length, 1);
});
