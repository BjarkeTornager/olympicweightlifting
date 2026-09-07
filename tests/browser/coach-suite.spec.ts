import { test, expect, browserUser } from "./fixtures";
import type { BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today } from "../../lib/domain";
import { saveCheckin, offsetDate } from "../../lib/health";
import { mealSchema } from "../../lib/nutrition";
import { prepareAction } from "../../lib/agent/actions";
import type { JournalState } from "../../lib/model";

async function seed(context: BrowserContext, initial: JournalState) {
  let state = initial,
    revision = 1;
  await context.route("**/api/journal", (r) => {
    expect(r.request().headers()["x-coach-journal-version"]).toBe("1");
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  return () => state;
}
function example() {
  const state = emptyJournal(),
    date = today();
  saveCheckin(state, { date, sleepHours: 7.5, energy: 3 }, date);
  state.nutrition.meals = [
    mealSchema.parse({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date,
      name: "Rice bowl",
      type: "lunch",
      source: "manual",
      estimated: true,
      items: [
        {
          name: "Rice",
          portion: "One bowl",
          calories: 500,
          protein: 10,
          carbs: 80,
          fat: 4,
          classification: {
            foodGroups: ["grains"],
            ingredients: [{ name: "rice", evidence: "reported" }],
          },
        },
      ],
    }),
  ];
  return state;
}

test("Today and Week stay readable on mobile, expose evidence and respect partial food days", async ({
  page,
  context,
}, info) => {
  const state = example();
  await seed(context, state);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little direction for today." }),
  ).toBeVisible();
  await expect(page.locator(".today-summaries")).toContainText("7 h 30 min");
  await expect(page.locator(".today-summaries")).toContainText(
    "partial / unknown",
  );
  await page.screenshot({
    path: info.outputPath("today-mobile.png"),
    fullPage: true,
  });
  for (const screen of ["Today", "Week"]) {
    await page.getByRole("button", { name: screen, exact: true }).click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const report = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        report.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.failureSummary),
        })),
      ).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".week-stats")).toContainText("No complete days");
  await page.screenshot({
    path: info.outputPath("week-mobile.png"),
    fullPage: true,
  });
  await page
    .getByText("See the records behind this review", { exact: true })
    .click();
  await page.locator(".week-evidence-row").filter({ hasText: today() }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Rice bowl");
  await expect(dialog).toContainText("7 h 30 min");
});

