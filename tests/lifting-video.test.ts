import { test } from "node:test";
import assert from "node:assert/strict";
import { videoSampleTimes, videoReviewPrompt } from "../lib/lifting-video";
import { liftingKnowledge, liftingResources } from "../lib/lifting-resources";
import { imageUploadSchema, normalizeImage } from "../lib/user-images";
import sharp from "sharp";

test("video samples cover only the chosen interval, preserve order and avoid end-of-stream", () => {
  const times = videoSampleTimes(4, 6, 12);
  assert.equal(times.length, 24);
  assert.equal(times[0], 4);
  assert.equal(times.at(-1), 6);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]));
  assert.equal(videoSampleTimes(0, 2, 2).at(-1), 1.98);
  for (const args of [
    [0, 0.2, 1],
    [-1, 2, 3],
    [0, 7, 8],
    [0, 4, 3],
    [4, 2, 5],
    [NaN, 2, 5],
    [0, Infinity, 5],
    [0, 2, 121],
  ])
    assert.throws(() =>
      videoSampleTimes(...(args as [number, number, number])),
    );
  const prompt = videoReviewPrompt(
    "Clean",
    "60 kg",
    "My catch feels forward",
    times,
    "synthetic",
  );
  assert.match(prompt, /4.00s to 6.00s/);
  assert.match(prompt, /60 kg/);
  assert.match(prompt, /Original video and audio have not been uploaded/);
  assert.match(prompt, /advice only; do not log training/);
});

test("frame sheets retain usable resolution, strip metadata and cannot invoke classification", async () => {
  const image = await sharp({
    create: { width: 1280, height: 1920, channels: 3, background: "#6688aa" },
  })
    .jpeg()
    .withMetadata({ orientation: 1 })
    .toBuffer();
  const input = {
    id: crypto.randomUUID(),
    label: "Frame sheet",
    date: "2026-09-10",
    image: image.toString("base64"),
    purpose: "lifting-video-frames",
    autoTag: false,
  };
  assert.ok(imageUploadSchema.safeParse(input).success);
  assert.equal(
    imageUploadSchema.safeParse({ ...input, autoTag: true }).success,
    false,
  );
  assert.equal(
    imageUploadSchema.safeParse({ ...input, purpose: "public-video" }).success,
    false,
  );
  const sheet = await sharp(await normalizeImage(image, true)).metadata();
  assert.equal(sheet.width, 1280);
  assert.equal(sheet.height, 1920);
  assert.equal(sheet.exif, undefined);
  assert.equal(
    (await sharp(await normalizeImage(image)).metadata()).height,
    1280,
  );
});

test("dated learning sources separate nutrition, programming and visual evidence limits", () => {
  for (const topic of ["technique", "programming", "nutrition"] as const) {
    const knowledge = liftingKnowledge(topic);
    assert.equal(knowledge.liveSearch, false);
    assert.ok(knowledge.sources.length >= 2);
    assert.ok(
      knowledge.sources.every(
        (s) => s.topic === topic && new URL(s.url).protocol === "https:",
      ),
    );
  }
  assert.equal(
    new Set(liftingResources.map((s) => s.id)).size,
    liftingResources.length,
  );
  assert.match(
    liftingKnowledge("nutrition").guidance,
    /incomplete calories cannot establish under-fuelling/i,
  );
  assert.match(
    liftingKnowledge("nutrition").guidance,
    /Do not silently set diet targets/,
  );
  assert.match(
    liftingKnowledge("technique").guidance,
    /not calibrated capture times/,
  );
  assert.match(
    liftingKnowledge("technique").guidance,
    /not permission to log sets/,
  );
});
