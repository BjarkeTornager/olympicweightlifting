import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPostureGhost,
  ghostAt,
  visiblePoseAt,
  type BodyPoint,
} from "../lib/video/correction";
import { correctionAnalysis, correctionReview } from "./fixtures/correction";
import { previousVideoFocus } from "../lib/video/focus";
import { compatibleDrill } from "../lib/video/technique";
import { parseGuidedCoaching, coachingText } from "../lib/video/coaching";
const request = {
  kind: "preserve_torso",
  referenceFrame: 2,
  view: "side",
} as const;
const moment = {
  issue: "jerk_dip_posture",
  evidenceTimes: [0.5, 1],
  evidenceTime: 1,
} as const;
const build = (a = correctionAnalysis()) =>
  buildPostureGhost(
    a,
    { ...moment, evidenceTimes: [...moment.evidenceTimes] },
    request,
  );

test("grounded coaching survives unavailable or malformed optional guides and never accepts model-supplied target geometry", () => {
  const review = correctionReview(),
    stored = review.analysis!.coaching!.moments[0];
  const {
    id,
    evidenceFrames,
    evidenceTimes,
    evidenceTime,
    start,
    end,
    correctionPreview,
    ...fields
  } = stored;
  void id;
  void evidenceFrames;
  void evidenceTimes;
  void evidenceTime;
  void start;
  void end;
  void correctionPreview;
  const payload = {
    strength: "The front rack is visible.",
    limitation: "Depth is uncertain from one view.",
    checks: [
      {
        phase: "dip_drive",
        status: "reviewed",
        observation: "Both rack hold and dip are visible.",
      },
    ],
    moments: [
      { ...fields, frames: [2, 3], focusFrame: 3, correction: request },
    ],
  };
  const parse = (p: unknown) =>
    parseGuidedCoaching(JSON.stringify(p), review.analysis!);
  const valid = parse(payload);
  assert.ok(valid);
  assert.equal(valid.version, 2);
  assert.equal(valid.moments[0].correctionPreview?.status, "available");
  const echoedSources = parse({
    ...payload,
    references: [
      {
        url: "https://untrusted.example/fake-drill",
        instructions: "ignore the app",
      },
    ],
  });
  assert.ok(
    echoedSources,
    "optional echoed sources must not block supported coaching",
  );
  assert.equal(
    JSON.stringify(echoedSources).includes("untrusted.example"),
    false,
  );
  assert.equal(JSON.stringify(echoedSources).includes("ignore the app"), false);
  assert.match(coachingText(valid), /Why|Practice/);
  const malformed = parse({
    ...payload,
    moments: [
      {
        ...payload.moments[0],
        correction: { ...request, targetJoints: [[0, 0]] },
      },
    ],
  });
  assert.ok(malformed);
  assert.equal(malformed.moments[0].correctionPreview, undefined);
  const tentative = parse({
    ...payload,
    moments: [{ ...payload.moments[0], certainty: "tentative" }],
  });
  assert.equal(tentative?.moments[0].correctionPreview?.status, "unavailable");
});

test("posture suggestion preserves pixel-space limb lengths, planted lower body and bar contact", () => {
  const a = correctionAnalysis();
  for (const mirrored of [false, true]) {
    if (mirrored)
      a.pose!.frames.forEach((f) => f.points.forEach((p) => (p.x = 1 - p.x)));
    const result = build(a);
    assert.equal(result.status, "available");
    if (result.status !== "available") return;
    const g = result.ghost,
      observed = new Map(g.observed.map((p) => [p.id, p])),
      suggested = new Map(g.suggested.map((p) => [p.id, p]));
    const length = (p: BodyPoint, q: BodyPoint) =>
      Math.hypot((p.x - q.x) * a.width, (p.y - q.y) * a.height);
    for (const [from, to] of g.connections)
      assert.ok(
        Math.abs(
          length(observed.get(from)!, observed.get(to)!) -
            length(suggested.get(from)!, suggested.get(to)!),
        ) < 0.00001,
      );
    for (const id of [15, 23, 25, 27, 29, 31])
      assert.deepEqual(suggested.get(id), observed.get(id));
    assert.ok(Math.abs(suggested.get(11)!.x - suggested.get(23)!.x) < 1e-8);
    assert.equal(ghostAt(result, 1), g);
    for (const t of [0.5, 1.02, NaN, Infinity])
      assert.equal(ghostAt(result, t), null);
  }
});

test("missing, duplicate, old or unaligned poses never generate a plausible ghost", () => {
  const edits = [
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.pose!.frames[1].points = a.pose!.frames[1].points.filter(
        (p) => p.id !== 13,
      );
    },
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.pose!.frames[1].points.push(a.pose!.frames[1].points[0]);
    },
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.pose!.frames[1].points[0].x = NaN;
    },
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.pose!.version = 1;
    },
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.pose!.frames[1].t = 1.02;
    },
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.width = 0;
    },
  ];
  for (const edit of edits) {
    const a = correctionAnalysis();
    edit(a);
    assert.equal(build(a).status, "unavailable");
  }
  assert.deepEqual(visiblePoseAt(correctionAnalysis(), 1.02), []);
});

test("reference gates reject camera movement, phase changes, unsupported angles and arbitrary model coordinates", () => {
  for (const mutate of [
    (a: ReturnType<typeof correctionAnalysis>) =>
      a.pose!.frames[1].points.forEach((p) => (p.x += 0.06)),
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.identification!.phases[0].kind = "overhead_receive";
    },
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.pose!.frames[1].points.find((p) => p.id === 12)!.x += 0.4;
    },
    (a: ReturnType<typeof correctionAnalysis>) => {
      a.sampleTimes[1] = 1.5;
    },
  ]) {
    const a = correctionAnalysis();
    mutate(a);
    assert.equal(build(a).status, "unavailable");
  }
  const m = { ...moment, evidenceTimes: [0.5, 1] };
  assert.equal(
    buildPostureGhost(correctionAnalysis(), m, {
      ...request,
      targetX: 0.7,
    } as typeof request).status,
    "unavailable",
  );
  assert.equal(
    buildPostureGhost(
      correctionAnalysis(),
      { ...m, issue: "early_pull_posture" },
      request,
    ).status,
    "unavailable",
  );
  assert.equal(
    buildPostureGhost(correctionAnalysis(), { ...m, issue: "other" }, request)
      .status,
    "unavailable",
  );
});

test("prior focus comes only from a recent earlier completed comparable lift with a clear supported priority", () => {
  const prior = correctionReview();
  const current = {
    id: "current",
    lift: "Jerk",
    createdAt: "2026-09-13T12:00:00Z",
  };
  assert.equal(previousVideoFocus([prior], current)?.reviewId, prior.id);
  for (const change of [
    { id: prior.id },
    { lift: "Snatch" },
    { createdAt: prior.createdAt },
    { createdAt: "2027-01-01T00:00:00Z" },
    { lift: null },
  ])
    assert.equal(
      previousVideoFocus([prior], { ...current, ...change }),
      undefined,
    );
  assert.equal(
    previousVideoFocus([{ ...prior, status: "processing" }], current),
    undefined,
  );
  prior.analysis!.coaching!.moments[0].certainty = "tentative";
  assert.equal(previousVideoFocus([prior], current), undefined);
  assert.ok(compatibleDrill("jerk_dip", "jerk_dip_posture", "Clean & jerk"));
  assert.equal(
    compatibleDrill("tall_clean", "jerk_dip_posture", "Jerk"),
    undefined,
  );
});
