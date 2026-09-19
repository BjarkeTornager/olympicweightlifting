import { expect, type Locator } from "@playwright/test";

export async function expectOverlayFrame(canvas: Locator, seconds: number) {
  await expect(canvas).toBeVisible();
  // Firefox reports the requested millisecond within a paused frame, while
  // Chromium/WebKit report its presentation timestamp. Both must remain in
  // the same source frame; the replay stress test also checks decoded pixels.
  await expect
    .poll(async () => {
      const value = await canvas.getAttribute("data-frame-time");
      return value ? Math.abs(Number(value) - seconds) : Infinity;
    })
    .toBeLessThan(0.002);
}
