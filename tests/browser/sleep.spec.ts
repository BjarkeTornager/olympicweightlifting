import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { emptyJournal, today } from "../../lib/domain";
import { saveCheckin } from "../../lib/health";
import type { UserImage } from "../../lib/images";

test.describe("sleep with Coach", () => {
  test.use({ serviceWorkers: "block" });
  for (const source of ["text", "screenshot"] as const) {
    test(`${source} prepares a precise sleep review, saves once, and remains editable without changing other measurements`, async ({
      page,
      context,
    }, testInfo) => {
      const user = {
          id: "sleep-browser-account",
          name: "Synthetic account",
          email: "sleep@example.test",
        },
        date = today();
      let state = emptyJournal(),
        revision = 0,
        saves = 0;
      saveCheckin(
        state,
        { date, waterMl: 750, bodyweight: 80, notes: "Keep this note" },
        date,
      );
      const checkin = { ...state.health.checkins[0], sleepHours: 7 + 47 / 60 };
      const photo: UserImage = {
        id: crypto.randomUUID(),
        date,
        label: "Synthetic sleep report",
        bytes: 100,
        createdAt: new Date().toISOString(),
        version: 1,
        category: "sleep",
        classification: {
          tags: ["apple health", "sleep report"],
          source: "automatic",
          confidence: "high",
          status: "ready",
        },
      };
      const pixels = await sharp({
        create: { width: 300, height: 400, channels: 3, background: "#c8b9e9" },
      })
        .jpeg()
        .toBuffer();
      await context.route("**/api/session", (r) =>
        r.fulfill({
          json: { user, configured: true, google: true, localPassword: false },
        }),
      );
      await context.route("**/api/journal", (r) => {
        if (r.request().method() !== "GET") {
          state = r.request().postDataJSON().state;
          revision++;
        }
        return r.fulfill({ json: { accountId: user.id, state, revision } });
      });
      await context.route("**/api/images**", (r) => {
        const url = new URL(r.request().url());
        if (url.pathname === "/api/images")
          return r.fulfill({ json: { images: [photo] } });
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
        expect(input.photoIds).toEqual(
          source === "screenshot" ? [photo.id] : [],
        );
        expect(input.message).toMatch(
          source === "screenshot"
            ? /Log my sleep from this screenshot/
            : /7 hours 47 minutes/,
        );
        expect(state.health.checkins[0].sleepHours).toBeNull();
        return r.fulfill({
          json: {
            reply:
              "Review 7 hours 47 minutes of sleep for the wake-up date below.",
            proposals: [
              {
                id: "sleep-proposal",
                title: "Log your sleep",
                detail: "Keeps your other daily values.",
                checkin,
                workout: null,
                expiresAt: new Date(Date.now() + 86400000).toISOString(),
              },
            ],
          },
        });
      });
      await context.route("**/api/agent/action", (r) => {
        expect(r.request().postDataJSON().id).toBe("sleep-proposal");
        saves++;
        state.health.checkins = [checkin];
        revision++;
        return r.fulfill({
          json: { accountId: user.id, state, revision, status: "saved" },
        });
      });
      await page.setViewportSize({ width: 390, height: 844 });
      if (source === "screenshot") {
        await page.goto("/#images");
        await page
          .getByRole("button", { name: "Log sleep with Coach", exact: true })
          .click();
      } else {
        await page.goto("/#health");
        await page
          .locator(".page-heading")
          .getByRole("button", { name: "Log sleep with Coach", exact: true })
          .click();
        await expect(page.getByLabel("Message your coach")).toHaveValue(
          /Help me log my sleep/,
        );
        await page
          .getByLabel("Message your coach")
          .fill("I slept 7 hours 47 minutes last night.");
        await page
          .getByRole("button", { name: "Log sleep", exact: true })
          .click();
        await expect(page.getByLabel("Message your coach")).toHaveValue(
          /I slept 7 hours 47 minutes last night/,
        );
      }
      await expect(
        page.getByText("Ready to help", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Log your sleep", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".checkin-details")).toContainText(
        "7 h 47 min sleep",
      );
      await expect(page.locator(".checkin-details")).toContainText(
        "750 ml water",
      );
      expect(saves).toBe(0);
      await page
        .getByRole("button", { name: "Save this change", exact: true })
        .click();
      await expect(
        page.getByText("Saved to your account.", { exact: true }),
      ).toBeVisible();
      expect(saves).toBe(1);
      expect(state.nutrition.meals).toHaveLength(0);
      await page.getByRole("button", { name: "Coach options" }).click();
      await page
        .getByRole("button", { name: "Health history", exact: true })
        .click();
      await expect(page.locator(".health-records article")).toHaveCount(1);
      await expect(page.locator(".health-records article")).toContainText(
        "7 h 47 min sleep",
      );
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Water today", { exact: true }).fill("1000");
      await dialog
        .getByRole("button", { name: "Save check-in", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".health-records article")).toContainText(
        "1000 ml water",
      );
      await expect(page.locator(".health-records article")).toContainText(
        "7 h 47 min sleep",
      );
      await expect(
        page.getByRole("button", { name: "All changes synced", exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(page.locator(".health-records article")).toContainText(
        "7 h 47 min sleep",
      );
      await expect(page.locator(".health-records article")).toContainText(
        "Keep this note",
      );
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        axe.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.failureSummary),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath("sleep-history-mobile.png"),
        fullPage: true,
      });
    });
  }
});
