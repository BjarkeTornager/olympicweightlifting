import { test, expect, browserUser } from "./fixtures";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { SavedVideoReview } from "../../lib/video/types";
const fixture = path.resolve("tests/fixtures/lifting-motion.mp4");
test("a limited review explains missing corrections and outlines without offering an empty overlay toggle", async ({
  page,
  context,
}) => {
  const review: SavedVideoReview = {
    ...saved("00000000-0000-4000-8000-000000000022"),
    status: "ready",
    stage: "Review ready",
    hasMedia: true,
    analysis: {
      version: 1,
      reviewVersion: 2,
      width: 320,
      height: 480,
      duration: 2,
      frameCount: 60,
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
      coaching: {
        version: 1,
        strength: "Synthetic visible observation.",
        limitation: "The view is limited.",
        moments: [],
      },
      segmentation: {
        version: 1,
        model: "sam3.1",
        revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
        sourceSha256: "a".repeat(64),
        status: "unavailable",
        reason: "No reliable subject match.",
        width: 320,
        height: 480,
        frames: [{ t: 0, objects: [] }],
      },
    },
  };
  await context.route("**/api/lifting-videos", (r) =>
    r.fulfill({ json: { videos: [review] } }),
  );
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
    r.fulfill({ json: review }),
  );
  await context.route("**/api/lifting-videos/*/media", async (r) =>
    r.fulfill({ contentType: "video/mp4", body: await readFile(fixture) }),
  );
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
  await dialog.getByRole("button", { name: /Snatch.*Review ready/ }).click();
  await expect(
    dialog.getByRole("button", { name: "Form guide", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Body outline", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("The view is limited.", { exact: true }).first(),
  ).toBeVisible();
  await dialog.getByText("Overlay details", { exact: true }).click();
  await expect(dialog.getByText("No reliable subject match.")).toBeVisible();
  review.analysis!.segmentation!.failure = "deadline";
  review.analysis!.segmentation!.frames = [];
  await page.reload();
  await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
  await dialog.getByRole("button", { name: /Snatch.*Review ready/ }).click();
  await dialog.getByText("Overlay details", { exact: true }).click();
  await expect(
    dialog.getByText(/Outline processing did not finish/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Coach cues", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Play video", exact: true }),
  ).toBeVisible();
});
test("segmented replay stays visible during playback, clears on gaps and can be inspected without coaching markers", async ({
  page,
  context,
}) => {
  const review: SavedVideoReview = {
    ...saved("00000000-0000-4000-8000-000000000033"),
    status: "ready",
    stage: "Review ready",
    hasMedia: true,
    analysis: {
      version: 1,
      reviewVersion: 2,
      width: 320,
      height: 480,
      duration: 2,
      frameCount: 120,
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
      segmentation: {
        version: 1,
        model: "sam3.1",
        revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
        sourceSha256: "a".repeat(64),
        status: "partial",
        reason: "Synthetic outlines",
        width: 320,
        height: 480,
        frames: Array.from({ length: 120 }, (_, i) => ({
          t: i / 60,
          objects:
            i >= 48 && i < 72
              ? []
              : [
                  {
                    id: "person-1",
                    kind: "person" as const,
                    polygon: [
                      [0.2, 0.1],
                      [0.8, 0.1],
                      [0.8, 0.8],
                      [0.2, 0.8],
                    ] as [number, number][],
                  },
                ],
        })),
      },
    },
  };
  await context.route("**/api/lifting-videos", (r) =>
    r.fulfill({ json: { videos: [review] } }),
  );
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
    r.fulfill({ json: review }),
  );
  await context.route("**/api/lifting-videos/*/media", async (r) =>
    r.fulfill({ contentType: "video/mp4", body: await readFile(fixture) }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
  await dialog.getByRole("button", { name: /Snatch.*Review ready/ }).click();
  const video = dialog.getByLabel("Saved lifting video"),
    canvas = dialog.getByLabel("Synchronized video overlays");
  await dialog.getByLabel("Playback speed").selectOption("0.25");
  await dialog.getByRole("button", { name: "Play video", exact: true }).click();
  await expect(canvas).toBeVisible();
  await expect(video).toHaveJSProperty("paused", false);
  const first = Number(await canvas.getAttribute("data-frame-time"));
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-frame-time")))
    .toBeGreaterThan(first);
  await expect(canvas).toHaveAttribute("data-layers", "1");
  await dialog
    .getByRole("button", { name: "Body outline", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-layers", "0");
  await dialog
    .getByRole("button", { name: "Body outline", exact: true })
    .click();
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await dialog.getByLabel("Video position").fill("1.001");
  await expect(canvas).toHaveAttribute("data-frame-time", "1.000000");
  await expect(canvas).toHaveAttribute("data-layers", "0");
  await dialog.getByLabel("Video position").fill("0.501");
  await expect(canvas).toHaveAttribute("data-layers", "1");
  await expect(video).toHaveJSProperty("paused", true);
});

function saved(id: string): SavedVideoReview {
  return {
    id,
    lift: "Snatch",
    date: "2026-09-11",
    load: "",
    status: "queued",
    stage: "Waiting to analyse",
    createdAt: "2026-09-11T09:00:00Z",
    error: null,
    feedback: null,
    hasMedia: false,
    analysis: null,
  };
}
test("saved outlines remain usable while feedback recovers automatically", async ({
  page,
  context,
}) => {
  const review: SavedVideoReview = {
    ...saved("00000000-0000-4000-8000-000000000023"),
    hasMedia: true,
    stage: "Finishing Coach’s feedback automatically",
    analysis: {
      version: 1,
      reviewVersion: 2,
      width: 320,
      height: 480,
      duration: 2,
      frameCount: 60,
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
      segmentation: {
        version: 1,
        model: "sam3.1",
        revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
        sourceSha256: "a".repeat(64),
        width: 320,
        height: 480,
        status: "partial",
        reason: "Synthetic outline",
        frames: [
          {
            t: 0,
            objects: [
              {
                id: "person-1",
                kind: "person",
                polygon: [
                  [0.2, 0.2],
                  [0.7, 0.2],
                  [0.7, 0.8],
                ],
              },
            ],
          },
        ],
      },
    },
  };
  await context.route("**/api/lifting-videos", (r) =>
    r.fulfill({ json: { videos: [review] } }),
  );
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
    r.fulfill({ json: review }),
  );
  await context.route("**/api/lifting-videos/*/media", async (r) =>
    r.fulfill({ contentType: "video/mp4", body: await readFile(fixture) }),
  );
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
  await dialog.getByRole("button", { name: /Snatch.*Finishing/ }).click();
  await expect(
    dialog.getByText(
      "Your outlines are ready. Coach is finishing the feedback automatically.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Body outline", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByLabel("Synchronized video overlays"),
  ).toHaveAttribute("data-layers", "1");
  await expect(
    dialog.getByRole("button", { name: "Retry analysis" }),
  ).toHaveCount(0);
  await expect(dialog.getByText("No supported correction markers")).toHaveCount(
    0,
  );
});
test("an older mislabelled review can be updated with fresh identification and no new upload", async ({
  page,
  context,
}) => {
  let review: SavedVideoReview = {
    ...saved("00000000-0000-4000-8000-000000000021"),
    status: "ready",
    stage: "Review ready",
    feedback: "This is a clear snatch attempt.",
  };
  await context.route("**/api/lifting-videos", (r) =>
    r.fulfill({ json: { videos: [review] } }),
  );
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
    r.fulfill({ json: review }),
  );
  let updated = false;
  await context.route("**/api/lifting-videos/*/reanalyse", (r) => {
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    expect(r.request().headers()["x-video-lift"]).toBe("Identify from video");
    expect(r.request().method()).toBe("POST");
    updated = true;
    review = {
      ...review,
      lift: "Identify from video",
      status: "queued",
      stage: "Waiting to reanalyse",
      feedback: null,
    };
    return r.fulfill({ json: review });
  });
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
  await dialog.getByRole("button", { name: /Snatch.*Review ready/ }).click();
  await expect(dialog.getByLabel("Coach video feedback")).not.toBeVisible();
  await dialog
    .getByRole("button", { name: "Update analysis", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Waiting to reanalyse",
  );
  expect(updated).toBe(true);
  await expect(
    dialog.getByRole("heading", { name: "Lifting video", exact: true }),
  ).toBeVisible();
});
test("private video upload processes across navigation and exposes playback, feedback, export and deletion", async ({
  page,
  context,
}, info) => {
  let reviews: SavedVideoReview[] = [];
  let uploads = 0;
  await page.addInitScript(() => {
    const original = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof Blob) {
        void body.arrayBuffer().then(async (bytes) => {
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          (
            window as Window & { videoUploadDigest?: string }
          ).videoUploadDigest = Array.from(new Uint8Array(digest))
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
          original.call(this, body);
        });
        return;
      }
      return original.call(this, body);
    };
  });
  await context.route("**/api/lifting-videos", async (r) => {
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    if (r.request().method() === "POST") {
      uploads++;
      const input = JSON.parse(
        decodeURIComponent(r.request().headers()["x-video-metadata"]),
      );
      expect(input.lift).toBe("Identify from video");
      expect(input.end).toBe(120);
      expect(input.mode).toBe("automatic");
      expect(input.calibration).toBeUndefined();
      // WebKit's inspector omits File-backed request bodies. Independently
      // verify the exact Blob passed to XHR, rather than weakening the check.
      if (r.request().postDataBuffer())
        expect(r.request().postDataBuffer()).toEqual(await readFile(fixture));
      expect(
        await page.evaluate(
          () =>
            (window as Window & { videoUploadDigest?: string })
              .videoUploadDigest,
        ),
      ).toBe(
        createHash("sha256")
          .update(await readFile(fixture))
          .digest("hex"),
      );
      reviews = [saved(input.id)];
      return r.fulfill({ status: 202, json: reviews[0] });
    }
    return r.fulfill({ json: { videos: reviews } });
  });
  await context.route("**/api/lifting-videos/*/media", async (r) => {
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    return r.fulfill({
      contentType: "video/mp4",
      body: await readFile(fixture),
    });
  });
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: reviews[0] });
    expect(r.request().method()).toBe("DELETE");
    reviews = [];
    return r.fulfill({ json: { deleted: true } });
  });
  await page.goto("/#coach");
  await page.getByLabel("Message your coach").fill("Keep my unrelated draft");
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog.getByLabel("Upload lifting video").setInputFiles(fixture);
  await expect(
    dialog.getByText("Video saved.", { exact: false }),
  ).toBeVisible();
  expect(uploads).toBe(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Message your coach")).toHaveValue(
    "Keep my unrelated draft",
  );
  await page.goto("/#food");
  reviews[0] = {
    ...reviews[0],
    status: "ready",
    stage: "Review ready",
    hasMedia: true,
    feedback:
      "**What went well**\nThe synthetic clip contains no lifter.\n\n**Next attempt**\nFilm the whole lifter and bar.",
    analysis: {
      version: 1,
      width: 320,
      height: 480,
      duration: 2,
      frameCount: 60,
      sampleTimes: [0, 1, 2],
      tracking: {
        status: "partial",
        reason: "Tracking stopped when the plate was hidden.",
        points: [
          { t: 0, x: 0.5, y: 0.7, score: 1 },
          { t: 1, x: 0.5, y: 0.4, score: 0.9 },
        ],
        coverage: 0.5,
        horizontalRangeCm: null,
        riseCm: null,
        peakUpwardVelocity: null,
        velocities: [],
      },
    },
  };
  await page.goto("/#coach/lifting/video");
  await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
  await dialog.getByRole("button", { name: /Snatch.*Review ready/ }).click();
  await expect(dialog.getByLabel("Saved lifting video")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await expect(dialog.getByLabel("Coach video feedback")).toContainText(
    "no lifter",
  );
  await dialog.getByText("Optional bar measurements", { exact: true }).click();
  await expect(dialog.getByLabel("Bar measurements")).toContainText(
    "Unavailable",
  );
  await expect(dialog.getByLabel("Review update available")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Update analysis", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Experimental bar trajectory overlay"),
  ).toHaveCount(0);
  await dialog.getByText("Review details & downloads", { exact: true }).click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export analysis" }).click();
  expect((await download).suggestedFilename()).toBe(
    "lift-review-2026-09-11.json",
  );
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  const a11y = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: info.outputPath("saved-video-review.png") });
  let corrections = 0;
  await context.route("**/api/lifting-videos/*/reanalyse", (r) => {
    corrections++;
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    expect(r.request().headers()["x-video-lift"]).toBe("Clean & jerk");
    expect(r.request().method()).toBe("POST");
    expect(r.request().postData()).toBeNull();
    reviews[0] = {
      ...reviews[0],
      lift: "Clean & jerk",
      status: "queued",
      stage: "Waiting to reanalyse",
      feedback: null,
    };
    return r.fulfill({ json: reviews[0] });
  });
  await dialog.getByText("Correct lift & reanalyse", { exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Lift for this review", exact: true })
    .selectOption("Clean & jerk");
  await dialog.getByRole("button", { name: "Reanalyse saved video" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Clean & jerk", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("status").filter({ hasText: "Waiting to reanalyse" }),
  ).toBeVisible();
  expect(corrections).toBe(1);
  expect(uploads).toBe(1);
  await expect(dialog.getByLabel("Coach video feedback")).toHaveCount(0);
  await dialog.getByText("Remove review", { exact: true }).click();
  await dialog.getByRole("button", { name: "Delete video and review" }).click();
  await expect(
    dialog.getByText("No saved video reviews yet.", { exact: false }),
  ).toBeVisible();
});

test("video upload retries preserve the request ID and calibration never guesses real-time timing", async ({
  page,
  context,
}) => {
  let latest = saved("00000000-0000-4000-8000-000000000001");
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
    r.fulfill({ json: latest }),
  );
  const ids: string[] = [];
  let attempts = 0;
  await context.route("**/api/lifting-videos", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { videos: [] } });
    const input = JSON.parse(
      decodeURIComponent(r.request().headers()["x-video-metadata"]),
    );
    latest = saved(input.id);
    ids.push(input.id);
    attempts++;
    expect(input.calibration.realTime).toBe(false);
    expect(input.calibration.diameterCm).toBe(45);
    return attempts === 1
      ? r.fulfill({
          status: 503,
          json: { error: "Synthetic connection problem. Retry." },
        })
      : r.fulfill({ status: 202, json: saved(input.id) });
  });
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog
    .getByText("Add details or trim (optional)", { exact: true })
    .click();
  await dialog.getByLabel("Choose a shorter section").check();
  await dialog.getByLabel("Upload lifting video").setInputFiles(fixture);
  await expect(dialog.getByLabel("End (seconds)")).toHaveValue("2");
  await dialog
    .getByText("Filming tips & optional bar measurements", { exact: true })
    .click();
  await dialog.getByLabel("Add experimental bar tracking").check();
  await dialog.getByRole("button", { name: "Upload & analyse lift" }).click();
  await expect(dialog.getByRole("alert")).toContainText("mark the plate");
  expect(attempts).toBe(0);
  await dialog
    .getByRole("button", { name: "Mark plate on start frame" })
    .click();
  await expect(
    dialog.getByRole("img", { name: "Start frame for marking the plate" }),
  ).toBeVisible();
  await dialog.getByLabel("Actual plate diameter (cm)").fill("45");
  await dialog
    .getByLabel("The camera is fixed and side-on", { exact: false })
    .check();
  await dialog.getByRole("button", { name: "Upload & analyse lift" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Synthetic connection");
  await dialog.getByRole("button", { name: "Upload & analyse lift" }).click();
  await expect(
    dialog.getByText("Video saved.", { exact: false }),
  ).toBeVisible();
  expect(ids[0]).toBe(ids[1]);
});

