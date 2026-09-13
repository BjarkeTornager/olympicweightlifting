import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bracket,
  compileOutlines,
  outlinesAt,
  poseAt,
} from "../lib/video/overlay-timeline";
import {
  bendBetween,
  compileFormGuide,
  formGuideAt,
  skinPoint,
  bodyBones,
} from "../lib/video/form-guide";
import { formGuideReview } from "./fixtures/form-guide";

test("outlines cover every presented 60 FPS frame between 12 FPS observations, including repeat and reverse seek", () => {
  const a = formGuideReview().analysis!;
  const source = JSON.stringify(a);
  const frames = compileOutlines(a.segmentation);
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i <= 110; i++) {
      const t = (pass === 1 ? 110 - i : i) / 60;
      const regions = outlinesAt(frames, t);
      assert.equal(regions.length, 1, `missing at ${t}`);
      assert(
        Math.abs(
          Math.min(...regions[0].polygon.map((p) => p[0])) -
            (0.35 + t * 12 * 0.001),
        ) < 0.0001,
      );
    }
  assert.equal(
    JSON.stringify(a),
    source,
    "presentation must not mutate coaching evidence",
  );
});

test("contour winding, starting vertex and vertex count cannot make an interpolated outline twist", () => {
  const a = formGuideReview().analysis!;
  const original = a.segmentation!.frames[0].objects[0].polygon;
  a.segmentation!.frames = [
    { t: 0, objects: [{ id: "person-1", kind: "person", polygon: original }] },
    {
      t: 0.1,
      objects: [
        {
          id: "person-1",
          kind: "person",
          polygon: [original[2], original[1], original[0], original[3]],
        },
      ],
    },
  ];
  const frames = compileOutlines(a.segmentation);
  for (const p of outlinesAt(frames, 0.05)[0].polygon)
    assert(
      Math.min(
        Math.abs(p[0] - 0.35),
        Math.abs(p[0] - 0.7),
        Math.abs(p[1] - 0.2),
        Math.abs(p[1] - 0.9),
      ) < 0.001,
    );
});

test("explicit occlusion, identity changes, camera cuts and long gaps are never bridged", () => {
  const a = formGuideReview().analysis!;
  a.segmentation!.frames[5].objects = [];
  let frames = compileOutlines(a.segmentation);
  assert.deepEqual(outlinesAt(frames, 0.42), []);
  a.segmentation!.frames[5].objects = [
    { ...a.segmentation!.frames[6].objects[0], id: "person-2" },
  ];
  frames = compileOutlines(a.segmentation);
  assert.deepEqual(outlinesAt(frames, 0.42), []);
  assert.equal(bracket([{ t: 0 }, { t: 1 }], 0.4, 0.3), null);
  const points = [{ id: 11, x: 0.2, y: 0.2 }];
  assert.deepEqual(
    poseAt(
      [
        { t: 0, points },
        { t: 0.1, points: [] },
        { t: 0.2, points },
      ],
      0.05,
    ),
    [],
  );
});

test("suggested movement is continuous, different from observed, and keeps feet, hands and leg lengths", () => {
  const a = formGuideReview().analysis!,
    guide = compileFormGuide(a);
  assert(guide.available);
  let changed = 0;
  for (let i = 1; i < 110; i++) {
    const frame = formGuideAt(guide, i / 60);
    assert(frame, `missing guide at ${i / 60}`);
    if (frame.adjustment > 0.005) changed++;
    for (const id of [15, 27, 29, 31]) {
      assert.deepEqual(
        frame.suggested.find((p) => p.id === id),
        frame.observed.find((p) => p.id === id),
      );
    }
  }
  assert(changed > 15);
  for (const frame of guide.frames) {
    const maps = [frame.points, frame.suggested].map(
      (joints) => new Map(joints.map((p) => [p.id, p])),
    );
    for (const [from, to] of [
      [11, 23],
      [23, 25],
      [25, 27],
    ]) {
      const lengths = maps.map((m) =>
        Math.hypot(
          (m.get(from)!.x - m.get(to)!.x) * a.width,
          (m.get(from)!.y - m.get(to)!.y) * a.height,
        ),
      );
      assert(Math.abs(lengths[0] - lengths[1]) < 0.00001);
    }
  }
});

test("IK rejects impossible targets and skinning preserves an unchanged silhouette", () => {
  assert.equal(bendBetween([0, 0], [10, 0], [5, 0], 2, 2), null);
  const a = formGuideReview().analysis!,
    joints = a.pose!.frames[10].points;
  for (const point of [
    [0.5, 0.5],
    [0.1, 0.1],
    [0.8, 0.9],
  ] as [number, number][]) {
    const p = skinPoint(point, joints, joints, a.width, a.height);
    assert(Math.hypot(p[0] - point[0], p[1] - point[1]) < 1e-10);
  }
  assert(bodyBones.length > 10);
});

