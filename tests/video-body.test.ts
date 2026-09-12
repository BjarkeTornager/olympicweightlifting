import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  bodyConfigurationForAccount,
  reconstructBody,
} from "../lib/video/body-server";
import {
  evidenceSeekTime,
  bodyFrameAt,
  bodyReplayAction,
  mergeBody,
  type VideoBody,
} from "../lib/video/body";
import { correctionAnalysis } from "./fixtures/correction";
const media = Buffer.from("synthetic normalized video"),
  hash = createHash("sha256").update(media).digest("hex");
const config = {
  endpoint: "https://body.example.test/body",
  token: "synthetic-test-token-".repeat(3),
};
const signal = () => new AbortController().signal;
function analysis() {
  const a = correctionAnalysis();
  a.sampleTimes = [0.5, 1];
  a.segmentation = {
    version: 1,
    model: "sam3.1",
    revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
    sourceSha256: hash,
    width: 320,
    height: 480,
    status: "tracked",
    reason: "Synthetic",
    frames: [0.5, 1].map((t) => ({
      t,
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
    })),
  };
  return a;
}
async function result(): Promise<VideoBody> {
  const png = await sharp({
    create: {
      width: 320,
      height: 480,
      channels: 4,
      background: { r: 20, g: 180, b: 160, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  return {
    version: 1,
    model: "sam-3d-body",
    revision: "11aaa346c7204874a1cbafe3d39a979080b2c55a",
    sourceSha256: hash,
    width: 320,
    height: 480,
    status: "tracked",
    reason: "Synthetic",
    frames: [
      { t: 0.5, image: `data:image/png;base64,${png.toString("base64")}` },
      { t: 1 },
    ],
  };
}
test("3D dispatch is limited to a verified pilot; missing or unrelated masks never send video", async () => {
  const env = {
    VIDEO_SAM3_PILOT_EMAIL: "pilot@example.test",
    VIDEO_BODY_URL: config.endpoint,
    VIDEO_SAM3_TOKEN: config.token,
  };
  assert.deepEqual(
    bodyConfigurationForAccount(
      { email: "PILOT@example.test", emailVerified: true },
      env,
    ),
    config,
  );
  for (const account of [
    { email: "other@example.test", emailVerified: true },
    { email: "pilot@example.test", emailVerified: false },
  ])
    assert.deepEqual(bodyConfigurationForAccount(account, env), {});
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw Error("should not send");
  };
  assert.equal(
    await reconstructBody(media, analysis(), signal(), {}, fetcher),
    undefined,
  );
  const a = analysis();
  a.segmentation!.sourceSha256 = "0".repeat(64);
  assert.equal(
    (await reconstructBody(media, a, signal(), config, fetcher))?.status,
    "unavailable",
  );
  a.segmentation!.sourceSha256 = hash;
  a.segmentation!.frames = [];
  assert.equal(
    (await reconstructBody(media, a, signal(), config, fetcher))?.status,
    "unavailable",
  );
  assert.equal(calls, 0);
});
test("3D sends only matching normalized media and selected polygons; validates PNG frame geometry", async () => {
  const expected = await result();
  const actual = await reconstructBody(
    media,
    analysis(),
    signal(),
    config,
    async (url, options) => {
      assert.equal(String(url), config.endpoint);
      assert.equal(options?.redirect, "error");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("content-type"), "application/octet-stream");
      assert.equal(headers.get("authorization"), `Bearer ${config.token}`);
      const bytes = Buffer.from(options?.body as Uint8Array),
        n = bytes.readUInt32BE(0),
        m = JSON.parse(bytes.subarray(4, n + 4).toString());
      assert.deepEqual(bytes.subarray(n + 4), media);
      assert.equal(m.sha256, hash);
      assert.deepEqual(Object.keys(m).sort(), [
        "duration",
        "frames",
        "height",
        "motionVersion",
        "sha256",
        "version",
        "width",
      ]);
      return Response.json(expected);
    },
  );
  assert.deepEqual(actual, expected);
  for (const bad of [
    { ...expected, sourceSha256: "0".repeat(64) },
    {
      ...expected,
      motion: {
        version: 1,
        status: "available",
        reason: "Unexpected correction",
        clips: [{ id: "not-requested", start: 0.5, end: 1, frames: [] }],
      },
    },
    { ...expected, frames: [expected.frames[1], expected.frames[0]] },
    {
      ...expected,
      frames: [
        { t: 0.5, image: "https://external.test/image" },
        expected.frames[1],
      ],
    },
  ])
    assert.equal(
      (
        await reconstructBody(media, analysis(), signal(), config, async () =>
          Response.json(bad),
        )
      )?.status,
      "unavailable",
    );
});
test("body shadows clear during missing frames and gaps; retries never keep stale images", async () => {
  const b = await result();
  assert.ok(bodyFrameAt(b, 0.5)?.image);
  assert.equal(bodyFrameAt(b, 0.499), undefined);
  assert.ok(bodyFrameAt(b, evidenceSeekTime(0.5))?.image);
  assert.equal(bodyFrameAt(b, 0.7), undefined);
  assert.equal(bodyReplayAction(b, 0.5, null).kind, "capture");
  assert.equal(bodyReplayAction(b, 1, 0.5).kind, "clear");
  assert.equal(bodyReplayAction(b, 0.6, 0.5).kind, "clear"); // half-second gap cannot hold
  b.frames[1].t = 0.7;
  assert.equal(bodyReplayAction(b, 0.6, 0.5).kind, "hold");
  assert.equal(bodyReplayAction(b, 0.7, 0.5).kind, "clear");
  const merged = mergeBody(
    b,
    { ...b, status: "unavailable", frames: [] },
    0.4,
    0.6,
  );
  assert.deepEqual(merged.frames, [b.frames[1]]);
  assert.deepEqual(
    mergeBody(b, { ...b, sourceSha256: "0".repeat(64), frames: [] }, 0, 1)
      .frames,
    [],
  );
});

test("rounded source timestamps seek inside the intended frame, including a bounded video end", () => {
  const fps = 60,
    actual = 161 / fps,
    stored = Number(actual.toFixed(6));
  assert.equal(Math.floor(stored * fps), 160);
  assert.equal(Math.floor(evidenceSeekTime(stored) * fps), 161);
  assert.ok(evidenceSeekTime(stored) - actual < 1 / 120);
  assert.equal(evidenceSeekTime(2, 2), 2);
});
