import AxeBuilder from "@axe-core/playwright";
import { browserUser, expect, test } from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
import { applyGoals } from "../../lib/body-goals";
import { offsetDate, saveCheckin } from "../../lib/health";
import type { JournalState } from "../../lib/model";

// One target: the Goals card shows the saved daily target, as Food and the
// iPhone do, and the plan, worked out again at the current weight, only
// suggests new targets for the athlete to take or keep theirs over.
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

test("reaching the goal suggests holding the weight; the saved target stays until it is taken", async ({
  page,
  context,
}, info) => {
  const date = today();
  // Goals saved six weeks ago at 88 kg; a week of weigh-ins at 81 kg since.
  let state: JournalState = emptyJournal();
  applyGoals(state, athlete, offsetDate(date, -42));
  for (const [day, bodyweight] of [
    [-6, 81.6],
    [-4, 81.3],
    [-2, 81.4],
    [0, 81.1],
  ] as const)
    saveCheckin(state, { date: offsetDate(date, day), bodyweight }, date);
  let revision = 1;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#today");
  const goals = page.getByRole("region", { name: "Your goals" });
  // The saved target, not the plan's, and the suggestion beside it.
  const saved = goals.getByRole("button", { name: /^Goals/ });
  await expect(saved).toContainText("2,640");
  const suggestion = goals.getByRole("button", {
    name: /Hold your weight from here/,
  });
  await expect(suggestion).toContainText("3,000");
  await goals.screenshot({ path: info.outputPath("goals-suggestion.png") });
  await suggestion.click();
  const dialog = page.getByRole("dialog", {
    name: "Hold your weight from here",
  });
  await expect(dialog).toContainText(
    "Your weight is about 81.4 kg now: you've reached your goal of 81 kg.",
  );
  await expect(dialog).toContainText("Calories: 3,000 kcal (was 2,640 kcal)");
  await expect(dialog).toContainText("Goal: maintain weight (was lose weight)");
  await expect(dialog).toContainText("Nothing changes unless you take them.");
  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("goals-suggestion-review.png"),
  });
  // Closing it changes nothing.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(saved).toContainText("2,640");
  await suggestion.click();
  await dialog.getByRole("button", { name: "Use these targets" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(saved).toContainText("3,000");
  await expect(suggestion).toHaveCount(0);
  await expect.poll(() => state.nutrition.targets.goal).toBe("maintain");
  expect(state.profile.targetHistory?.at(-1)).toMatchObject({
    source: "plan",
    calories: 3000,
    from: date,
    weightKgAtSet: 81.4,
  });
  // The Food page's target is the same one.
  await page.goto("/#food");
  await page.getByRole("button", { name: "Daily targets" }).click();
  await expect(page.getByLabel(/calories/i).first()).toHaveValue("3000");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#today");
    await expect(saved).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("old targets get the higher maintenance as a suggestion, which can be kept over; targets set by hand are the athlete's own", async ({
  page,
  context,
}) => {
  // Goals and the old plan's targets, saved before targets were recorded.
  let state: JournalState = emptyJournal();
  state.profile.body = {
    ...athlete,
    updatedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  };
  state.nutrition.targets = {
    goal: "lose",
    calories: 2350,
    protein: 176,
    carbs: 253,
    fat: 70,
  };
  let revision = 1;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#today");
  const goals = page.getByRole("region", { name: "Your goals" });
  const saved = goals.getByRole("button", { name: /^Goals/ });
  await expect(saved).toContainText("2,350");
  const suggestion = goals.getByRole("button", { name: /New daily targets/ });
  await expect(suggestion).toContainText("2,640");
  await suggestion.click();
  const dialog = page.getByRole("dialog", { name: "New daily targets" });
  await expect(dialog).toContainText(
    "The plan now counts your everyday movement and training more fully, so your maintenance is about 3,120 kcal a day rather than 2,830.",
  );
  await dialog.getByRole("button", { name: "Keep my current targets" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(suggestion).toHaveCount(0);
  await expect(saved).toContainText("2,350");
  await expect.poll(() => state.profile.declinedTargets?.calories).toBe(2640);
  expect(state.nutrition.targets.calories).toBe(2350);
  // Calories set by hand on Food are the athlete's own; the card says so,
  // with the plan's estimate beside them.
  await page.goto("/#food");
  await page.getByRole("button", { name: "Daily targets" }).click();
  await page
    .getByLabel(/calories/i)
    .first()
    .fill("2500");
  await page.getByRole("button", { name: "Save targets" }).click();
  await page.goto("/#today");
  await expect(saved).toContainText("2,500");
  await expect(saved).toContainText(
    "your own target; the plan estimates about 2,640 kcal",
  );
  await expect
    .poll(() => state.profile.targetHistory?.at(-1)?.source)
    .toBe("manual");
  // Saving the goals says it replaces them.
  await saved.click();
  await expect(
    page.getByRole("dialog", { name: "Your goals" }).getByRole("status"),
  ).toContainText("Saving replaces your own daily targets (2,500 kcal)");
});
