import { test, expect } from "./fixtures";
import { formGuideReview } from "../fixtures/form-guide";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";

for (const width of [390, 1280]) {
  test(`one player keeps overlays continuous on every decoded frame, replay and seek at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const review = formGuideReview();
    if (width === 1280) {
      const png = await sharp(
        Buffer.from(
          '<svg width="320" height="480"><path d="M160 160L180 310L160 420" stroke="#50e6c3" stroke-width="22" fill="none"/></svg>',
        ),
      )
        .png()
        .toBuffer();
      const image = `data:image/png;base64,${png.toString("base64")}`;
      const frames = review
        .analysis!.pose!.frames.filter((_, i) => i % 2 === 0)
        .map((f) => ({ t: f.t, image }));
      review.analysis!.body = {
        version: 1,
        model: "sam-3d-body",
        revision: "11aaa346c7204874a1cbafe3d39a979080b2c55a",
        sourceSha256: "a".repeat(64),
        width: 320,
        height: 480,
        status: "tracked",
        reason: "Synthetic mesh texture",
        frames,
        motion: {
          version: 1,
          status: "available",
          reason: "Synthetic reposed texture",
          clips: [
            {
              id: "priority-1",
              start: 0.6,
              end: 1.2,
              frames: frames.filter((f) => f.t >= 0.6 && f.t <= 1.2),
            },
          ],
        },
      };
    }
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
    const d = page.getByRole("dialog", { name: "Review a lifting video" });
    await d.getByRole("button", { name: "Your reviews (1)" }).click();
    await d.getByRole("button", { name: /Jerk.*Review ready/ }).click();
    await expect(d.locator("video")).toHaveCount(1);
    await expect(
      d.getByRole("button", { name: "Form guide", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const canvas = d.getByLabel("Synchronized video overlays"),
      video = d.getByLabel("Saved lifting video");
    await video.scrollIntoViewIfNeeded();
    for (let pass = 0; pass < 3; pass++) {
      await d
        .getByLabel("Playback speed")
        .selectOption(pass === 1 ? "0.5" : "1");
      await d.getByLabel("Video position").fill("0.101");
      await expect(canvas).toHaveAttribute("data-frame-time", "0.100000");
      // Sample AFTER the application's decoder callback. No timers tied to
      // React rerenders; every decoded frame must have a matching overlay.
      const collection = video.evaluate(async (v: HTMLVideoElement) => {
        const c = v.parentElement!.querySelector("canvas")!;
        const records: {
          t: number;
          rendered: number;
          layers: number;
          hidden: boolean;
          alpha: number;
        }[] = [];
        await new Promise<void>((resolve) => {
          const next = (_n: number, m: VideoFrameCallbackMetadata) => {
            if (m.mediaTime > 0.15 && m.mediaTime < 1.8) {
              const bytes = c
                .getContext("2d")!
                .getImageData(0, 0, c.width, c.height).data;
              let alpha = 0;
              for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) alpha++;
              records.push({
                t: m.mediaTime,
                rendered: Number(c.dataset.frameTime),
                layers: Number(c.dataset.layers),
                hidden: Boolean(c.hidden),
                alpha,
              });
            }
            if (v.ended || m.mediaTime >= 1.8) resolve();
            else v.requestVideoFrameCallback(next);
          };
          v.requestVideoFrameCallback(next);
        });
        return records;
      });
      await d.getByRole("button", { name: "Play video", exact: true }).click();
      const records = await collection;
      expect(records.length).toBeGreaterThan(15);
      for (const r of records) {
        expect(r.hidden, JSON.stringify(r)).toBe(false);
        expect(Math.abs(r.t - r.rendered), JSON.stringify(r)).toBeLessThan(
          0.00001,
        );
        expect(r.layers, JSON.stringify(r)).toBeGreaterThan(0);
        expect(r.alpha).toBeGreaterThan(100);
      }
      await video.evaluate((v: HTMLVideoElement) => v.pause());
    }
    // Toggle without changing the playback position, then seek backwards.
    await d.getByLabel("Video position").fill("0.734");
    await expect(canvas).toHaveAttribute("data-frame-time", "0.733333");
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    for (const name of ["Body outline", "Bar path", "Coach cues"])
      await d.getByRole("button", { name, exact: true }).click();
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(
      before,
    );
    await d.getByRole("button", { name: "Form guide", exact: true }).click();
    await d.getByRole("button", { name: "Body outline", exact: true }).click();
    await d.getByRole("button", { name: "Bar path", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-layers", "0");
    await d.getByRole("button", { name: "Form guide", exact: true }).click();
    await d.getByLabel("Video position").fill("0.501");
    await expect(canvas).toHaveAttribute("data-frame-time", "0.500000");
    // White synthetic bar moves five pixels/frame. Verify the underlying frame
    // is not a stale captured still hidden beneath a correct timestamp.
    const top = await video.evaluate((v: HTMLVideoElement) => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(v, 0, 0);
      const p = ctx.getImageData(160, 0, 1, c.height).data;
      for (let y = 0; y < c.height; y++)
        if ((p[y * 4] + p[y * 4 + 1] + p[y * 4 + 2]) / 3 > 225) return y;
      return -1;
    });
    expect(top).toBeGreaterThanOrEqual(344);
    expect(top).toBeLessThanOrEqual(346);
    await d.getByRole("button", { name: "Enlarge video" }).click();
    await expect(d.getByRole("button", { name: "Reduce video" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(d).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/private/tmp/lift-form-${width}-${test.info().project.name}.png`,
    });
    const a11y = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(a11y.violations).toEqual([]);
  });
}
