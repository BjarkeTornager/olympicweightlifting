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
  // Sex and everyday activity are the athlete's to choose: nothing is
  // preselected, and there is no plan until both are chosen.
  await expect(dialog.getByLabel("Sex")).toHaveValue("");
  await expect(dialog.getByLabel("Active outside training")).toHaveValue("");
  await expect(dialog.getByLabel("Session length (min)")).toHaveValue("75");
  await dialog.getByLabel("Age").fill("34");
  await dialog.getByLabel("Height (cm)").fill("182");
  await dialog.getByLabel("Weight now (kg)").fill("88");
  await dialog.getByLabel("Goal weight (kg)").fill("81");
  await dialog.getByLabel("Days I can train").fill("4");
  // With every number in, the form names the choices still to make, as
  // Save stays disabled.
  await expect(
    dialog.getByText(
      "Choose your sex and how active you are outside training to see your daily plan.",
    ),
  ).toBeVisible();
  await dialog.getByLabel("Sex").selectOption("male");
  await expect(
    dialog.getByText(
      "Choose how active you are outside training to see your daily plan.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save goals" }),
  ).toBeDisabled();
  await dialog.getByLabel("Active outside training").selectOption("moderate");
  const plan = dialog.getByRole("status");
  await expect(plan).toContainText("Lose about 0.44 kg a week towards 81 kg");
  await expect(plan).toContainText("2,640 kcal a day");
  await expect(plan).toContainText("4 training sessions a week");
  // Longer sessions and heavy manual work count more energy.
  await dialog.getByLabel("Session length (min)").fill("120");
  await expect(plan).toContainText("2,790 kcal a day");
  await dialog.getByLabel("Session length (min)").fill("75");
  await dialog
    .getByLabel("Active outside training")
    .selectOption("Heavy manual work");
  await expect(plan).toContainText("3,470 kcal a day");
  await dialog.getByLabel("Active outside training").selectOption("moderate");
  await expect(plan).toContainText("2,640 kcal a day");
  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("goals-form.png") });
  // Men aren't asked about pregnancy. Everyone may say they have kidney
  // disease or were told to limit protein: the plan then sets no protein
  // target.
  await expect(dialog.getByLabel("Pregnant or breastfeeding")).toHaveCount(0);
  await expect(dialog).toContainText(
    "no protein target with kidney disease or a doctor's limit on protein; choose No or Prefer not to say to remove it",
  );
  const kidney = dialog.getByLabel("Kidney disease, or told to limit protein");
  await expect(kidney).toHaveValue("");
  await kidney.selectOption("yes");
  await expect(plan).toContainText("g fat, with no protein target");
  await expect(plan).toContainText("follow your doctor's", {
    ignoreCase: true,
  });
  await kidney.selectOption("");
  await expect(plan).toContainText("g protein");
  // An unhealthy goal is flagged, not silently accepted: just under the
  // healthy range, the plan holds until the athlete confirms.
  await dialog.getByLabel("Goal weight (kg)").fill("58");
  await expect(plan).toContainText("below the healthy range");
  await expect(plan).toContainText("Hold around 88 kg");
  const confirm = dialog.getByLabel("I still want to lose weight, slowly");
  await confirm.check();
  await expect(plan).toContainText("Lose about 0.44 kg a week towards 58 kg");
  await expect(plan).toContainText("As you've confirmed it");
  await page.screenshot({ path: info.outputPath("goals-confirmed.png") });
  await dialog.getByLabel("Goal weight (kg)").fill("81");
  await expect(confirm).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save goals" }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("region", { name: "Your goals" });
  await expect(row).toContainText("81 kg goal · 4 sessions a week");
  await expect(row).toContainText("2,640");
  await page.reload();
  await expect(page.getByRole("region", { name: "Your goals" })).toContainText(
    "2,640",
  );
  // The plan is now the Food page's daily target.
  await page.goto("/#food");
  await page.getByRole("button", { name: "Daily targets" }).click();
  await expect(page.getByLabel(/calories/i).first()).toHaveValue("2640");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("under 18 the form asks no body fat, and breastfeeding holds weight", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#today");
  await page
    .getByRole("region", { name: "Your goals" })
    .getByRole("button", { name: "Fill in yourself" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Your goals" });
  await dialog.getByLabel("Age").fill("16");
  await dialog.getByLabel("Height (cm)").fill("165");
  await dialog.getByLabel("Sex").selectOption("female");
  await dialog.getByLabel("Weight now (kg)").fill("60");
  await dialog.getByLabel("Goal weight (kg)").fill("55");
  await dialog.getByLabel("Active outside training").selectOption("moderate");
  await dialog.getByLabel("Days I can train").fill("3");
  await expect(dialog.getByLabel("Body fat now (%, optional)")).toHaveCount(0);
  await expect(dialog.getByLabel("Goal body fat (%, optional)")).toHaveCount(0);
  const plan = dialog.getByRole("status");
  await expect(plan).toContainText("Hold around 60 kg");
  await expect(plan).toContainText(
    "Under 18 the plan doesn't set a calorie deficit",
  );
  // An adult loses weight, unless she is pregnant or breastfeeding.
  await dialog.getByLabel("Age").fill("31");
  await expect(dialog.getByLabel("Body fat now (%, optional)")).toBeVisible();
  await expect(plan).toContainText("Lose about");
  const status = dialog.getByLabel("Pregnant or breastfeeding");
  await status.selectOption("pregnant");
  await expect(plan).toContainText(
    "No weight goal, and no daily calorie or macro targets, while you're pregnant",
  );
  await expect(plan).toContainText("midwife or doctor");
  await status.selectOption("breastfeeding");
  await expect(plan).toContainText("Hold around 60 kg");
  await expect(plan).toContainText("milk supply");
  await expect(plan).toContainText("with no protein target");
  await expect(dialog).toContainText(
    "Choose No, Neither or Prefer not to say to remove them.",
  );
  // No deficit until the baby is 6 weeks old, then a gentle one.
  const baby = dialog.getByLabel("Baby’s age (weeks, optional)");
  await expect(plan).toContainText("Say how old your baby is");
  await baby.fill("3");
  await expect(plan).toContainText("no deficit until your baby is 6 weeks");
  await expect(plan).toContainText("Hold around 60 kg");
  await baby.fill("8");
  await expect(plan).toContainText("Lose about 0.23 kg a week");
  await expect(plan).toContainText("keeps any deficit gentle");
  await page.screenshot({ path: info.outputPath("goals-breastfeeding.png") });
  await dialog.getByRole("button", { name: "Save goals" }).click();
  await expect(dialog).toHaveCount(0);
  // The form remembers it. Neither clears it, and so does Prefer not to
  // say: what the preview shows is what is saved.
  const reopen = () =>
    page
      .getByRole("region", { name: "Your goals" })
      .getByRole("button")
      .click();
  await reopen();
  await expect(status).toHaveValue("breastfeeding");
  await expect(baby).toHaveValue("8");
  await expect(plan).toContainText("Lose about 0.23 kg a week");
  await status.selectOption("neither");
  await expect(plan).toContainText("Lose about");
  await status.selectOption("");
  await expect(plan).toContainText("Lose about");
  await dialog.getByRole("button", { name: "Save goals" }).click();
  await expect(dialog).toHaveCount(0);
  await reopen();
  await expect(status).toHaveValue("");
  await expect(plan).toContainText("Lose about");
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
