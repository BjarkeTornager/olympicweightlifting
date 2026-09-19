import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { emptyJournal, today, createWorkout, days } from "../../lib/domain";
import { saveCardio } from "../../lib/cardio";
import { activityLoggingPrompt, type UserImage } from "../../lib/images";

for (const source of ["workout", "coach", "coach-shortcut"] as const) {
  test(`${source} activity photo saves automatically and opens from activity history`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = emptyJournal();
    state.activeWorkout = createWorkout(state, days[0], today());
    const liftingBefore = structuredClone(state.activeWorkout);
    let revision = 0,
      saves = 0,
      uploads = 0;
    let photo!: UserImage;
    const pixels = await sharp(
      Buffer.from(
        '<svg width="540" height="700" xmlns="http://www.w3.org/2000/svg"><rect width="540" height="700" fill="#eff5ef"/><text x="45" y="95" font-size="36">Outdoor Walk</text><text x="45" y="220" font-size="50">35:42</text><text x="45" y="265" font-size="22">Workout time</text><text x="45" y="370" font-size="50">2.70 km</text><text x="45" y="415" font-size="22">Distance</text></svg>',
      ),
    )
      .jpeg()
      .toBuffer();
    await context.route("**/api/journal", (r) =>
      r.fulfill({ json: { accountId: browserUser.id, state, revision } }),
    );
    await context.route("**/api/images**", (r) => {
      expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
      const url = new URL(r.request().url());
      if (r.request().method() === "POST") {
        const input = r.request().postDataJSON();
        expect(input.autoTag).toBe(true);
        expect(input.image).toBeTruthy();
        uploads++;
        photo = {
          id: input.id,
          label: "Walk summary",
          date: today(),
          bytes: pixels.length,
          createdAt: new Date().toISOString(),
          version: 1,
          category: "activity",
          classification: {
            source: "automatic",
            confidence: "high",
            status: "ready",
            tags: ["walking", "screenshot"],
          },
        };
        return r.fulfill({ json: photo });
      }
      if (url.searchParams.get("metadata") === "1")
        return r.fulfill({ json: photo });
      return r.fulfill({ body: pixels, contentType: "image/jpeg" });
    });
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    await context.route("**/api/agent", async (r) => {
      if (r.request().method() === "GET")
        return r.fulfill({
          json: { enabled: true, provider: "Synthetic model", turns: [] },
        });
      const input = r.request().postDataJSON();
      expect(input.photoIds).toEqual([photo.id]);
      if (source === "coach-shortcut")
        expect(input.message).toContain(
          "Log my workout from the attached photo",
        );
      else expect(input.message).toBe(activityLoggingPrompt(true));
      if (source === "workout") expect(input.id).toBe(photo.id);
      started = true;
      await wait;
      const entry = saveCardio(
        state,
        {
          activity: "walking",
          date: today(),
          durationSeconds: 2142,
          distanceKm: 2.7,
          photoIds: [photo.id],
        },
        today(),
      );
      revision++;
      saves++;
      return r.fulfill({
        json: {
          reply: "Saved your 35 min 42 sec walk, 2.7 km.",
          proposals: [
            {
              id: crypto.randomUUID(),
              title: "Log your cardio",
              detail: "Walking",
              cardio: entry,
              workout: null,
              status: "saved",
              automatic: true,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          ],
        },
      });
    });
    await page.goto(`/#${source === "workout" ? "workout" : "coach"}`);
    if (source === "workout") {
      await page.locator(".session-details > summary").click();
      const uploader = page.getByRole("region", {
        name: "Log activity from a photo",
      });
      await expect(
        uploader.getByRole("button", {
          name: "Take activity photo",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        uploader.locator('input[capture="environment"]'),
      ).toHaveAttribute("accept", "image/*");
      await uploader
        .locator('input[type="file"]:not([capture])')
        .setInputFiles({
          name: "walk.jpg",
          mimeType: "image/jpeg",
          buffer: pixels,
        });
      // Opening the picker and selecting a photo is the complete logging action.
    } else {
      await page
        .getByRole("button", { name: "Add images", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Log walk, run or ride" }),
      ).toBeVisible();
      await page
        .locator('#coach-image-tools input[type="file"]:not([capture])')
        .setInputFiles({
          name: "walk.jpg",
          mimeType: "image/jpeg",
          buffer: pixels,
        });
      await expect(
        page.getByRole("button", { name: "Send", exact: true }),
      ).toBeEnabled();
      if (source === "coach-shortcut") {
        await page
          .getByRole("button", { name: "Add workout", exact: true })
          .click();
        await expect(
          page.getByRole("img", { name: "Image ready to send" }),
        ).toHaveCount(1);
        await expect(page).toHaveURL(/#coach$/);
      }
      await page.getByRole("button", { name: "Send", exact: true }).click();
    }
    await expect.poll(() => started).toBe(true);
    expect(saves).toBe(0);
    // Work can finish while the user browses Train; the lifting draft stays intact.
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Train", exact: true })
      .click();
    release();
    await expect.poll(() => saves).toBe(1);
    await page
      .getByRole("navigation", { name: "Training navigation" })
      .getByRole("link", { name: "Cardio", exact: true })
      .click();
    const entry = page.locator(".cardio-history");
    await expect(entry).toHaveCount(1);
    await entry.locator("summary").click();
    await expect(entry).toContainText("35 min 42 sec");
    await expect(entry).toContainText("2.7 km");
    const thumbnail = entry.getByRole("button", {
      name: "Open photo: Walking activity photo",
    });
    await expect(thumbnail).toBeVisible();
    await thumbnail.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(uploads).toBe(1);
    expect(state.nutrition.meals).toHaveLength(0);
    expect(state.activeWorkout).toEqual(liftingBefore);
    expect(state.cardio.sessions[0].photoIds).toEqual([photo.id]);
    expect(state.cardio.sessions[0].caloriesKcal).toBe(null);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath("activity-photo-mobile.png"),
      fullPage: true,
    });
    // A copied/deep-linked URL can attach the saved photo, but cannot save again.
    await page.goto(`/#coach/photo/${photo.id}/cardio/log`);
    await page.reload();
    await expect(page.getByLabel("Message your coach")).toHaveValue(
      activityLoggingPrompt(true),
    );
    expect(saves).toBe(1);
  });
}
