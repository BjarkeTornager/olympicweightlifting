import AxeBuilder from "@axe-core/playwright";
import { browserUser, expect, test } from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
import { applyGoals } from "../../lib/body-goals";
import { offsetDate, saveCheckin } from "../../lib/health";
import type { JournalState } from "../../lib/model";

// The weight on Today: the latest weigh-in with its day, the trend from
// four weeks of weigh-ins, how it compares with the goals plan, and a note
// when the weight comes down fast.
const athlete = {
  age: 34,
  sex: "male" as const,
  heightCm: 182,
  weightKg: 88,
  targetWeightKg: 81,
  targetDate: null,
  activity: "moderate" as const,
  trainingDays: 4,
  sessionMinutes: 75,
  experience: "developing" as const,
};

async function serve(
  context: import("@playwright/test").BrowserContext,
  state: JournalState,
) {
  await context.route("**/api/journal", (r) =>
    r.fulfill({ json: { accountId: browserUser.id, state, revision: 1 } }),
  );
}

test("Today shows the weight's day, its trend against the plan, and a note on a fast loss", async ({
  page,
  context,
}, info) => {
  const date = today();
  // Goals saved four weeks ago at 88 kg; weigh-ins every other day since,
  // coming down about 1 kg a week, faster than the plan's 0.44 kg.
  const state = emptyJournal();
  applyGoals(state, athlete, offsetDate(date, -28));
  const wiggle = [0.2, -0.1, 0.1, -0.2, 0, 0.15, -0.15];
  [-27, -25, -23, -21, -19, -17, -15, -13, -11, -9, -7, -5, -3, -1].forEach(
    (day, i) =>
      saveCheckin(
        state,
        {
          date: offsetDate(date, day),
          bodyweight:
            Math.round((88 + ((day + 27) * -1) / 7 + wiggle[i % 7]!) * 10) / 10,
        },
        date,
      ),
  );
  await serve(context, state);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#today");
  const weight = page.getByRole("region", { name: "Your weight" });
  const row = weight.getByRole("button", { name: /^Weight/ });
  // Last weighed yesterday, so the day is named.
  await expect(row).toContainText("Yesterday · Down about 1 kg a week");
  await expect(row).toContainText("over the last 4 weeks");
  await expect(weight).toContainText(
    "Faster than your goals plan, which loses about 0.4 kg a week.",
  );
  const note = weight.getByRole("note");
  await expect(note).toContainText("faster than the 1% a week usually advised");
  await expect(note).toContainText("a doctor or sports dietitian can help");
  // A loss already faster than the plan brings no suggestion to cut further.
  await expect(
    page
      .getByRole("region", { name: "Your goals" })
      .getByRole("button", { name: /New daily targets/ }),
  ).toHaveCount(0);
  const axe = await new AxeBuilder({ page })
    .include('[aria-label="Your weight"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await weight.screenshot({ path: info.outputPath("weight-row.png") });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(row).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  // The row opens Health, where the trend sits under the bodyweight.
  await row.click();
  await expect(page.locator(".health-summary-grid")).toContainText(
    "Down about 1 kg a week",
  );
});

test("with too few weigh-ins Today says so, and with none there is no weight row", async ({
  page,
  context,
}) => {
  const date = today();
  const state = emptyJournal();
  saveCheckin(state, { date, bodyweight: 80.2 }, date);
  saveCheckin(state, { date: offsetDate(date, -6), bodyweight: 80.6 }, date);
  await serve(context, state);
  await page.goto("/#today");
  const weight = page.getByRole("region", { name: "Your weight" });
  await expect(weight.getByRole("button", { name: /^Weight/ })).toContainText(
    "Today · Not enough weigh-ins for a trend yet (it takes 4 spread over 14 days)",
  );
  await expect(weight.getByRole("note")).toHaveCount(0);
  await context.unroute("**/api/journal");
  await serve(context, emptyJournal());
  await page.reload();
  await expect(page.getByRole("region", { name: "Your goals" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your weight" })).toHaveCount(
    0,
  );
});

test("a steady weight reads as about stable, and an older weigh-in gives its day", async ({
  page,
  context,
}) => {
  const date = today();
  // Every third day for four weeks, swinging a few hundred grams around
  // 80 kg; the latest three days ago.
  const state = emptyJournal();
  const swing = [0.3, -0.2, 0.1, -0.3, 0.2, 0, -0.1, 0.3, -0.2];
  [-27, -24, -21, -18, -15, -12, -9, -6, -3].forEach((day, i) =>
    saveCheckin(
      state,
      { date: offsetDate(date, day), bodyweight: 80 + swing[i]! },
      date,
    ),
  );
  await serve(context, state);
  await page.goto("/#today");
  const weight = page.getByRole("region", { name: "Your weight" });
  const row = weight.getByRole("button", { name: /^Weight/ });
  const weekday = new Date(
    `${offsetDate(date, -3)}T12:00:00`,
  ).toLocaleDateString("en-GB", { weekday: "short" });
  await expect(row).toContainText(weekday);
  await expect(row).toContainText("About stable over the last 4 weeks");
  await expect(row).toContainText("79.8 kg");
  // No goals, so nothing to compare with, and no note.
  await expect(weight.locator("p")).toHaveCount(0);
});
