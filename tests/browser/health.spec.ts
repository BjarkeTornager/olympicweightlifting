import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today, createWorkout, days } from "../../lib/domain";
import { saveCheckin, offsetDate } from "../../lib/health";
test("daily check-in saves, refreshes priorities, edits the same day and deletes from health history", async ({
  page,
}) => {
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your day, in focus." }),
  ).toBeVisible();
  await page.locator(".hero-checkin").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Sleep last night", { exact: true }).fill("6.5");
  await dialog.getByLabel("Water today", { exact: true }).fill("500");
  await dialog.getByLabel("Bodyweight", { exact: true }).fill("80.2");
  await dialog
    .getByRole("button", { name: "Energy 2: Low", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Soreness 4: High", exact: true })
    .click();
  await dialog
    .getByLabel("Anything Coach should know?", { exact: true })
    .fill("A busy day and tired legs.");
  const formAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    formAxe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.failureSummary),
    })),
  ).toEqual([]);
  await dialog
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Make room for recovery", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".daily-metric.lilac")).toContainText("6.5");
  await page.reload();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".daily-metric.sky")).toContainText("0.5");
  await page.locator(".hero-checkin").click();
  await dialog.getByLabel("Water today", { exact: true }).fill("750");
  await dialog
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Health history", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Notice your patterns." }),
  ).toBeVisible();
  await expect(page.locator(".health-records article")).toHaveCount(1);
  await expect(page.locator(".health-records article")).toContainText(
    "750 ml water",
  );
  await expect(page.locator(".health-records article")).toContainText(
    "6 h 30 min sleep",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.failureSummary),
    })),
  ).toEqual([]);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Delete check-in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with today." }),
  ).toBeVisible();
});
test.describe("daily coach with a personal journal", () => {
  test.use({ serviceWorkers: "block" });
  test("plan my day requests grounded advice without writing, and the overview fits phone and desktop", async ({
    page,
    context,
  }, testInfo) => {
    const state = emptyJournal(),
      date = today(),
      user = {
        id: "health-ui-person",
        name: "Private account",
        email: "private@example.test",
      };
    for (let i = 0; i < 7; i++)
      saveCheckin(
        state,
        {
          date: offsetDate(date, -i),
          sleepHours: [7.5, 7, 8, 6.5, 8, 7.5, 7][i],
          waterMl: i === 0 ? 1250 : 2000,
          bodyweight: 80.2,
          energy: 4,
          soreness: 2,
        },
        date,
      );
    for (const gap of [1, 3, 5]) {
      const workout = createWorkout(state, days[0], offsetDate(date, -gap));
      workout.exercises.forEach((entry) => {
        entry.completed = true;
        entry.sets.forEach((s) => {
          s.logged = true;
          s.result = "success";
        });
      });
      state.sessions.push(workout);
    }
    state.nutrition.targets = {
      goal: "maintain",
      calories: 2400,
      protein: 150,
      carbs: null,
      fat: null,
    };
    state.nutrition.meals = [
      {
        id: crypto.randomUUID(),
        date,
        name: "Breakfast",
        type: "breakfast",
        source: "manual",
        estimated: false,
        createdAt: new Date().toISOString(),
        notes: "",
        photoIds: [],
        items: [
          {
            name: "Oats with yogurt",
            portion: "One bowl",
            calories: 620,
            protein: 38,
            carbs: 75,
            fat: 19,
          },
        ],
      },
    ];
    let requests = 0,
      writes = 0;
    await context.route("**/api/session", (r) =>
      r.fulfill({
        json: { user, google: true, configured: true, localPassword: false },
      }),
    );
    await context.route("**/api/journal", (r) => {
      if (r.request().method() !== "GET") writes++;
      return r.fulfill({ json: { accountId: user.id, state, revision: 1 } });
    });
    await context.route("**/api/agent", (r) => {
      if (r.request().method() === "GET")
        return r.fulfill({
          json: { enabled: true, provider: "Test provider", turns: [] },
        });
      requests++;
      expect(r.request().postDataJSON().message).toContain(
        "First read my health overview",
      );
      return r.fulfill({
        json: {
          reply:
            "**1. Choose your training.** You logged three sessions in the last seven days and energy 4/5 today. Review your programme before deciding.\n\n**2. Keep food logging current.** Breakfast adds 620 kcal and 38 g protein. This is only one recorded meal.\n\n**3. Protect your evening routine.** You reported 7.5 hours sleep. Keep a consistent bedtime.\n\nNext step: open Train and choose the session that fits today.",
          proposals: [],
        },
      });
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/#coach");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".daily-metric.lilac")).toContainText("7.5");
    await page.screenshot({
      path: testInfo.outputPath("coach-desktop.png"),
      fullPage: true,
    });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    const desktopAxe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      desktopAxe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("coach-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Plan my day", exact: false })
      .click();
    await expect(page.locator(".chat-assistant")).toContainText(
      "Choose your training",
    );
    expect(requests).toBe(1);
    expect(writes).toBe(0);
    await expect(
      page.getByRole("button", { name: "Save this change" }),
    ).toHaveCount(0);
  });
});