test("approved memories persist through preference changes and can be edited or removed", async ({
  page,
  context,
}, info) => {
  const state = example();
  const current = await seed(context, state);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await page
    .getByRole("button", { name: "Coach options", exact: true })
    .click();
  await page
    .getByRole("button", { name: /What Coach remembers & agreed plans/ })
    .click();
  await page.getByRole("button", { name: "Add a memory", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Remember this", exact: true })
    .fill("I prefer vegetarian lunches.");
  expect(current().profile.coaching?.memories).toBeUndefined();
  await page.getByRole("button", { name: "Approve and save memory" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("I prefer vegetarian lunches.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("memories-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("button", { name: "Coach options", exact: true })
    .click();
  await page.getByLabel("How Coach helps").selectOption("on-request");
  await page.getByRole("button", { name: "Save coaching preferences" }).click();
  await expect
    .poll(() => current().profile.coaching?.initiative)
    .toBe("on-request");
  expect(current().profile.coaching?.memories?.[0].text).toBe(
    "I prefer vegetarian lunches.",
  );
  await page
    .getByRole("button", { name: /What Coach remembers & agreed plans/ })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Remember this", exact: true })
    .fill("Quick vegetarian lunches.");
  await page.getByRole("button", { name: "Approve and save memory" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Quick vegetarian lunches.",
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("No saved memories yet");
  await expect.poll(() => current().profile.coaching?.memories).toEqual([]);
});

test("favourite meal reuse is reviewed, preserves tags and reopens the day's completion flag", async ({
  page,
  context,
}) => {
  const state = example();
  const current = await seed(context, state);
  await page.goto("/#food");
  await page.getByRole("button", { name: "Mark day complete" }).click();
  await expect(
    page.getByRole("button", { name: "Mark as partial" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save as favourite", exact: true })
    .click();
  await page.locator(".food-favourites summary").click();
  await page.getByRole("button", { name: "Review & log" }).click();
  expect(current().nutrition.meals.length).toBe(1);
  await expect(
    page.getByRole("dialog").getByLabel("Meal name", { exact: true }),
  ).toHaveValue("Rice bowl");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save meal", exact: true })
    .click();
  await expect.poll(() => current().nutrition.meals.length).toBe(2);
  expect(current().nutrition.completeDays).toEqual([]);
  expect(
    current().nutrition.meals[1].items[0].classification?.ingredients,
  ).toEqual([{ name: "rice", evidence: "reported" }]);
  await expect(
    page.getByRole("button", { name: "Mark day complete" }),
  ).toBeVisible();
});

test("one bundle reviews and saves all entries, then undoes them together", async ({
  page,
  context,
}, info) => {
  const state = emptyJournal();
  await seed(context, state);
  const prepared = prepareAction(
    state,
    {
      kind: "record_bundle",
      entries: [
        { kind: "record_checkin", checkin: { date: today(), sleepHours: 7.5 } },
        {
          kind: "record_cardio",
          cardio: { date: today(), activity: "running", durationSeconds: 1800 },
        },
      ],
    },
    today(),
  );
  const proposal = {
    id: crypto.randomUUID(),
    title: prepared.title,
    detail: prepared.detail,
    entries: prepared.entries,
    workout: null,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  await context.route("**/api/agent", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        provider: "Test provider",
        turns: [
          {
            id: crypto.randomUUID(),
            question: "I slept 7.5 hours and ran for 30 minutes. Log both.",
            reply: "Ready for your review.",
            status: "done",
            proposals: [proposal],
          },
        ],
      },
    }),
  );
  await context.route("**/api/agent/action", (r) =>
    r.fulfill({
      json: {
        accountId: browserUser.id,
        state: r.request().postDataJSON().undo ? state : prepared.state,
        revision: r.request().postDataJSON().undo ? 3 : 2,
        status: r.request().postDataJSON().undo ? "undone" : "saved",
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Review (1)", exact: true }).click();
  const card = page.getByRole("region", { name: "Review journal change" });
  await expect(card.locator(".coach-bundle-entry")).toHaveCount(2);
  await card.locator(".coach-bundle-entry summary").first().click();
  await expect(card).toContainText("7 h 30 min");
  await page.screenshot({
    path: info.outputPath("bundle-mobile.png"),
    fullPage: true,
  });
  await card.getByRole("button", { name: "Save all 2 entries" }).click();
  await expect(card).toHaveClass(/saved/);
  await card.locator(".proposal-summary").click();
  await card.getByRole("button", { name: "Undo all entries" }).click();
  await expect(card).toHaveClass(/undone/);
});

test("an agreed plan follows up on visits and dismissal survives reload", async ({
  page,
  context,
}) => {
  const state = example();
  state.profile.coaching = {
    initiative: "gentle",
    focus: "",
    plans: [
      {
        id: crypto.randomUUID(),
        title: "Prepare lunch in the evening",
        notes: "One small experiment",
        followUpDate: offsetDate(today(), -1),
        status: "active",
        outcome: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  const current = await seed(context, state);
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".today-focus")).toContainText(
    "You agreed to try: Prepare lunch in the evening",
  );
  await page
    .locator(".today-plans")
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await expect(page.locator(".today-plans")).toContainText(
    "No plan agreed yet",
  );
  await expect
    .poll(() => current().profile.coaching!.plans![0].status)
    .toBe("dismissed");
  await page.reload();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".today-focus")).not.toContainText(
    "You agreed to try",
  );
});
