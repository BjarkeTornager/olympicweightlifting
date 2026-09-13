import { test, expect, browserUser } from "./fixtures";
import type { SavedVideoReview } from "../../lib/video/types";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

const fixture = path.resolve("tests/fixtures/lifting-motion.mp4");
const now = Date.now();
const at = (offset: number) => new Date(now + offset * 1000).toISOString();
function queued(): SavedVideoReview {
  return {
    id: "00000000-0000-4000-8000-000000000051",
    lift: "Clean & jerk",
    date: "2026-09-13",
    load: "",
    status: "queued",
    stage: "Waiting to analyse",
    createdAt: at(-60),
    error: null,
    analysis: null,
    feedback: null,
    hasMedia: false,
    progress: { queuedAt: at(-60), updatedAt: at(-60), phase: "queued" },
  };
}

test("upload reports measured bytes and waits for server acknowledgement before allowing background processing", async ({
  page,
  context,
}, info) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posted = false;
  await page.addInitScript(() => {
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof Blob)
        (window as Window & { uploadForTest?: XMLHttpRequest }).uploadForTest =
          this;
      return send.call(this, body);
    };
  });
  await context.route("**/api/lifting-videos", async (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { videos: [] } });
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    posted = true;
    const metadata = JSON.parse(
      decodeURIComponent(r.request().headers()["x-video-metadata"]),
    );
    await held;
    return r.fulfill({ status: 202, json: { ...queued(), id: metadata.id } });
  });
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
    r.fulfill({ json: queued() }),
  );
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog.getByLabel("Upload lifting video").setInputFiles(fixture);
  const card = dialog.getByLabel("Video upload progress");
  await expect(card).toBeVisible();
  await expect.poll(() => posted).toBe(true);
  await page.evaluate(() => {
    const progress = document.querySelector<HTMLProgressElement>(
      'progress[aria-label="Video bytes uploaded"]',
    )!;
    (
      window as Window & { uploadForTest?: XMLHttpRequest }
    ).uploadForTest!.upload.dispatchEvent(
      new ProgressEvent("progress", {
        loaded: progress.max / 2,
        total: progress.max,
        lengthComputable: true,
      }),
    );
  });
  await expect(card.getByText("50%", { exact: true })).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveJSProperty("position", 0.5);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Your upload is still in progress.", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as Window & { uploadForTest?: XMLHttpRequest }
    ).uploadForTest!.upload.dispatchEvent(new ProgressEvent("load")),
  );
  await expect(card.getByRole("status")).toHaveText("Saving your video…");
  await expect(dialog.getByLabel("Video processing progress")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await card.screenshot({ path: info.outputPath("upload-saving.png") });
  release();
  await expect(dialog.getByLabel("Video processing progress")).toBeVisible();
  await expect(card).toHaveCount(0);
  await dialog.getByRole("button", { name: "Continue using the app" }).click();
  await expect(dialog).toHaveCount(0);
});

test("processing survives navigation, keeps GPU work out of the initial queue, and honestly handles timing and connectivity", async ({
  page,
  context,
}, info) => {
  let current = queued(),
    disconnected = false;
  let readyReads = 0;
  await page.clock.setFixedTime(now);
  await context.route("**/api/lifting-videos", (r) =>
    disconnected
      ? r.fulfill({ status: 503, json: { error: "Synthetic reconnect" } })
      : r.fulfill({ json: { videos: [current], bodyOverlayEnabled: true } }),
  );
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) => {
    if (current.status === "ready" && ++readyReads === 1)
      return r.fulfill({
        status: 503,
        json: { error: "Synthetic detail interruption" },
      });
    return r.fulfill({ json: current });
  });
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog
    .getByRole("button", { name: "View analysis in progress" })
    .click();
  const card = dialog.getByLabel("Video processing progress");
  await expect(
    card.getByRole("heading", { name: "Waiting to start" }),
  ).toBeVisible();
  await expect(card.getByText("1:00 since saved")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  current = {
    ...current,
    status: "queued",
    stage: "Preparing your 3D body overlay · continuing automatically",
    progress: {
      ...current.progress!,
      startedAt: at(-50),
      updatedAt: at(1),
      phase: "body",
      bodyRequested: true,
    },
  };
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    card.getByRole("heading", { name: "Build form guide" }),
  ).toBeVisible();
  await expect(card.locator('[aria-current="step"]')).toHaveText(
    "4Build form guide",
  );
  await expect(
    card.getByText("Timing estimate not available yet"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Continue using the app" }).click();
  await page.goto("/#food");
  await page.goto("/#coach/lifting/video");
  await dialog
    .getByRole("button", { name: "View analysis in progress" })
    .click();
  await expect(
    card.getByRole("heading", { name: "Build form guide" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const a11y = await new AxeBuilder({ page })
    .include('[aria-label="Video processing progress"]')
    .analyze();
  expect(a11y.violations).toEqual([]);
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await card.screenshot({ path: info.outputPath("analysis-progress.png") });
  disconnected = true;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(card.getByText("Reconnecting to progress…")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Retry analysis", exact: true }),
  ).toHaveCount(0);
  disconnected = false;
  current = {
    ...current,
    status: "ready",
    stage: "Review ready",
    progress: { ...current.progress!, phase: "ready", completedAt: at(20) },
  };
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    dialog.getByText("Your review is ready. Watch your lift below."),
  ).toBeVisible({ timeout: 12000 });
  expect(readyReads).toBeGreaterThanOrEqual(2);
  await expect(card).toHaveCount(0);
});

test("measured estimates stop promising a deadline when a run exceeds past timings", async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(now);
  const active = {
    ...queued(),
    status: "processing" as const,
    stage: "Coach is reviewing the tracked movement",
    analysis: { duration: 15 } as SavedVideoReview["analysis"],
    progress: {
      queuedAt: at(-60),
      startedAt: at(-50),
      updatedAt: at(0),
      phase: "coaching" as const,
      bodyRequested: true,
    },
  };
  const history = [180, 200, 220].map((seconds, i) => ({
    ...active,
    id: `history-${i}`,
    status: "ready" as const,
    stage: "Review ready",
    progress: {
      ...active.progress,
      startedAt: at(-1000),
      completedAt: at(-1000 + seconds),
    },
  }));
  await context.route("**/api/lifting-videos", (r) =>
    r.fulfill({ json: { videos: [active, ...history] } }),
  );
  await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
    r.fulfill({ json: active }),
  );
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog
    .getByRole("button", { name: "View analysis in progress" })
    .click();
  await expect(dialog.getByText("About 2–4 min remaining")).toBeVisible();
  // Move wall time without generating hundreds of requests; refresh once.
  await page.clock.setFixedTime(now + 500_000);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    dialog.getByText("Taking longer than recent reviews"),
  ).toBeVisible();
  await expect(dialog.getByText(/min remaining/)).toHaveCount(0);
  await expect(dialog.getByLabel("Video processing progress")).toBeVisible();
});