for (const partial of [false, true])
  test(`guided replay ${partial ? "for a partial clip" : "for an identified lift"} seeks to evidence, highlights visible landmarks and keeps overlays when enlarged`, async ({
    page,
    context,
  }) => {
    const review: SavedVideoReview = {
      ...saved("00000000-0000-4000-8000-000000000010"),
      lift: partial ? "Identify from video" : "Snatch",
      status: "ready",
      stage: "Review ready",
      hasMedia: true,
      feedback: "Synthetic feedback with no real athlete.",
      analysis: {
        version: 1,
        reviewVersion: 2,
        width: 320,
        height: 480,
        duration: 2,
        frameCount: 120,
        sampleTimes: [0, 0.5, 1, 1.5, 1.98],
        segmentation: {
          version: 1,
          model: "sam3.1",
          revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
          sourceSha256: "0".repeat(64),
          status: "partial",
          reason: "Synthetic mask, not model output",
          width: 320,
          height: 480,
          frames: [
            {
              t: 0.5,
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
            { t: 1, objects: [] },
          ],
        },
        ...(partial
          ? {
              identification: {
                version: 1 as const,
                lift: null,
                status: "uncertain" as const,
                reviewScope: "visible_phases" as const,
                reason: "The preceding pull is not visible.",
                phases: [
                  {
                    kind: "front_rack_hold" as const,
                    frame: 1,
                    time: 0,
                    evidence: "The bar starts at the front shoulders.",
                  },
                ],
              },
            }
          : {}),
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
        pose: {
          version: 2,
          status: "partial",
          reason: "Synthetic landmarks",
          frames: Array.from({ length: 30 }, (_, i) => ({
            t: i * 0.05,
            points: [{ id: 13, x: 0.4, y: 0.4 }],
          })),
        },
        coaching: {
          version: 1,
          ...(partial ? { scope: "visible_phases" as const } : {}),
          strength: "Synthetic strength for UI verification.",
          limitation: "Synthetic footage, no actual lifter.",
          moments: [
            {
              id: "moment-1",
              title: "Watch this receiving position",
              observation:
                "This is a synthetic coaching observation for the replay test.",
              cue: "Synthetic cue: focus on the highlighted elbow",
              check: "Compare this moment in your next attempt.",
              region: "elbows",
              evidenceType: "movement",
              evidenceFrames: [2, 3],
              evidenceTimes: [0.5, 1],
              evidenceTime: 0.5,
              start: 0.2,
              end: 1.4,
            },
          ],
        },
      },
    };
    await context.route("**/api/lifting-videos", (r) =>
      r.fulfill({ json: { videos: [review] } }),
    );
    await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
      r.fulfill({ json: review }),
    );
    await context.route("**/api/lifting-videos/*/media", async (r) =>
      r.fulfill({ contentType: "video/mp4", body: await readFile(fixture) }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#coach/lifting/video");
    const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
    await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
    await dialog
      .getByRole("button", {
        name: partial ? /Lifting video.*Review ready/ : /Snatch.*Review ready/,
      })
      .click();
    const video = dialog.getByLabel("Saved lifting video");
    await expect(video).toHaveAttribute("src", /^blob:/);
    await expect(
      dialog.getByRole("heading", { name: "Watch this receiving position" }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Coach video feedback")).not.toBeVisible();
    await dialog.getByRole("button", { name: /Watch this moment/ }).click();
    await expect(video).toHaveJSProperty("paused", false);
    await expect(dialog.locator("video")).toHaveCount(1);
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    await dialog.getByLabel("Video position").fill("0.501");
    await expect(
      dialog.getByLabel("Synchronized video overlays"),
    ).toHaveAttribute("data-frame-time", "0.500000");
    await expect(dialog.getByLabel("Coaching overlay")).toContainText(
      "highlighted elbow",
    );
    await dialog
      .getByRole("button", { name: "Coach cues", exact: true })
      .click();
    await expect(dialog.getByLabel("Coaching overlay")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (partial) {
      let reanalysed = false;
      await context.route("**/api/lifting-videos/*/reanalyse", (r) => {
        expect(r.request().method()).toBe("POST");
        expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
        expect(r.request().headers()["x-video-lift"]).toBe(
          "Identify from video",
        );
        reanalysed = true;
        review.status = "queued";
        review.stage = "Waiting to reanalyse";
        review.feedback = null;
        review.analysis = null;
        return r.fulfill({ json: review });
      });
      await dialog
        .getByRole("button", { name: "Analyse again", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toContainText(
        "Waiting to reanalyse",
      );
      expect(reanalysed).toBe(true);
      await expect(dialog.getByLabel("Guided coaching")).toHaveCount(0);
    }
  });
