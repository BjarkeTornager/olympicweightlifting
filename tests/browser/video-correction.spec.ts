import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import { correctionReview } from "../fixtures/correction";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`posture correction is anchored to its evidence frame and switches back to the original at ${viewport.width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport);
    const review = correctionReview();
    expect(
      review.analysis!.coaching!.moments[0].correctionPreview!.status,
    ).toBe("available");
    await context.route("**/api/lifting-videos", (r) =>
      r.fulfill({ json: { videos: [review] } }),
    );
    await context.route(/\/api\/lifting-videos\/[^/]+$/, (r) =>
      r.fulfill({ json: review }),
    );
    await context.route("**/api/lifting-videos/*/media", async (r) =>
      r.fulfill({
        contentType: "video/mp4",
        body: await readFile("tests/fixtures/lifting-motion.mp4"),
      }),
    );
    await page.goto("/#coach/lifting/video");
    const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
    await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
    await dialog.getByRole("button", { name: /Jerk.*Review ready/ }).click();
    await expect(
      dialog.getByRole("heading", { name: "Keep your dip upright" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Why it matters", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: /Watch: Controlled jerk dip/ }),
    ).toHaveAttribute("href", "https://www.youtube.com/watch?v=NYIgTh-XyYQ");
    await dialog
      .getByRole("button", { name: "Show suggested correction", exact: true })
      .click();
    const guide = dialog.getByRole("img", {
      name: "Suggested posture correction",
    });
    await expect(guide).toBeVisible();
    const video = dialog.getByLabel("Saved lifting video");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(1, 2);
    await expect(
      dialog.getByText("Suggested posture · 2D guide", { exact: true }),
    ).toBeVisible();
    if (viewport.width === 390)
      await page.screenshot({
        path: `/private/tmp/lift-ghost-${test.info().project.name}.png`,
      });
    await dialog
      .getByRole("button", { name: "Original position", exact: true })
      .click();
    await expect(guide).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Suggested correction", exact: true })
      .click();
    await expect(guide).toBeVisible();
    await dialog
      .getByRole("button", { name: "Earlier reference", exact: true })
      .click();
    await expect(guide).toHaveCount(0);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(0.5, 2);
    await dialog
      .getByRole("button", { name: "Suggested correction", exact: true })
      .click();
    await expect(guide).toBeVisible();
    await dialog
      .getByRole("button", { name: "Play video", exact: true })
      .click();
    await expect(guide).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Watch this moment", exact: true })
      .click();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused), {
        timeout: 8000,
      })
      .toBe(true);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(1, 2);
    await expect(guide).toHaveCount(0);
    await dialog.getByText("What Coach reviewed", { exact: true }).click();
    await expect(
      dialog.getByText("Both the hold and dip are visible."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
