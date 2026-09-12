import { test } from "node:test";
import assert from "node:assert/strict";
import { videoUploadSchema, type VideoAnalysis } from "../lib/video/types";
import {
  parseGuidedCoaching,
  focusPoints,
  evidenceFocusPoints,
  barTrailSegments,
} from "../lib/video/coaching";
import { parseVideoReview, reviewMessages } from "../lib/video/review";
import { identifyLift } from "../lib/video/identification";
import { identifyAttempts } from "../lib/video/attempts";

const evidence = {
  visibility: "sufficient",
  limitation: "",
  phases: [
    { kind: "pull", frame: 1, evidence: "Bar is lifted from below the knees." },
    {
      kind: "front_rack_receive",
      frame: 3,
      evidence: "Bar is received at the front shoulders.",
    },
    {
      kind: "leg_drive_from_rack",
      frame: 5,
      evidence: "A separate dip and drive starts from the rack.",
    },
    {
      kind: "overhead_receive",
      frame: 7,
      evidence: "The bar is received with arms overhead.",
    },
  ],
};
const analysis: VideoAnalysis = {
  version: 1,
  width: 320,
  height: 480,
  duration: 4,
  frameCount: 120,
  sampleTimes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
  tracking: {
    status: "not_requested",
    reason: "",
    points: [],
    coverage: 0,
    horizontalRangeCm: null,
    riseCm: null,
    peakUpwardVelocity: null,
    velocities: [],
  },
};
analysis.identification = identifyLift(JSON.stringify(evidence), analysis);
const reply = {
  strength: "The rack position is visible.",
  limitation: "Side-view depth is uncertain.",
  moments: [
    {
      title: "Watch the rack",
      observation:
        "The visible receiving position supports this synthetic observation.",
      cue: "Synthetic next-attempt cue",
      check: "Compare the receiving frame next time.",
      frames: [3, 4],
      focusFrame: 3,
      evidenceType: "movement",
      region: "elbows",
    },
  ],
};

test("automatic upload needs no trim or calibration; explicit timing stays bounded", () => {
  const input = {
    id: crypto.randomUUID(),
    lift: "Identify from video",
    date: "2026-09-11",
    mode: "automatic",
    start: 0,
    end: 120,
  };
  assert.ok(videoUploadSchema.safeParse(input).success);
  for (const patch of [
    { start: 10 },
    { end: 20 },
    { mode: "manual" },
    { mode: "unknown" },
  ])
    assert.equal(
      videoUploadSchema.safeParse({ ...input, ...patch }).success,
      false,
    );
});

test("guided coaching only produces moments at actual evidence frames", () => {
  const parsed = parseGuidedCoaching(JSON.stringify(reply), analysis)!;
  assert.equal(parsed.moments[0].evidenceTime, 1);
  assert.equal(parsed.moments[0].start, 0.19999999999999996);
  assert.equal(parsed.moments[0].end, 2.7);
  assert.deepEqual(parsed.moments[0].evidenceFrames, [3, 4]);
  for (const patch of [
    { frames: [100] },
    { frames: [0] },
    { region: "face" },
    { x: 0.5 },
    { observation: "This is a snatch attempt." },
  ])
    assert.equal(
      parseGuidedCoaching(
        JSON.stringify({
          ...reply,
          moments: [{ ...reply.moments[0], ...patch }],
        }),
        analysis,
      ),
      null,
    );
  assert.equal(
    parseGuidedCoaching(JSON.stringify(reply), {
      ...analysis,
      identification: undefined,
    }),
    null,
  );
  assert.deepEqual(
    parseGuidedCoaching(JSON.stringify({ ...reply, moments: [] }), analysis)
      ?.moments,
    [],
  );
});

test("partial clips receive timestamped cues without invented lift classification", () => {
  const partial = {
    ...analysis,
    identification: identifyLift(
      JSON.stringify({
        visibility: "limited",
        limitation:
          "The clip starts with the bar at the front shoulders; the preceding pull is not visible.",
        phases: [
          {
            kind: "front_rack_hold",
            frame: 1,
            evidence: "The bar is already resting at the front shoulders.",
          },
        ],
      }),
      analysis,
    ),
  };
  const result = parseGuidedCoaching(JSON.stringify(reply), partial)!;
  assert.equal(result.scope, "visible_phases");
  assert.equal(result.moments[0].evidenceTime, 1);
  assert.equal(partial.identification.lift, null);
  const missingLift = parseGuidedCoaching(
    JSON.stringify({
      ...reply,
      limitation: "The full lift and earlier clean are not visible.",
    }),
    partial,
  )!;
  assert.equal(missingLift.moments.length, 1);
  assert.equal(missingLift.limitation, partial.identification.reason);
  for (const observation of [
    "This is a snatch attempt.",
    "The full lift was visible.",
    "Your clean needs work.",
  ]) {
    assert.equal(
      parseGuidedCoaching(
        JSON.stringify({
          ...reply,
          moments: [{ ...reply.moments[0], observation }],
        }),
        partial,
      ),
      null,
    );
  }
  assert.equal(
    parseGuidedCoaching(
      JSON.stringify({
        ...reply,
        moments: [{ ...reply.moments[0], frames: [999] }],
      }),
      partial,
    ),
    null,
  );
  assert.deepEqual(
    parseGuidedCoaching(JSON.stringify({ ...reply, moments: [] }), partial)
      ?.moments,
    [],
  );
});

