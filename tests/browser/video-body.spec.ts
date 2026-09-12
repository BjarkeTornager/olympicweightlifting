import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { correctionReview } from "../fixtures/correction";
for (const width of [390, 1280]) {
  test(`3D body shadows match the inspected frame and clear on seek at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const review = correctionReview();
    const png = await sharp({
      create: {
        width: 320,
        height: 480,
        channels: 4,
        background: { r: 30, g: 180, b: 160, alpha: 0.45 },
      },
    })
      .png()
      .toBuffer();
    const image = `data:image/png;base64,${png.toString("base64")}`;
    review.analysis!.body = {
      version: 1,
      model: "sam-3d-body",
      revision: "11aaa346c7204874a1cbafe3d39a979080b2c55a",
      sourceSha256: "a".repeat(64),
      width: 320,
      height: 480,
      status: "partial",
      reason: "Synthetic",
      frames: [{ t: 0.5, image }, { t: 0.75 }, { t: 1, image }],
    };
    await context.route("**/api/lifting-videos", (r) =>
      r.fulfill({ json: { videos: [review], bodyOverlayEnabled: true } }),
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
    await dialog
      .getByRole("button", { name: "Inspect 3D body", exact: true })
      .click();
    const body = dialog.getByRole("img", {
      name: "Observed 3D body reconstruction",
    });
    await expect(body).toBeVisible();
    await expect(body).toHaveAttribute("data-frame-time", "0.5");
    await dialog
      .getByRole("button", { name: "Next body frame", exact: true })
      .click();
    await expect(body).toHaveAttribute("data-frame-time", "1");
    await dialog
      .getByRole("button", { name: "Show suggested correction", exact: true })
      .click();
    await expect(body).toBeVisible();
    await expect(
      dialog.getByRole("img", { name: "Suggested posture correction" }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Original position", exact: true })
      .click();
    await expect(body).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Inspect 3D body", exact: true })
      .click();
    await dialog.getByLabel("Video position").fill("0.75");
    await expect(body).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Inspect 3D body", exact: true })
      .click();
    await expect(body).toBeVisible();
    if (width === 390)
      await page.screenshot({
        path: `/private/tmp/lift-body-${test.info().project.name}.png`,
      });
    await dialog
      .getByRole("button", { name: "Play video", exact: true })
      .click();
    await expect(body).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Pause video", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
