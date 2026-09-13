import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import { correctionReview } from "../fixtures/correction";

test("upgrading an existing review to 3D keeps the selected lift", async ({
  page,
  context,
}) => {
  const review = correctionReview();
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
  await context.route("**/api/lifting-videos/*/reanalyse", (r) => {
    expect(r.request().method()).toBe("POST");
    expect(r.request().headers()["x-video-lift"]).toBe("Jerk");
    review.status = "queued";
    review.stage = "Waiting to reanalyse";
    return r.fulfill({ json: review });
  });
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog.getByRole("button", { name: "Your reviews (1)" }).click();
  await dialog.getByRole("button", { name: /Jerk.*Review ready/ }).click();
  await dialog.getByText("Review details & downloads", { exact: true }).click();
  await expect(dialog.getByText("3D body review is available")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Update analysis", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Waiting to reanalyse",
  );
});
