import { test, expect, browserUser } from "./fixtures";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { SavedVideoReview } from "../../lib/video/types";
const fixture = path.resolve("tests/fixtures/lifting-motion.mp4");
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
test("private video upload processes across navigation and exposes playback, feedback, export and deletion", async ({
  page,
  context,
}, info) => {
  let reviews: SavedVideoReview[] = [];
  let uploads = 0;
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (
        String(input) === "/api/lifting-videos" &&
        init?.body instanceof Blob
      ) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await init.body.arrayBuffer(),
        );
        (window as Window & { videoUploadDigest?: string }).videoUploadDigest =
          Array.from(new Uint8Array(digest))
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
      }
      return original(input, init);
    };
  });
  await context.route("**/api/lifting-videos", async (r) => {
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    if (r.request().method() === "POST") {
      uploads++;
      const input = JSON.parse(
        decodeURIComponent(r.request().headers()["x-video-metadata"]),
      );
      expect(input.end).toBeCloseTo(2, 1);
      expect(input.calibration).toBeUndefined();
      // WebKit's inspector omits File-backed request bodies. Independently
      // verify the exact Blob passed to fetch, rather than weakening the check.
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
  await expect(dialog.getByLabel("End (seconds)")).toHaveValue("2");
  expect(uploads).toBe(0);
  await dialog.getByRole("button", { name: "Upload & analyse lift" }).click();
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
  await expect(dialog.getByLabel("Bar measurements")).toContainText(
    "Unavailable",
  );
  await expect(
    dialog.getByLabel("Experimental bar trajectory overlay"),
  ).toBeVisible();
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
