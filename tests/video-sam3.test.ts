import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { segmentVideo } from "../lib/video/sam3";
import {
  mergeSegmentation,
  segmentationAt,
  segmentationEvidence,
  type VideoSegmentation,
} from "../lib/video/segmentation";
import type { VideoAnalysis } from "../lib/video/types";

const media = Buffer.from("synthetic mp4 fixture");
const segmentation: VideoSegmentation = {
  version: 1,
  model: "sam3.1",
  revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
  sourceSha256: createHash("sha256").update(media).digest("hex"),
  status: "partial",
  reason: "Synthetic",
  width: 320,
  height: 480,
  frames: [
    {
      t: 0,
      objects: [
        {
          id: "person-1",
          kind: "person",
          polygon: [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.9, 0.9],
            [0.1, 0.9],
          ],
        },
      ],
    },
    { t: 0.1, objects: [] },
    {
      t: 0.2,
      objects: [
        {
          id: "person-1",
          kind: "person",
          polygon: [
            [0.2, 0.1],
            [0.8, 0.1],
            [0.8, 0.9],
            [0.2, 0.9],
          ],
        },
      ],
    },
  ],
};
const analysis: VideoAnalysis = {
  version: 1,
  width: 320,
  height: 480,
  duration: 2,
  frameCount: 61,
  sampleTimes: [0, 1, 2],
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
const config = {
  endpoint: "https://sam.example.test/segment",
  token: "test-token-".repeat(4),
};

test("SAM posts only sanitized video and geometry to the configured authenticated endpoint", async () => {
  let calls = 0;
  const result = await segmentVideo(
    media,
    analysis,
    new AbortController().signal,
    config,
    async (url, options) => {
      calls++;
      assert.equal(String(url), config.endpoint);
      assert.equal(options?.redirect, "error");
      assert.equal(options?.cache, "no-store");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${config.token}`);
      assert.deepEqual(Buffer.from(options?.body as Uint8Array), media);
      const manifest = JSON.parse(headers.get("x-sam3-manifest")!);
      assert.deepEqual(Object.keys(manifest).sort(), [
        "anchors",
        "duration",
        "height",
        "sampleTimes",
        "sha256",
        "version",
        "width",
      ]);
      return Response.json(segmentation);
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, segmentation);
  assert.equal(analysis.tracking.peakUpwardVelocity, null);
});

test("disabled or incomplete configuration never sends media; failures preserve a usable review", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    throw Error("private provider error");
  };
  const signal = new AbortController().signal;
  assert.equal(
    await segmentVideo(media, analysis, signal, {}, request),
    undefined,
  );
  for (const bad of [
    { endpoint: config.endpoint },
    { ...config, endpoint: "http://sam.example.test" },
    { ...config, endpoint: "https://user:password@sam.example.test" },
    { ...config, endpoint: "https://sam.example.test?token=secret" },
  ]) {
    assert.equal(
      (await segmentVideo(media, analysis, signal, bad, request))?.status,
      "unavailable",
    );
  }
  assert.equal(calls, 0);
  const failed = await segmentVideo(media, analysis, signal, config, request);
  assert.equal(failed?.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(failed), /private provider|test-token/);
});

test("reject mismatched media, unsafe geometry, stale model and invalid timelines", async () => {
  for (const bad of [
    { ...segmentation, sourceSha256: "0".repeat(64) },
    { ...segmentation, width: 640 },
    { ...segmentation, model: "sam3" },
    {
      ...segmentation,
      frames: [segmentation.frames[0], segmentation.frames[0]],
    },
    { ...segmentation, frames: [{ ...segmentation.frames[0], t: 3 }] },
    {
      ...segmentation,
      frames: [
        {
          t: 0,
          objects: [
            {
              id: "person-1",
              kind: "person",
              polygon: [
                [2, 0],
                [0, 0],
                [1, 1],
              ],
            },
          ],
        },
      ],
    },
  ]) {
    const result = await segmentVideo(
      media,
      analysis,
      new AbortController().signal,
      config,
      async () => Response.json(bad),
    );
    assert.equal(result?.status, "unavailable");
    assert.deepEqual(result?.frames, []);
  }
});

test("oversized and redirected GPU responses fail without leaking upstream content", async () => {
  for (const response of [
    new Response("x".repeat(2_000_001)),
    new Response("private", { status: 302 }),
    new Response("private", { status: 500 }),
  ]) {
    const result = await segmentVideo(
      media,
      analysis,
      new AbortController().signal,
      config,
      async () => response,
    );
    assert.equal(result?.status, "unavailable");
  }
});

test("account cancellation aborts instead of masquerading as an optional tracking failure", async () => {
  const abort = new AbortController();
  await assert.rejects(
    segmentVideo(media, analysis, abort.signal, config, async () => {
      abort.abort();
      throw Error("cancelled");
    }),
    /abort/i,
  );
});

test("outlines never interpolate across motion or fill an explicitly empty occlusion frame", () => {
  assert.equal(segmentationAt(segmentation, 0).length, 1);
  assert.deepEqual(segmentationAt(segmentation, 0.05), []);
  assert.deepEqual(segmentationAt(segmentation, 0.1), []);
  assert.deepEqual(segmentationAt(segmentation, 10), []);
  assert.deepEqual(segmentationAt(segmentation, NaN), []);
  const evidence = segmentationEvidence(segmentation, [0, 0.05, 0.1, 0.2]);
  assert.deepEqual(
    evidence?.frames.map((f) => f.frame),
    [1, 4],
  );
  assert.match(evidence!.purpose, /do not establish.*bar centres/);
});

test("retry drops stale masks for that attempt, preserves other attempts and never combines videos", () => {
  const failed = {
    ...segmentation,
    status: "unavailable" as const,
    frames: [],
  };
  const merged = mergeSegmentation(segmentation, failed, 0, 0.15);
  assert.deepEqual(
    merged.frames.map((f) => f.t),
    [0.2],
  );
  assert.equal(merged.status, "partial");
  assert.equal(
    mergeSegmentation(segmentation, failed, 0, 2).status,
    "unavailable",
  );
  assert.deepEqual(
    mergeSegmentation(
      segmentation,
      { ...failed, sourceSha256: "1".repeat(64) },
      0,
      0.15,
    ).frames,
    [],
  );
});