test("replay highlights disappear at tracking gaps rather than drifting over the video", () => {
  const tracked: VideoAnalysis = {
    ...analysis,
    pose: {
      status: "partial",
      reason: "",
      frames: [
        {
          t: 1,
          points: [
            { id: 13, x: 0.4, y: 0.5 },
            { id: 25, x: 0.4, y: 0.8 },
          ],
        },
        { t: 1.1, points: [] },
        { t: 2, points: [{ id: 13, x: 0.5, y: 0.4 }] },
      ],
    },
  };
  assert.equal(focusPoints(tracked, "elbows", 1.05).length, 1);
  assert.equal(focusPoints(tracked, "elbows", 1.15).length, 0);
  assert.equal(focusPoints(tracked, "elbows", 1.95).length, 0);
  assert.equal(focusPoints(tracked, "bar", 1.05).length, 0);
  assert.equal(focusPoints(tracked, "whole_lift", 1.05).length, 0);
});

test("automatic attempt boundaries must be ordered and contain the complete phase evidence", () => {
  const attempt = { startFrame: 1, endFrame: 9, evidence };
  const parse = (attempts: unknown[]) =>
    identifyAttempts(
      JSON.stringify({ attempts }),
      analysis,
      "Identify from video",
    );
  assert.equal(parse([attempt])[0].identification.lift, "Clean & jerk");
  for (const attempts of [
    [{ ...attempt, endFrame: 3 }],
    [attempt, attempt],
    [{ ...attempt, endFrame: 100 }],
    [],
  ])
    assert.equal(parse(attempts)[0].identification.status, "uncertain");
  assert.equal(
    identifyAttempts(
      JSON.stringify({ attempts: [attempt] }),
      analysis,
      "Snatch",
    )[0].identification.lift,
    null,
  );
});

test("the dense review independently corrects an earlier snatch guess using a visible rack and later overhead drive", () => {
  const wrong = {
    ...analysis,
    identification: { ...analysis.identification!, lift: "Snatch" as const },
  };
  const input = videoUploadSchema.parse({
    id: crypto.randomUUID(),
    lift: "Identify from video",
    date: "2026-09-12",
    start: 0,
    end: 4,
  });
  const messages = reviewMessages(input, wrong, ["synthetic-dense-frames"]);
  const request = JSON.parse(messages[1].content);
  assert.equal(request.lift, undefined);
  assert.equal(request.identification, undefined);
  const reviewed = parseVideoReview(
    JSON.stringify({ evidence, coaching: reply }),
    wrong,
    input,
  )!;
  assert.equal(reviewed.identification.lift, "Clean & jerk");
  assert.equal(reviewed.coaching.moments.length, 1);
  assert.equal(
    parseVideoReview(
      JSON.stringify({
        evidence: {
          ...evidence,
          phases: [{ ...evidence.phases[0], frame: 999 }],
        },
        coaching: reply,
      }),
      wrong,
      input,
    ),
    null,
  );
  const notLifting = parseVideoReview(
    JSON.stringify({
      evidence: {
        visibility: "not_lifting",
        phases: [],
        limitation: "No lifter is visible.",
      },
      coaching: reply,
    }),
    wrong,
    input,
  )!;
  assert.deepEqual(notLifting.coaching.moments, []);
  assert.equal(notLifting.coaching.strength, "");
});

test("freeze frame is chosen from evidence; one still cannot substantiate movement", () => {
  const atSecond = {
    ...reply,
    moments: [{ ...reply.moments[0], focusFrame: 4 }],
  };
  assert.equal(
    parseGuidedCoaching(JSON.stringify(atSecond), analysis)?.moments[0]
      .evidenceTime,
    1.5,
  );
  for (const patch of [
    { focusFrame: 8 },
    { frames: [3], focusFrame: 3, evidenceType: "movement" },
    { frames: [3, 3], focusFrame: 3, evidenceType: "movement" },
    { frames: [1, 9], focusFrame: 9 },
  ])
    assert.equal(
      parseGuidedCoaching(
        JSON.stringify({
          ...reply,
          moments: [{ ...reply.moments[0], ...patch }],
        }),
        analysis,
      ),
      null,
    );
  assert.ok(
    parseGuidedCoaching(
      JSON.stringify({
        ...reply,
        moments: [
          { ...reply.moments[0], frames: [3], evidenceType: "position" },
        ],
      }),
      analysis,
    ),
  );
});

test("inspection highlights use only the exact evidence frame and bar trails do not bridge gaps", () => {
  const moment = parseGuidedCoaching(JSON.stringify(reply), analysis)!
    .moments[0];
  const tracked: VideoAnalysis = {
    ...analysis,
    pose: {
      version: 2,
      status: "partial",
      reason: "Synthetic",
      frames: [
        { t: 0.95, points: [{ id: 13, x: 0.2, y: 0.2 }] },
        { t: 1, points: [{ id: 13, x: 0.4, y: 0.5 }] },
        { t: 1.5, points: [] },
      ],
    },
  };
  assert.deepEqual(evidenceFocusPoints(tracked, moment, 1), [
    { id: 13, x: 0.4, y: 0.5 },
  ]);
  assert.deepEqual(evidenceFocusPoints(tracked, moment, 0.95), []);
  assert.deepEqual(evidenceFocusPoints(tracked, moment, 1.5), []);
  assert.deepEqual(
    evidenceFocusPoints(
      { ...tracked, pose: { ...tracked.pose!, version: 1 } },
      moment,
      1,
    ),
    [],
  );
  tracked.tracking.points = [0, 0.05, 0.1, 1, 1.05, 1.1, 4].map((t) => ({
    t,
    x: 0.5,
    y: 0.5,
    score: 1,
  }));
  assert.deepEqual(
    barTrailSegments(tracked, 1.1).map((s) => s.map((p) => p.t)),
    [
      [0, 0.05, 0.1],
      [1, 1.05, 1.1],
    ],
  );
  assert.deepEqual(barTrailSegments(tracked, 4), []);
});
