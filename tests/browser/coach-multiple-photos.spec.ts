import { test, expect } from "./fixtures";
import sharp from "sharp";

for (const partialFailure of [false, true]) {
  test(`a batch of food photos reaches Coach together${partialFailure ? " after retrying only the failed photo" : ""}`, async ({
    page,
    context,
  }) => {
    const pixels = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#accb91" },
    })
      .jpeg()
      .toBuffer();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    let uploads = 0,
      sends = 0;
    await context.route("**/api/images", (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: { images: [] } });
      uploads++;
      if (!partialFailure) {
        expect(route.request().postDataJSON().purpose).toBe("meal-photo");
        expect(route.request().postDataJSON().autoTag).toBe(false);
      }
      if (partialFailure && uploads === 2)
        return route.fulfill({
          status: 503,
          json: { error: "Temporary upload problem" },
        });
      return route.fulfill({
        json: {
          id: ids[uploads === 1 ? 0 : 1],
          date: "2026-09-20",
          label: "Meal photo",
          createdAt: new Date().toISOString(),
          bytes: pixels.length,
          version: 1,
          category: "food",
          classification: {
            status: "ready",
            confidence: "high",
            source: "automatic",
            tags: ["meal"],
          },
        },
      });
    });
    for (const id of ids)
      await context.route(`**/api/images/${id}`, (route) =>
        route.fulfill({ body: pixels, contentType: "image/jpeg" }),
      );
    await context.route("**/api/agent", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { enabled: true, turns: [] } });
      sends++;
      const body = route.request().postDataJSON();
      expect(body.photoIds).toEqual(ids);
      expect(body.message).toContain("all 2 attached images");
      return route.fulfill({
        json: { reply: "Both source images received.", proposals: [] },
      });
    });
    await page.goto("/#coach");
    const files = ["breakfast.jpg", "lunch.jpg"].map((name) => ({
      name,
      mimeType: "image/jpeg",
      buffer: pixels,
    }));
    if (partialFailure) {
      await page
        .getByRole("button", { name: "Add images", exact: true })
        .click();
      await page
        .getByLabel("Attach image", { exact: true })
        .setInputFiles(files);
    } else {
      await page
        .getByRole("button", { name: "Log something", exact: true })
        .click();
      await page
        .getByLabel("Choose meal photos", { exact: true })
        .setInputFiles(files);
    }
    if (partialFailure) {
      await expect(
        page.getByRole("alert").filter({ hasText: "lunch.jpg" }),
      ).toContainText("still attached");
      await expect(
        page.getByRole("img", { name: "Image ready to send" }),
      ).toHaveCount(1);
      await page
        .getByRole("button", { name: "Add images", exact: true })
        .click();
      await page
        .getByLabel("Attach image", { exact: true })
        .setInputFiles(files[1]);
    }
    await expect(
      page.getByRole("img", { name: "Image ready to send" }),
    ).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeEnabled();
    expect(sends).toBe(0);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByText("Both source images received.", { exact: true }),
    ).toBeVisible();
    expect(sends).toBe(1);
    expect(uploads).toBe(partialFailure ? 3 : 2);
  });
}

test("too many selected photos are rejected before uploading instead of silently dropping files", async ({
  page,
  context,
}) => {
  let uploads = 0;
  await context.route("**/api/images", (route) => {
    uploads++;
    return route.fulfill({ status: 500 });
  });
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Add images", exact: true }).click();
  await page.getByLabel("Attach image", { exact: true }).setInputFiles(
    Array.from({ length: 5 }, (_, i) => ({
      name: `${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from("not processed"),
    })),
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("alert").filter({ hasText: "Nothing from this selection" }),
  ).toBeVisible();
  expect(uploads).toBe(0);
});
