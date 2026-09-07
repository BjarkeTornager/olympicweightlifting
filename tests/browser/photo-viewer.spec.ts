import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { emptyJournal, today } from "../../lib/domain";
import { mealSchema } from "../../lib/nutrition";
import type { UserImage } from "../../lib/images";

test("food, library and chat photos open the same private, uncropped viewer without sending or losing drafts", async ({
  page,
  context,
}, testInfo) => {
  const images: UserImage[] = ["food", "sleep"].map((category, i) => ({
    id: crypto.randomUUID(),
    label: i === 0 ? "Lunch plate" : "Sleep screenshot",
    date: today(),
    category: category as UserImage["category"],
    classification: {
      source: "manual",
      status: "ready",
      confidence: "high",
      tags: [category],
    },
    version: 1,
    bytes: 1000,
    createdAt: new Date().toISOString(),
  }));
  const pixels = await Promise.all([
    sharp({
      create: { width: 1600, height: 900, channels: 3, background: "#c9b899" },
    })
      .jpeg()
      .toBuffer(),
    sharp({
      create: { width: 900, height: 1900, channels: 3, background: "#b8bdd3" },
    })
      .jpeg()
      .toBuffer(),
  ]);
  const state = emptyJournal();
  state.nutrition.meals.push(
    mealSchema.parse({
      id: crypto.randomUUID(),
      date: today(),
      name: "Photo lunch",
      type: "lunch",
      source: "photo",
      estimated: true,
      createdAt: new Date().toISOString(),
      items: [
        {
          name: "Rice bowl",
          portion: "One bowl",
          calories: 400,
          protein: 20,
          carbs: 50,
          fat: 12,
        },
      ],
      photoIds: [images[0].id],
    }),
  );
  const reads: string[] = [];
  let unavailable = false;
  await context.route("**/api/journal", (r) => {
    expect(r.request().method()).toBe("GET");
    return r.fulfill({
      json: { accountId: browserUser.id, state, revision: 1 },
    });
  });
  await context.route("**/api/agent", (r) => {
    expect(r.request().method(), "Opening a photo must never submit chat").toBe(
      "GET",
    );
    return r.fulfill({
      json: {
        enabled: true,
        provider: "Test provider",
        turns: [
          {
            id: "photo-turn",
            question: "My lunch photo",
            photoIds: [images[0].id],
            reply: "Your photo is saved.",
            status: "done",
          },
        ],
      },
    });
  });
  await context.route("**/api/images**", (r) => {
    expect(r.request().method()).toBe("GET");
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    const url = new URL(r.request().url());
    if (url.pathname === "/api/images") {
      const category = url.searchParams.get("category");
      return r.fulfill({
        json: {
          images: images.filter(
            (photo) => !category || photo.category === category,
          ),
        },
      });
    }
    const index = images.findIndex((photo) => url.pathname.endsWith(photo.id));
    expect(index).toBeGreaterThanOrEqual(0);
    if (url.searchParams.get("metadata") === "1")
      return r.fulfill({ json: images[index] });
    reads.push(images[index].id);
    return unavailable
      ? r.fulfill({ status: 404, json: { error: "Image unavailable" } })
      : r.fulfill({
          body: pixels[index],
          contentType: "image/jpeg",
          headers: { "Cache-Control": "private, no-store" },
        });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#food");
  const mealPhoto = page
    .locator(".food-meal")
    .getByRole("button", { name: "Open photo: Photo lunch" });
  await mealPhoto.scrollIntoViewIfNeeded();
  const thumbnail = await mealPhoto.boundingBox();
  await mealPhoto.focus();
  const before = reads.length;
  await page.keyboard.press("Enter");
  const viewer = page.getByRole("dialog");
  const photo = viewer.locator(".photo-viewer-content").getByRole("img");
  await expect(photo).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => reads.length).toBe(before + 1);
  const enlarged = await photo.boundingBox();
  expect(enlarged!.width).toBeGreaterThan(thumbnail!.width);
  expect(enlarged!.height).toBeGreaterThan(thumbnail!.height);
  await expect(viewer.getByRole("button", { name: /Open photo/ })).toHaveCount(
    0,
  );
  await expect(
    viewer.getByRole("link", { name: "Download photo" }),
  ).toHaveAttribute("href", /^blob:/);
  for (const size of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await expect(photo).toBeInViewport({ ratio: 1 });
    await expect(
      viewer.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await photo.evaluate((element) => getComputedStyle(element).objectFit),
    ).toBe("contain");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("food-photo-enlarged.png"),
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(mealPhoto).toBeFocused();

  await page.goto("/#images");
  await page
    .getByRole("button", { name: "Open photo: Sleep screenshot" })
    .click();
  await expect(photo).toHaveAttribute("alt", "Sleep screenshot");
  await expect(photo).toBeInViewport({ ratio: 1 });
  expect(
    await photo.evaluate((element) => getComputedStyle(element).objectFit),
  ).toBe("contain");
  await page.screenshot({
    path: testInfo.outputPath("portrait-photo-enlarged.png"),
  });
  await viewer.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto(`/#coach/photo/${images[1].id}`);
  const draft = page.getByLabel("Message your coach");
  await draft.fill("Keep this draft while I look at my photos.");
  await page
    .locator(".agent-composer")
    .getByRole("button", { name: "Open photo: Image ready to send" })
    .click();
  await expect(photo).toHaveAttribute("src", /^blob:/);
  await viewer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(draft).toHaveValue("Keep this draft while I look at my photos.");
  await page
    .locator(".chat-user")
    .getByRole("button", { name: "Open photo: Attached image" })
    .click();
  await expect(photo).toHaveAttribute("src", /^blob:/);
  await viewer.getByRole("button", { name: "Close", exact: true }).click();
  unavailable = true;
  await page
    .locator(".chat-user")
    .getByRole("button", { name: "Open photo: Attached image" })
    .click();
  await expect(viewer).toContainText("Photo unavailable");
  await expect(photo).toHaveCount(0);
  await expect(
    viewer.getByRole("link", { name: "Download photo" }),
  ).toHaveCount(0);
  await viewer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(draft).toHaveValue("Keep this draft while I look at my photos.");
});
