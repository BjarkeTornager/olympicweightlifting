import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import type { UserImage } from "../../lib/images";
import { emptyJournal } from "../../lib/domain";
import sharp from "sharp";
import { createServer, request } from "node:http";
test("manual food logging, extra ingredients, correction, targets and locking on connection loss", async ({
  page,
  context,
}) => {
  // A stopped real origin exercises offline navigation without WebKit's setOffline navigation bug.
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(
      `http://127.0.0.1:34173${incoming.url}`,
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw Error("Missing test origin");
  try {
    await page.goto(`http://127.0.0.1:${address.port}/#food`);
    await page
      .getByRole("button", { name: "Daily targets", exact: true })
      .click();
    await page.getByLabel("Calories (kcal)", { exact: true }).fill("2300");
    await page.getByLabel("Protein (g)", { exact: true }).fill("150");
    await page.getByRole("button", { name: "Save targets" }).click();
    await page.getByRole("button", { name: "Add meal manually" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Meal name", { exact: true }).fill("Lunch bowl");
    await dialog.getByLabel("Food name", { exact: true }).fill("Rice");
    await dialog.getByLabel("Portion", { exact: true }).fill("150 g cooked");
    await dialog.getByLabel("Calories (kcal)", { exact: true }).fill("195");
    await dialog.getByLabel("Protein (g)", { exact: true }).fill("4");
    await dialog.getByRole("button", { name: "Add another food" }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("Food name", { exact: true })
      .nth(1)
      .fill("Chicken");
    await dialog
      .getByLabel("Portion", { exact: true })
      .nth(1)
      .fill("100 g cooked");
    await dialog
      .getByLabel("Calories (kcal)", { exact: true })
      .nth(1)
      .fill("165");
    await dialog.getByLabel("Protein (g)", { exact: true }).nth(1).fill("31");
    await dialog
      .getByRole("button", { name: "Save meal", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".food-totals")).toContainText("360");
    await expect(page.locator(".food-totals")).toContainText("35");
    await page.reload();
    await expect(page.getByText("Lunch bowl", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit meal", exact: true }).click();
    await dialog
      .getByLabel("Calories (kcal)", { exact: true })
      .first()
      .fill("130");
    await dialog
      .getByRole("button", { name: "Save meal", exact: true })
      .click();
    await expect(page.locator(".food-totals")).toContainText("295");
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
    await page
      .getByRole("button", { name: "Delete meal", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Delete meal", exact: true })
      .click();
    await expect(page.getByText("Lunch bowl", { exact: true })).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.locator(".public-landing")).toBeVisible();
    await expect(page.locator(".private-shell")).toBeHidden();
  } finally {
    proxy.closeAllConnections();
    proxy.close();
  }
});
test("old device journals open Food without losing training data", async ({
  page,
}) => {
  await page.goto("/#food");
  await expect(
    page.getByRole("heading", { name: "Fuel your day." }),
  ).toBeVisible();
  await page.evaluate(async (state) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("lift-journal-cloud", 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("journals", "readwrite"),
        store = tx.objectStore("journals");
      const legacy = { ...state, nutrition: undefined };
      legacy.profile.bodyweight = 88;
      store.put({
        accountId: "browser-test-account",
        state: legacy,
        revision: 0,
        seq: 0,
        dirty: true,
      });
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, emptyJournal());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Fuel your day." }),
  ).toBeVisible();
  await expect(
    page.getByText("No meals logged for this date.", { exact: false }),
  ).toBeVisible();
  const weight = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("lift-journal-cloud", 1);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<number>((resolve) => {
      const r = db
        .transaction("journals")
        .objectStore("journals")
        .get("browser-test-account");
      r.onsuccess = () => {
        resolve(r.result.state.profile.bodyweight);
        db.close();
      };
    });
  });
  expect(weight).toBe(88);
});
test.describe("authenticated photo UI", () => {
  test.use({ serviceWorkers: "block" });
  test("photo catalog uploads, sends an attachment for review, saves and displays a meal", async ({
    page,
    context,
  }, testInfo) => {
    const user = {
      id: "food-ui-account",
      name: "Private Person",
      email: "food-ui@example.test",
    };
    let server = { state: emptyJournal(), revision: 0 },
      writes = 0;
    const photos: UserImage[] = [];
    const image = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#d3ae70" },
    })
      .jpeg()
      .toBuffer();
    await context.route("**/api/session", (r) =>
      r.fulfill({
        json: { user, configured: true, google: true, localPassword: false },
      }),
    );
    await context.route("**/api/journal", (r) =>
      r.fulfill({ json: { accountId: user.id, ...server } }),
    );
    await context.route(/\/api\/images(?:\?category=food)?$/, async (r) => {
      expect(r.request().headers()["x-journal-account"]).toBe(user.id);
      if (r.request().method() === "POST") {
        const data = r.request().postDataJSON();
        expect(data.image.length).toBeGreaterThan(100);
        const photo: UserImage = {
          id: data.id,
          label: data.label,
          date: data.date,
          bytes: image.length,
          category: "food",
          classification: {
            source: "automatic",
            status: "ready",
            confidence: "high",
            tags: ["meal"],
          },
          version: 1,
          createdAt: new Date().toISOString(),
        };
        photos.push(photo);
        await r.fulfill({ json: photo });
      } else await r.fulfill({ json: { images: photos } });
    });
    await context.route("**/api/images/*", (r) => {
      if (new URL(r.request().url()).searchParams.get("metadata") === "1")
        return r.fulfill({ json: photos[0] });
      return r.fulfill({
        body: image,
        contentType: "image/jpeg",
        headers: { "Cache-Control": "private, no-store" },
      });
    });
    const meal = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date: "2026-09-06",
      name: "Photo lunch",
      type: "lunch" as const,
      source: "photo" as const,
      estimated: true,
      notes: "Assumes 150 g rice and no added oil.",
      items: [
        {
          name: "Rice",
          portion: "150 g cooked",
          calories: 195,
          protein: 4,
          carbs: 42,
          fat: 0.5,
        },
      ],
      photoIds: [] as string[],
    };
    const proposal = {
      id: crypto.randomUUID(),
      title: "Log your meal",
      detail: "Estimated nutrition. Review portions before saving.",
      meal,
      workout: null,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await context.route("**/api/agent", (r) => {
      if (r.request().method() === "GET")
        return r.fulfill({
          json: { enabled: true, provider: "Test provider", turns: [] },
        });
      const input = r.request().postDataJSON();
      expect(input.photoIds).toEqual([photos[0].id]);
      meal.photoIds = input.photoIds;
      return r.fulfill({
        json: { reply: "Ready for your review.", proposals: [proposal] },
      });
    });
    await context.route("**/api/agent/action", (r) => {
      writes++;
      server = {
        revision: 1,
        state: {
          ...server.state,
          nutrition: { ...server.state.nutrition, meals: [meal] },
        },
      };
      return r.fulfill({
        json: { ...server, accountId: user.id, status: "saved" },
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#food");
    await page.getByLabel("Food date", { exact: true }).fill("2026-09-06");
    await page.getByLabel("Photo label", { exact: true }).fill("Lunch plate");
    await page.getByLabel("Upload image", { exact: true }).setInputFiles({
      name: "plate.jpg",
      mimeType: "image/jpeg",
      buffer: image,
    });
    await expect(
      page.getByText("Photo saved to your account under Food.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "Lunch plate" })).toBeVisible();
    await page
      .getByRole("button", { name: "Estimate meal", exact: true })
      .click();
    await expect(
      page.getByRole("img", { name: "Image ready to send" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByText("Assumes 150 g rice", { exact: false }),
    ).toBeVisible();
    expect(writes).toBe(0);
    await page
      .getByRole("button", { name: "Save this change", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved to your account." }),
    ).toBeVisible();
    await page.locator(".agent-proposal.saved summary").click();
    await page
      .getByRole("button", { name: "Open journal", exact: false })
      .click();
    await page.getByLabel("Food date", { exact: true }).fill("2026-09-06");
    await expect(page.getByText("Photo lunch", { exact: true })).toBeVisible();
    expect(writes).toBe(1);
    await expect(
      page.getByRole("link", { name: "Download photo", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      report.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("food-mobile.png"),
      fullPage: true,
    });
  });
});
