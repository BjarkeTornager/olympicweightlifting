import { test, expect, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { emptyJournal } from "../../lib/domain";
import { unclassifiedImage, type UserImage } from "../../lib/images";

async function imageAccount(
  context: BrowserContext,
  category: UserImage["category"],
) {
  const user = {
    id: "image-ui-account",
    name: "Synthetic account",
    email: "images@example.test",
  };
  const state = emptyJournal();
  const images: UserImage[] = [];
  const pixels = await sharp({
    create: { width: 180, height: 260, channels: 3, background: "#b6a3d8" },
  })
    .jpeg()
    .toBuffer();
  let writes = 0;
  const questions: string[] = [];
  const autoTags: boolean[] = [];
  await context.route("**/api/session", (r) =>
    r.fulfill({
      json: { user, configured: true, google: true, localPassword: false },
    }),
  );
  await context.route("**/api/journal", (r) => {
    if (r.request().method() !== "GET") writes++;
    return r.fulfill({ json: { accountId: user.id, state, revision: 0 } });
  });
  await context.route("**/api/images**", (r) => {
    expect(r.request().headers()["x-journal-account"]).toBe(user.id);
    const url = new URL(r.request().url()),
      method = r.request().method();
    if (url.pathname === "/api/images") {
      if (method === "POST") {
        const body = r.request().postDataJSON();
        autoTags.push(body.autoTag);
        const photo: UserImage = {
          id: body.id,
          label: body.label,
          date: body.date,
          bytes: pixels.length,
          createdAt: new Date().toISOString(),
          version: 1,
          category: body.autoTag ? category : "unclassified",
          classification: body.autoTag
            ? {
                source: "automatic",
                status: category === "unclassified" ? "review" : "ready",
                confidence: category === "unclassified" ? "low" : "high",
                tags: ["screenshot", "apple health"],
              }
            : unclassifiedImage,
        };
        images.push(photo);
        return r.fulfill({ json: photo });
      }
      const filter = url.searchParams.get("category");
      return r.fulfill({
        json: {
          images: images.filter((i) => !filter || i.category === filter),
        },
      });
    }
    const photo = images.find((i) => i.id === url.pathname.split("/")[3]);
    if (!photo)
      return r.fulfill({ status: 404, json: { error: "Image not found" } });
    if (url.pathname.endsWith("/classify")) {
      photo.version++;
      photo.classification.status = "failed";
      return r.fulfill({ json: photo });
    }
    if (method === "PATCH") {
      const body = r.request().postDataJSON();
      expect(body.version).toBe(photo.version);
      photo.version++;
      photo.category = body.category;
      photo.classification = {
        tags: body.tags,
        source: "manual",
        status: "ready",
        confidence: "high",
      };
      return r.fulfill({ json: photo });
    }
    if (url.searchParams.get("metadata") === "1")
      return r.fulfill({ json: photo });
    return r.fulfill({ body: pixels, contentType: "image/jpeg" });
  });
  await context.route("**/api/agent", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({
        json: { enabled: true, provider: "Test provider", turns: [] },
      });
    const input = r.request().postDataJSON();
    questions.push(input.message);
    expect(input.photoIds).toEqual([images[0].id]);
    return r.fulfill({
      json: {
        reply:
          "This is a sleep screenshot. Tell me which date to use if you want to log it.",
        proposals: [],
      },
    });
  });
  return { images, questions, autoTags, pixels, writes: () => writes };
}
test.describe("private image collections", () => {
  test.use({ serviceWorkers: "block" });
  test("a sleep screenshot uploaded from Food goes to Health and opens a sleep conversation", async ({
    page,
    context,
  }) => {
    const account = await imageAccount(context, "sleep");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#food");
    await page
      .getByLabel("Photo label", { exact: true })
      .fill("Last night sleep");
    await page.getByLabel("Upload image", { exact: true }).setInputFiles({
      name: "sleep.jpg",
      mimeType: "image/jpeg",
      buffer: account.pixels,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "under Sleep" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Last night sleep" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Estimate meal", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open image library", exact: true })
      .click();
    await expect(
      page.getByRole("img", { name: "Last night sleep" }),
    ).toBeVisible();
    await expect(page.locator(".image-category-sleep")).toContainText(
      "Auto tagged",
    );
    await page.goto("/#health");
    await expect(
      page.getByRole("heading", { name: "Health images & screenshots" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Last night sleep" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Read sleep image", exact: true })
      .click();
    await expect(page.getByLabel("Message your coach")).toHaveValue(
      /sleep screenshot/,
    );
    await expect(page.getByLabel("Message your coach")).not.toHaveValue(
      /prepare a food entry/,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByText("This is a sleep screenshot.", { exact: false }),
    ).toBeVisible();
    expect(account.questions).toHaveLength(1);
    expect(account.writes()).toBe(0);
  });
  test("uncertain images stay in review, categories are correctable, failed retagging keeps the image", async ({
    page,
    context,
  }, testInfo) => {
    const account = await imageAccount(context, "unclassified");
    await page.goto("/#images");
    await page.getByLabel("Photo label", { exact: true }).fill("Sleep report");
    await page.getByLabel("Upload image", { exact: true }).setInputFiles({
      name: "unclear.jpg",
      mimeType: "image/jpeg",
      buffer: account.pixels,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Needs review" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Food 0", exact: true }).click();
    await expect(page.getByRole("img", { name: "Sleep report" })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Needs review 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit category & tags", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Category", { exact: true }).selectOption("sleep");
    await dialog
      .getByLabel("Tags", { exact: true })
      .fill("sleep report, apple health, screenshot");
    await dialog
      .getByRole("button", { name: "Save category", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Sleep report" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Sleep 1", exact: true }).click();
    await expect(page.locator(".image-category-sleep")).toContainText(
      "Tagged by you",
    );
    await page
      .getByRole("button", { name: "Retag automatically", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Image kept" }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "Sleep report" })).toBeVisible();
    await page.getByLabel("Tag automatically", { exact: true }).uncheck();
    await page.getByLabel("Upload image", { exact: true }).setInputFiles({
      name: "private.jpg",
      mimeType: "image/jpeg",
      buffer: account.pixels,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Needs review" }),
    ).toBeVisible();
    expect(account.autoTags).toEqual([true, false]);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      report.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("image-library-mobile.png"),
      fullPage: true,
    });
    await page.reload();
    await expect(page.locator(".image-category-sleep")).toBeVisible();
    const exported = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export image catalog", exact: true })
      .click();
    expect((await exported).suggestedFilename()).toMatch(
      /^image-catalog-.*\.json$/,
    );
    expect(account.writes()).toBe(0);
  });
});
