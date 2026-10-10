import AxeBuilder from "@axe-core/playwright";
import {
  browserUser,
  expect,
  isJournalSave,
  savedJournal,
  test,
} from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
import { applyGoals } from "../../lib/body-goals";
import { offsetDate } from "../../lib/health";
import { mealSchema } from "../../lib/nutrition";
import { setDailyTargets } from "../../lib/target-proposals";
import type { JournalState } from "../../lib/model";
import type { SavedVisual } from "../../lib/coach-visuals";
import type { BrowserContext } from "@playwright/test";

// Food against its targets: whole numbers and "about", protein reached,
// fat and carbohydrate as ranges, "under target" once a day is complete,
// averages of complete days only, and a calorie target below the
// athlete's estimated minimum noted and never called exceeded.

const meal = (
  date: string,
  calories: number,
  macros: { protein: number; carbs: number; fat: number },
  estimated = false,
) =>
  mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: `${date}T12:00:00.000Z`,
    date,
    name: "Chicken and rice",
    type: "dinner",
    source: estimated ? "text" : "manual",
    estimated,
    notes: "",
    photoIds: [],
    items: [
      { name: "Chicken and rice", portion: "1 plate", ...macros, calories },
    ],
  });

async function serve(context: BrowserContext, initial: JournalState) {
  const saved = { state: initial, revision: 1 };
  await context.route("**/api/journal", (r) => {
    if (isJournalSave(r.request())) {
      saved.state = savedJournal(r.request(), saved.state);
      saved.revision++;
    }
    return r.fulfill({
      json: {
        accountId: browserUser.id,
        state: saved.state,
        revision: saved.revision,
      },
    });
  });
  return saved;
}

test("a calorie target below the estimated minimum is noted, and never shown as above target", async ({
  page,
  context,
}, info) => {
  const date = today();
  // A 30-year-old woman holding 60 kg, whose plan's least is about 1,400
  // kcal, with her own 1,300 kcal target, and over it today.
  const state = emptyJournal();
  applyGoals(
    state,
    {
      age: 30,
      sex: "female",
      heightCm: 165,
      weightKg: 60,
      targetWeightKg: 60,
      targetDate: null,
      activity: "moderate",
      trainingDays: 3,
      sessionMinutes: 60,
      experience: "developing",
    },
    offsetDate(date, -30),
  );
  setDailyTargets(
    state,
    { goal: "lose", calories: 1300, protein: 110, carbs: 150, fat: 45 },
    offsetDate(date, -7),
  );
  state.nutrition.meals.push(
    meal(date, 1500, { protein: 120, carbs: 150, fat: 52 }, true),
  );
  const saved = await serve(context, state);
  await page.goto("/#food");
  const totals = page.locator(".food-totals");
  // An estimate reads "~"; the target "about".
  await expect(totals.locator(".food-calories strong")).toHaveText(
    "~about 1,500",
  );
  await expect(totals).toContainText("of about 1,300\u00a0kcal");
  await expect(totals.getByRole("note")).toContainText(
    "below your estimated minimum of about 1,400\u00a0kcal a day",
  );
  await expect(totals.locator('[data-macro="protein"]')).toContainText(
    "At least 110\u00a0gReached",
  );
  await expect(totals.locator('[data-macro="carbs"]')).toContainText(
    "About 130 to 150\u00a0gIn range",
  );
  await expect(page.locator(".food-page")).not.toContainText(/above/i);
  await page.screenshot({ path: info.outputPath("food-below-minimum.png") });
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(report.violations.map((v) => v.id)).toEqual([]);
  // Today says the same, and nothing above target either.
  await page.goto("/#today");
  const food = page.getByRole("button", { name: /^Food/ });
  await expect(food).toContainText("~1,500");
  await expect(food).not.toContainText(/above/i);
  // A very low target: the note as it is typed, and a second press saves it.
  await page.goto("/#food");
  await page
    .getByRole("button", { name: "Daily targets", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Calories (kcal)", { exact: true }).fill("700");
  await expect(dialog.getByRole("status")).toContainText(
    "very-low-energy range, under 800\u00a0kcal a day",
  );
  await dialog.getByRole("button", { name: "Save targets" }).click();
  // Not saved yet: the press only asks again.
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Daily targets saved.")).toHaveCount(0);
  expect(saved.state.nutrition.targets.calories).toBe(1300);
  await dialog.getByRole("button", { name: "Save this target anyway" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => saved.state.nutrition.targets.calories).toBe(700);
  await expect(totals.getByRole("note")).toContainText("very-low-energy range");
});

test("averages count complete days only, and today once it is marked complete", async ({
  page,
  context,
}) => {
  const date = today();
  const state = emptyJournal();
  state.nutrition.targets = {
    goal: "maintain",
    calories: 2000,
    protein: 120,
    carbs: 250,
    fat: 65,
  };
  state.nutrition.meals.push(
    // Yesterday in full, marked complete.
    meal(offsetDate(date, -1), 2050, { protein: 130, carbs: 250, fat: 70 }),
    // The day before, partly logged.
    meal(offsetDate(date, -2), 500, { protein: 30, carbs: 60, fat: 15 }),
    // Today, under way.
    meal(date, 400, { protein: 30, carbs: 40, fat: 12 }),
  );
  state.nutrition.completeDays = [offsetDate(date, -1)];
  await serve(context, state);
  await page.goto("/#food");
  const week = page.getByRole("heading", { name: "Last 7 days" }).locator("..");
  await expect(week).toContainText(
    "1 complete day in the last 7: 2,050\u00a0kcal and 130\u00a0g protein a day on average, about on target.",
  );
  const calories = page.locator(".food-calories .fine-print").first();
  await expect(calories).toHaveText("About 1,600\u00a0kcal remaining");
  // Marked complete, today counts, and what's left is under target.
  await page.getByRole("button", { name: "Mark day complete" }).click();
  await expect(calories).toHaveText("About 1,600\u00a0kcal under target");
  await expect(page.locator('[data-macro="fat"]')).toContainText(
    "About 55\u00a0g under the range",
  );
  await expect(week).toContainText(
    "2 complete days in the last 7: 1,225\u00a0kcal and 80\u00a0g protein a day on average, about 800\u00a0kcal under target.",
  );
});

test("Coach's progress visual marks a target of its own as its suggestion", async ({
  page,
  context,
}) => {
  const visual: SavedVisual = {
    id: crypto.randomUUID(),
    content: {
      kind: "progress",
      title: "Today so far",
      targets: [
        { label: "Protein", value: 80, target: 110, unit: "g" },
        {
          label: "Steps",
          value: 6200,
          target: 8000,
          unit: "steps",
          suggested: true,
        },
      ],
    },
  };
  await context.route("**/api/agent", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        provider: "Test provider",
        protocol: "ag-ui",
        turns: [
          {
            id: crypto.randomUUID(),
            question: "How am I doing today?",
            reply: "Protein is on its way.",
            proposals: [],
            visuals: [visual],
            status: "done",
          },
        ],
      },
    }),
  );
  await page.goto("/#coach");
  const items = page.locator(".coach-bar-chart li");
  await expect(items).toHaveCount(2);
  await expect(items.first()).not.toContainText("Suggested by Coach");
  await expect(items.last()).toContainText("Steps · Suggested by Coach");
});
