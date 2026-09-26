import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("goals are set from Today, preview the plan and become the daily food targets", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#today");
  const start = page.getByRole("region", { name: "Your goals" });
  await expect(
    start.getByRole("heading", { name: "Set your goals" }),
  ).toBeVisible();
  // Voice is off in this account, so only the form is offered.
  await expect(
    start.getByRole("button", { name: "Set up with Coach" }),
  ).toHaveCount(0);
  await start.getByRole("button", { name: "Fill in yourself" }).click();
  const dialog = page.getByRole("dialog", { name: "Your goals" });
  await expect(
    dialog.getByText("Fill in the numbers to see your daily plan."),
  ).toBeVisible();
  await dialog.getByLabel("Age").fill("34");
  await dialog.getByLabel("Height (cm)").fill("182");
  await dialog.getByLabel("Sex").selectOption("male");
  await dialog.getByLabel("Weight now (kg)").fill("88");
  await dialog.getByLabel("Goal weight (kg)").fill("81");
  await dialog.getByLabel("Active outside training").selectOption("moderate");
  await dialog.getByLabel("Days I can train").fill("4");
  const plan = dialog.getByRole("status");
  await expect(plan).toContainText("Lose about 0.44 kg a week towards 81 kg");
  await expect(plan).toContainText("2,350 kcal a day");
  await expect(plan).toContainText("4 training sessions a week");
  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("goals-form.png") });
  // An unhealthy goal is flagged, not silently accepted.
  await dialog.getByLabel("Goal weight (kg)").fill("58");
  await expect(plan).toContainText("below the healthy range");
  await dialog.getByLabel("Goal weight (kg)").fill("81");
  await dialog.getByRole("button", { name: "Save goals" }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("region", { name: "Your goals" });
  await expect(row).toContainText("81 kg goal · 4 sessions a week");
  await expect(row).toContainText("2,350");
  await page.reload();
  await expect(page.getByRole("region", { name: "Your goals" })).toContainText(
    "2,350",
  );
  // The plan is now the Food page's daily target.
  await page.goto("/#food");
  await page.getByRole("button", { name: "Daily targets" }).click();
  await expect(page.getByLabel(/calories/i).first()).toHaveValue("2350");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("with voice on, goals can be set up by talking to Coach", async ({
  page,
  context,
}) => {
  await context.route("**/api/voice/session", (r) =>
    r.fulfill({ json: { enabled: true } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#today");
  await page
    .getByRole("region", { name: "Your goals" })
    .getByRole("button", { name: "Set up with Coach" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Set up your goals" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start talking" }),
  ).toBeVisible();
});
