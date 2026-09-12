import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today, createWorkout, days } from "../../lib/domain";
import { saveCardio } from "../../lib/cardio";
import type { UserImage } from "../../lib/images";
import sharp from "sharp";

test("Walking is discoverable in an ongoing workout and logs duration without changing strength sets", async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let state = emptyJournal(),
    revision = 0;
  state.activeWorkout = createWorkout(state, days[0], today());
  const originalWorkout = structuredClone(state.activeWorkout);
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.goto("/#workout");
  const search = page.getByRole("searchbox", {
    name: "Find an exercise or activity",
  });
  const picker = page.getByRole("combobox", {
    name: "Add an exercise or activity",
  });
  for (const [query, activity] of [
    ["jog", "running"],
    ["bike", "cycling"],
    ["walk", "walking"],
  ]) {
    await search.fill(query);
    await expect(
      picker.locator(`option[value="activity:${activity}"]`),
    ).toHaveCount(1);
  }
  await search.fill("Walking");
  await picker.selectOption("activity:walking");
  await page.getByRole("button", { name: "Log Walking", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Log Walking", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "Activity", exact: true }),
  ).toHaveValue("walking");
  await expect(dialog.getByLabel("Activity date")).toHaveValue(
    originalWorkout.date,
  );
  await expect(dialog.getByLabel("Distance · optional")).toHaveValue("");
  await dialog
    .getByRole("button", { name: "Save activity", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Enter the activity duration.",
  );
  expect(state.cardio.sessions).toHaveLength(0);
  await dialog.getByLabel("Minutes", { exact: true }).fill("30");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("Distance · optional", { exact: true }).fill("2.5");
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await dialog.screenshot({
    path: info.outputPath("walking-from-workout.png"),
  });
  await dialog
    .getByRole("button", { name: "Save activity", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#workout$/);
  await expect(
    page.getByRole("region", { name: "Movement on this training day" }),
  ).toContainText("Walking");
  await expect(
    page.getByRole("region", { name: "Movement on this training day" }),
  ).toContainText("30 min · 2.5 km");
  await expect.poll(() => state.cardio.sessions.length).toBe(1);
  expect(state.cardio.sessions[0]).toMatchObject({
    activity: "walking",
    durationSeconds: 1800,
    distanceKm: 2.5,
    caloriesKcal: null,
  });
  expect(state.activeWorkout).toEqual(originalWorkout);
  expect(state.sessions).toHaveLength(0);
  expect(state.nutrition.meals).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Movement on this training day" }),
  ).toContainText("Walking");
  await page.getByRole("link", { name: "View activity history" }).click();
  await expect(page.locator(".cardio-history")).toContainText("Walking");
  await expect(page.locator(".cardio-history")).toContainText("12:00 /km");
  await page
    .getByRole("combobox", { name: "Activity type", exact: true })
    .selectOption("walking");
  await expect(page.locator(".cardio-history")).toHaveCount(1);
});

test("Cardio on a phone: add, correct, filter, reload and delete while preserving strength and food", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let state = emptyJournal(),
    revision = 0;
  state.activeWorkout = createWorkout(state, undefined, today());
  state.activeWorkout.title = "Saved lifting draft";
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.goto("/#workout");
  await page
    .getByRole("navigation", { name: "Training navigation" })
    .getByRole("link", { name: "Cardio", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cardio & movement", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Minutes", { exact: true }).fill("28");
  await dialog.getByLabel("Distance · optional", { exact: true }).fill("5");
  await dialog.getByText("More details", { exact: false }).click();
  await dialog
    .getByLabel("Average heart rate · bpm", { exact: true })
    .fill("145");
  await dialog
    .getByLabel("Notes", { exact: true })
    .fill("Easy loop in the park");
  const formAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(formAxe.violations).toEqual([]);
  await dialog
    .getByRole("button", { name: "Save activity", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const run = page.locator(".cardio-history").first();
  await expect(run).toContainText("5:36 /km");
  await run.locator("summary").click();
  await expect(run).toContainText("145 bpm");
  await run.getByRole("button", { name: "Edit activity", exact: true }).click();
  await dialog.getByLabel("Seconds", { exact: true }).fill("20");
  await dialog.getByRole("button", { name: "Save activity changes" }).click();
  await expect(run).toContainText("5:40 /km");
  await expect(run).toContainText("Easy loop in the park");
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Activity", exact: true })
    .selectOption("cycling");
  await dialog.getByLabel("Hours", { exact: true }).fill("1");
  await dialog.getByLabel("Distance · optional", { exact: true }).fill("10");
  await dialog
    .getByRole("combobox", { name: "Distance unit", exact: true })
    .selectOption("mi");
  await dialog
    .getByRole("button", { name: "Save activity", exact: true })
    .click();
  await expect(page.locator(".cardio-history")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "All changes synced", exact: true }),
  ).toBeVisible();
  expect(
    state.cardio.sessions.find((s) => s.activity === "cycling")?.distanceKm,
  ).toBeCloseTo(16.09344, 6);
  expect(state.activeWorkout?.title).toBe("Saved lifting draft");
  expect(state.nutrition.meals).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".cardio-history")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Activity type", exact: true })
    .selectOption("running");
  await expect(page.locator(".cardio-history")).toHaveCount(1);
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
  expect(axe.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("cardio-mobile.png"),
    fullPage: true,
  });
  await page.locator(".cardio-history summary").click();
  await page
    .getByRole("button", { name: "Delete activity", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No activities in this view" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Activity type", exact: true })
    .selectOption("all");
  await expect(page.locator(".cardio-history")).toHaveCount(1);
  await expect(page.locator(".cardio-history")).toContainText("Cycling");
});

