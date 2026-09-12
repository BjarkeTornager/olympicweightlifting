import { test, expect } from "./fixtures";
import { correctionReview } from "../fixtures/correction";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

test("a rounded comparison endpoint shows the correct decoded pixels before its shadow", async ({
  page,
  context,
}) => {
  const review = correctionReview();
  const image = `data:image/png;base64,${(
    await sharp({
      create: {
        width: 320,
        height: 480,
        channels: 4,
        background: { r: 0, g: 180, b: 150, alpha: 0.3 },
      },
    })
      .png()
      .toBuffer()
  ).toString("base64")}`;
  const frames = [
    { t: 0.5, image },
    { t: 0.733333, image },
  ];
  review.analysis!.body = {
    version: 1,
    model: "sam-3d-body",
    revision: "11aaa346c7204874a1cbafe3d39a979080b2c55a",
    sourceSha256: "a".repeat(64),
    width: 320,
    height: 480,
    status: "tracked",
    reason: "Synthetic",
    frames,
    motion: {
      version: 1,
      status: "available",
      reason: "Synthetic",
      clips: [{ id: "priority-1", start: 0.5, end: 0.733333, frames }],
    },
  };
  await page.setViewportSize({ width: 390, height: 844 });
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
    .getByRole("button", { name: "Play comparison", exact: true })
    .click();
  await expect(
    dialog.getByRole("img", { name: "Suggested movement silhouette" }),
  ).toHaveAttribute("data-frame-time", "0.733333");
  // This synthetic 30 FPS clip moves its white bar by five pixels per frame.
  // Frame 22 starts at y=310; frame 21 starts at y=315. Checking the original
  // video's pixels catches seeked/currentTime racing ahead of presentation.
  const barTop = await dialog
    .locator("video")
    .evaluate((v: HTMLVideoElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(v, 0, 0);
      const pixels = ctx.getImageData(160, 0, 1, v.videoHeight).data;
      for (let y = 0; y < v.videoHeight; y++) {
        if ((pixels[y * 4] + pixels[y * 4 + 1] + pixels[y * 4 + 2]) / 3 > 225)
          return y;
      }
      return -1;
    });
  expect(barTop).toBeGreaterThanOrEqual(309);
  expect(barTop).toBeLessThanOrEqual(311);
});

for (const width of [390, 1280]) {
  test(`suggested movement compares corrected frames with the original at ${width}px`, async ({
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
        background: { r: 30, g: 180, b: 150, alpha: 0.45 },
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
      status: "tracked",
      reason: "Synthetic",
      frames: [{ t: 0.5, image }],
      motion: {
        version: 1,
        status: "partial",
        reason: "Synthetic movement",
        clips: [
          {
            id: "priority-1",
            start: 0.5,
            end: 1,
            frames: [
              { t: 0.5, image },
              { t: 0.533333, image },
              { t: 0.75 },
              { t: 1, image },
            ],
          },
        ],
      },
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
    const compare = dialog.getByRole("region", {
      name: "Compare your movement",
    });
    await expect(compare).toBeVisible();
    await compare
      .getByRole("button", { name: "Suggested movement", exact: true })
      .click();
    const target = dialog.getByRole("img", {
      name: "Suggested movement silhouette",
      exact: true,
    });
    await expect(target).toBeVisible();
    await expect(target).toHaveAttribute("data-frame-time", "0.5");
    await expect(
      dialog.getByRole("img", { name: "Observed 3D body reconstruction" }),
    ).toHaveCount(0);
    await compare.getByText("Comparison options", { exact: true }).click();
    await compare.getByLabel("Shadow visibility").fill("0.4");
    await expect(target).toHaveCSS("opacity", "0.4");
    await compare
      .getByRole("button", { name: "Original video", exact: true })
      .click();
    await expect(target).toHaveCount(0);
    await compare
      .getByRole("button", { name: "Suggested movement", exact: true })
      .click();
    await dialog.getByLabel("Video position").fill("0.75");
    await expect(target).toHaveCount(0);
    await dialog.getByLabel("Video position").fill("1");
    // WebKit does not present offscreen video. Inspect the visible pixels;
    // the shadow correctly stays hidden until that frame is presented.
    await dialog.locator("video").scrollIntoViewIfNeeded();
    await expect(target).toHaveAttribute("data-frame-time", "1");
    await compare
      .getByRole("button", { name: "Play comparison", exact: true })
      .click();
    await expect(dialog.getByLabel("Playback speed")).toHaveValue("0.5");
    await expect(
      dialog.getByRole("button", { name: "Pause video", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        dialog.locator("video").evaluate((v) => (v as HTMLVideoElement).paused),
      )
      .toBe(true);
    await expect(target).toHaveAttribute("data-frame-time", "1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/private/tmp/lift-corrected-shadow/phone-${width}-${test.info().project.name}.png`,
    });
  });
}
