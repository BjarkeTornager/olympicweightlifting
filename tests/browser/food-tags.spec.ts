import { test, expect, browserUser } from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
import { mealSchema } from "../../lib/nutrition";
import AxeBuilder from "@axe-core/playwright";
test("meal and ingredient tags survive editing and reload, filter history and remain readable on phones", async ({
  page,
  context,
}, testInfo) => {
  let state = emptyJournal(),
    revision = 0;
  const yesterday = new Date(`${today()}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  state.nutrition.meals = [
    mealSchema.parse({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date: yesterday.toISOString().slice(0, 10),
      name: "Yesterday’s dinner",
      type: "dinner",
      source: "photo",
      photoIds: [],
      estimated: true,
      items: [
        {
          name: "Chicken bowl",
          portion: "1 plate",
          calories: 500,
          protein: 35,
          carbs: 40,
          fat: 20,
          classification: {
            foodGroups: ["meat"],
            ingredients: [
              { name: "chicken", evidence: "visible" },
              { name: "olive oil", evidence: "estimated" },
            ],
          },
        },
      ],
    }),
  ];
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      expect(r.request().headers()["x-food-tags-version"]).toBe("1");
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add meal manually" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Meal name", { exact: true })
    .fill("Oats and berries");
  await dialog
    .getByRole("combobox", { name: "Meal type", exact: true })
    .selectOption("breakfast");
  await dialog.getByLabel("Food name", { exact: true }).fill("Porridge");
  await dialog.getByLabel("Portion", { exact: true }).fill("1 bowl");
  await dialog.getByText("Food groups & ingredients", { exact: true }).click();
  await dialog.getByLabel("Grains & potatoes", { exact: true }).check();
  await dialog.getByLabel("Fruit", { exact: true }).check();
  await dialog
    .getByLabel("Ingredient tags", { exact: true })
    .fill(" OATS, blueberries, oats ");
  await dialog.getByLabel("Calories (kcal)", { exact: true }).fill("350");
  await dialog.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".food-tags")).toContainText("blueberries");
  await page.reload();
  await page.getByLabel("Search all logged dates").check();
  await page.getByLabel("Filter meal type").selectOption("dinner");
  await page.getByLabel("Search food or ingredients").fill("chicken");
  await expect(page.locator(".food-meal")).toHaveCount(1);
  await expect(page.locator(".food-meal")).toContainText("Yesterday’s dinner");
  await expect(page.locator(".food-meal")).toContainText("Assumed ingredient");
  await page.getByRole("button", { name: "Edit meal", exact: true }).click();
  await dialog.getByText("Food groups & ingredients", { exact: true }).click();
  await dialog.getByLabel("Evidence for olive oil").selectOption("reported");
  await dialog
    .getByLabel("Ingredient tags", { exact: true })
    .fill("chicken, olive oil, rice");
  await dialog.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".food-meal")).not.toContainText(
    "Assumed ingredient",
  );
  await page.getByLabel("Filter food group").selectOption("fruit");
  await expect(page.locator(".food-meal")).toHaveCount(0);
  await page.getByLabel("Filter food group").selectOption("");
  await page.getByLabel("Search food or ingredients").fill("rice");
  await expect(page.locator(".food-meal")).toHaveCount(1);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".food-meal").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `/tmp/lift-food-tags-${testInfo.project.name}-phone.png`,
  });
});
