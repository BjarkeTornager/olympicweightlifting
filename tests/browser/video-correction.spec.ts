import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import { formGuideReview } from "../fixtures/form-guide";

test("coaching uses the same player and keeps practice details collapsed", async ({
  page,
  context,
}) => {
  const review = formGuideReview();
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
  await expect(
    d.getByRole("heading", { name: "Keep your dip upright" }),
  ).toBeVisible();
  await expect(
    d.getByRole("link", { name: /Watch: Controlled jerk dip/ }),
  ).not.toBeVisible();
  await d.getByText("Why & how to practise", { exact: true }).click();
  await expect(
    d.getByRole("link", { name: /Watch: Controlled jerk dip/ }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=NYIgTh-XyYQ");
  await d.getByRole("button", { name: /Watch this moment/ }).click();
  await expect(d.getByLabel("Saved lifting video")).toHaveJSProperty(
    "paused",
    false,
  );
  await expect(d.locator("video")).toHaveCount(1);
  await d.getByText("Overlay details", { exact: true }).click();
  await expect(d.getByText("Both the hold and dip are visible.")).toBeVisible();
  await expect(d.getByText(/not a verified perfect lift/)).toBeVisible();
});