test("uncertain lifts, missing side-view evidence and separate attempts do not invent an ideal lift", () => {
  const a = formGuideReview().analysis!;
  a.identification!.status = "uncertain";
  assert.equal(compileFormGuide(a).available, false);
  a.identification!.status = "supported";
  a.pose!.frames.forEach((f) => {
    f.points = f.points.filter((p) => p.id !== 27);
  });
  assert.equal(compileFormGuide(a).available, false);
});

test("overhead guidance preserves the observed stance and grip instead of imposing a jerk split or snatch grip", () => {
  const a = formGuideReview().analysis!;
  a.identification!.lift = "Snatch";
  a.identification!.phases = [
    {
      kind: "overhead_receive",
      time: 0,
      frame: 1,
      evidence: "Synthetic overhead receive",
    },
  ];
  const coordinates: Record<number, [number, number]> = {
    11: [180, 190],
    12: [188, 190],
    13: [205, 125],
    15: [200, 65],
    23: [160, 310],
    25: [145, 365],
    27: [160, 420],
    29: [150, 430],
    31: [190, 430],
  };
  a.pose!.frames = Array.from({ length: 30 }, (_, i) => ({
    t: i / 20,
    points: Object.entries(coordinates).map(([id, [x, y]]) => ({
      id: Number(id),
      x: x / 320,
      y: y / 480,
    })),
  }));
  const guide = compileFormGuide(a);
  assert(guide.available);
  const f = formGuideAt(guide, 0.5)!;
  assert(
    f.suggested.find((p) => p.id === 11)!.x >
      f.observed.find((p) => p.id === 11)!.x,
  );
  for (const id of [15, 23, 25, 27, 29, 31])
    assert.deepEqual(
      f.suggested.find((p) => p.id === id),
      f.observed.find((p) => p.id === id),
    );
  assert.equal(f.phase, "Overhead · supported alignment");
  a.pose!.frames.forEach((f) => {
    f.points.find((p) => p.id === 12)!.x = 0.95;
  });
  assert.equal(
    compileFormGuide(a).available,
    false,
    "do not project a side-view alignment onto a front-facing body",
  );
});

test("form animation does not bridge adjacent attempts or an unreviewed interval", () => {
  const a = formGuideReview().analysis!;
  a.attempts = [
    { id: "first", start: 0, end: 0.45, identification: a.identification! },
    { id: "second", start: 0.55, end: 1.95, identification: a.identification! },
  ];
  const guide = compileFormGuide(a);
  assert(guide.available);
  assert.equal(formGuideAt(guide, 0.475), null);
  assert.equal(formGuideAt(guide, 0.5), null);
  assert.equal(formGuideAt(guide, 0.525), null);
  assert(formGuideAt(guide, 1));
});

test("a short pose occlusion keeps only the actually tracked silhouette, never a made-up correction", async () => {
  const { createOverlayTrack, renderOverlays } =
    await import("../lib/video/overlay-renderer");
  const a = formGuideReview().analysis!;
  a.pose!.frames.find((f) => f.t === 1)!.points = [];
  const colors: string[] = [];
  const ctx = {
    canvas: { width: 320, height: 480 },
    fillStyle: "",
    globalAlpha: 1,
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      colors.push(this.fillStyle);
    },
  };
  const result = renderOverlays(
    ctx as unknown as CanvasRenderingContext2D,
    createOverlayTrack(a),
    1,
    { form: true, outline: false, bar: false, cues: false },
    new Map(),
  );
  assert.equal(result.count, 1);
  assert.deepEqual(colors, ["#d5e7e54d"]);
  a.segmentation!.frames[12].objects = [];
  assert.equal(
    renderOverlays(
      ctx as unknown as CanvasRenderingContext2D,
      createOverlayTrack(a),
      1,
      { form: true, outline: false, bar: false, cues: false },
      new Map(),
    ).count,
    0,
  );
});

test("outdated lift identification cannot drive new suggested-form overlays", async () => {
  const { createOverlayTrack } = await import("../lib/video/overlay-renderer");
  const a = formGuideReview().analysis!;
  a.reviewVersion = 1;
  const track = createOverlayTrack(a);
  assert.equal(track.formAvailable, false);
  assert.deepEqual(track.moments, []);
  assert(track.outlines.length > 0);
});
