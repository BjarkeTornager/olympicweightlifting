import { test, expect, openTodayOverview, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today } from "../../lib/domain";
import { offsetDate, saveCheckin } from "../../lib/health";

test("two weeks of short sleep open Today, hide for a week, and average from five nights", async ({
  page,
  context,
}, testInfo) => {
  const date = today(),
    state = emptyJournal();
  for (let day = 0; day < 14; day++)
    saveCheckin(state, { date: offsetDate(date, -day), sleepHours: 6 }, date);
  await context.route("**/api/journal", (r) =>
    r.fulfill({ json: { accountId: browserUser.id, state, revision: 1 } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await openTodayOverview(page);
  const opening = page.getByRole("complementary", {
    name: "A thought from Coach",
  });
  await expect(opening).toContainText(
    "Your nights have been on the short side.",
  );
  await expect(opening).toContainText(
    "Your 14 logged nights from the last two weeks average 6 h, under the 7 hours or more most adults need.",
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
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
    path: testInfo.outputPath("sleep-short-opening-mobile.png"),
    fullPage: true,
  });

  await opening.getByRole("button", { name: "Hide for a week" }).click();
  await expect(opening).toHaveCount(0);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
      `lift-coach-week:${browserUser.id}`,
    ),
  ).toEqual({ "sleep-short": date });

  // The next days bring the other openings, not the hidden note.
  const hiddenOn = async (day: string) => {
    await page.evaluate(
      ([account, day]) => {
        localStorage.setItem(`lift-coach:${account}`, "");
        localStorage.setItem(
          `lift-coach-week:${account}`,
          JSON.stringify({ "sleep-short": day }),
        );
      },
      [browserUser.id, day],
    );
    await page.reload();
    await openTodayOverview(page);
  };
  await hiddenOn(offsetDate(date, -6));
  await expect(opening).toContainText("Let’s start with what matters to you");
  await expect(opening).not.toContainText("short side");
  // A week on, it can come back.
  await hiddenOn(offsetDate(date, -7));
  await expect(opening).toContainText(
    "Your nights have been on the short side.",
  );

  // The Health page's average, in hours and minutes, with its nights.
  await page.goto("/#health");
  const sleep = page.locator(".health-summary-grid .panel").first();
  await expect(sleep).toContainText("6 h");
  await expect(sleep).toContainText("14-day average of 14 logged nights");
});

test("fewer than five nights give no average and no short-sleep opening", async ({
  page,
  context,
}) => {
  const date = today(),
    state = emptyJournal();
  for (let day = 1; day < 5; day++)
    saveCheckin(state, { date: offsetDate(date, -day), sleepHours: 5 }, date);
  await context.route("**/api/journal", (r) =>
    r.fulfill({ json: { accountId: browserUser.id, state, revision: 1 } }),
  );
  await page.goto("/#health");
  const sleep = page.locator(".health-summary-grid .panel").first();
  await expect(sleep).toContainText("4 of 5 nights logged for an average");
  await page.goto("/#coach");
  await openTodayOverview(page);
  await expect(
    page.getByRole("complementary", { name: "A thought from Coach" }),
  ).not.toContainText("short");
});