for (const source of ["text", "screenshot"] as const) {
  test(`Coach cardio from ${source} requires review and preserves other health records`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let state = emptyJournal(),
      revision = 0,
      saves = 0;
    const prepared = structuredClone(state);
    const entry = saveCardio(
      prepared,
      {
        activity: "cycling",
        date: today(),
        durationSeconds: 3600,
        distanceKm: 20,
        averageHeartRate: 135,
        notes: "Easy ride",
      },
      today(),
    );
    const photo: UserImage = {
      id: crypto.randomUUID(),
      date: today(),
      label: "Synthetic activity report",
      bytes: 100,
      createdAt: new Date().toISOString(),
      version: 1,
      category: "activity",
      classification: {
        tags: ["cycling", "activity report"],
        source: "automatic",
        confidence: "high",
        status: "ready",
      },
    };
    const pixels = await sharp({
      create: { width: 300, height: 400, channels: 3, background: "#d3e9e4" },
    })
      .jpeg()
      .toBuffer();
    await context.route("**/api/journal", (r) =>
      r.fulfill({ json: { accountId: browserUser.id, state, revision } }),
    );
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
          json: { enabled: true, provider: "Synthetic provider", turns: [] },
        });
      const input = r.request().postDataJSON();
      expect(input.photoIds).toEqual(source === "screenshot" ? [photo.id] : []);
      expect(state.cardio.sessions).toHaveLength(0);
      return r.fulfill({
        json: {
          reply: "Ready for your review. Check the cycling details.",
          proposals: [
            {
              id: "cardio-proposal",
              title: "Log your cardio",
              detail: "Recorded duration and distance.",
              cardio: entry,
              workout: null,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          ],
        },
      });
    });
    await context.route("**/api/agent/action", (r) => {
      expect(r.request().postDataJSON().id).toBe("cardio-proposal");
      saves++;
      state = structuredClone(prepared);
      revision++;
      return r.fulfill({
        json: { accountId: browserUser.id, state, revision, status: "saved" },
      });
    });
    if (source === "screenshot") {
      await page.goto("/#images");
      await page
        .getByRole("button", { name: "Log activity with Coach", exact: true })
        .click();
      await expect(page.getByLabel("Message your coach")).toHaveValue(
        /Help me log a cardio activity/,
      );
      await page
        .getByLabel("Message your coach")
        .fill("Log my cycling activity from this screenshot for today.");
    } else {
      await page.goto("/#cardio");
      await page
        .getByRole("button", { name: "Log with Coach", exact: true })
        .click();
      await expect(page.getByLabel("Message your coach")).toHaveValue(
        /Help me log a cardio activity/,
      );
      await page
        .getByLabel("Message your coach")
        .fill("I cycled 20 km in one hour today, average heart rate 135.");
    }
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Log your cardio", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".cardio-details")).toContainText("20 km/h");
    await expect(page.locator(".cardio-details")).toContainText("135 bpm");
    expect(saves).toBe(0);
    await page
      .getByRole("button", { name: "Save this change", exact: true })
      .click();
    await expect(
      page.getByText("Saved to your account.", { exact: true }),
    ).toBeVisible();
    expect(saves).toBe(1);
    expect(state.nutrition.meals).toHaveLength(0);
    expect(state.health.checkins).toHaveLength(0);
    await page
      .getByRole("region", { name: "Review journal change" })
      .locator("summary")
      .click();
    await page
      .getByRole("button", { name: "Open journal", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Cardio & movement", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".cardio-history")).toHaveCount(1);
  });
}
