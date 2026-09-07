import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today } from "../../lib/domain";
import { saveCheckin } from "../../lib/health";

test("one grounded opening stays optional, preserves drafts, and hides for today per account", async ({
  page,
  context,
}, testInfo) => {
  let account = "coaching-a",
    requests = 0;
  const state = emptyJournal();
  saveCheckin(state, { date: today(), energy: 2 }, today());
  await context.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: {
          id: account,
          name: "Synthetic coach test",
          email: "coach@example.test",
        },
        configured: true,
        google: true,
      },
    }),
  );
  await context.route("**/api/journal", (r) =>
    r.fulfill({ json: { accountId: account, state, revision: 1 } }),
  );
  await context.route("**/api/agent", (r) => {
    if (r.request().method() !== "GET") requests++;
    return r.fulfill({
      json: {
        enabled: true,
        provider: "Test provider",
        turns:
          account === "coaching-b"
            ? [
                {
                  id: "existing-turn",
                  question: "How can I keep this manageable?",
                  reply: "We can take it one step at a time.",
                  status: "done",
                },
              ]
            : [],
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  const opening = page.getByRole("complementary", {
    name: "A thought from Coach",
  });
  await expect(opening).toContainText("You logged energy at 2/5 today.");
  const composer = page.getByLabel("Message your coach");
  await expect(composer).toBeInViewport();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("coach-opening-mobile.png"),
    fullPage: true,
  });
  expect(requests).toBe(0);
  await composer.fill("My evening is already busy.");
  await opening.getByRole("button", { name: "Talk it through" }).click();
  await expect(composer).toHaveValue(
    /^My evening is already busy\.\n\nWhat would you suggest/,
  );
  expect(requests).toBe(0);
  await opening.getByRole("button", { name: "Hide for today" }).click();
  await expect(opening).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await expect(opening).toHaveCount(0);
  account = "coaching-b";
  await page.reload();
  await expect(opening).toContainText("energy at 2/5 today");
  await expect(
    opening.getByRole("button", { name: /There’s room to adjust/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".chat-user").last()).toBeInViewport();
  await opening.getByRole("button", { name: /There’s room to adjust/ }).click();
  await expect(
    opening.getByRole("button", { name: "Talk it through" }),
  ).toBeInViewport();
  await expect(composer).toBeInViewport();
  await expect(page.locator(".chat-user").last()).toBeInViewport();
  expect(requests).toBe(0);
});

test("saved focus and initiative sync with the private journal and survive reopening", async ({
  page,
  context,
}, testInfo) => {
  let state = emptyJournal(),
    revision = 1;
  const account = "coaching-preferences",
    updates: string[] = [];
  await context.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: {
          id: account,
          name: "Synthetic coach test",
          email: "preferences@example.test",
        },
        configured: true,
        google: true,
      },
    }),
  );
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      expect(r.request().headers()["x-journal-account"]).toBe(account);
      state = r.request().postDataJSON().state;
      revision++;
      updates.push(state.profile.coaching!.focus);
    }
    return r.fulfill({ json: { accountId: account, state, revision } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Coach options", exact: true })
    .click();
  const focus = page.getByLabel("What matters to you right now?");
  await focus.fill("Have energy for family life, with relaxed evenings.");
  await page.getByLabel("How Coach helps").selectOption("on-request");
  await page.getByRole("button", { name: "Save coaching preferences" }).click();
  await expect.poll(() => updates.length).toBe(1);
  await expect(page.getByRole("status")).toContainText(
    "Coaching preferences saved",
  );
  await page.screenshot({
    path: testInfo.outputPath("coaching-preferences-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "A thought from Coach" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "A thought from Coach" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Coach options", exact: true })
    .click();
  await expect(focus).toHaveValue(
    "Have energy for family life, with relaxed evenings.",
  );
  await expect(page.getByLabel("How Coach helps")).toHaveValue("on-request");
  await focus.fill("");
  await page.getByLabel("How Coach helps").selectOption("gentle");
  await page.getByRole("button", { name: "Save coaching preferences" }).click();
  await expect.poll(() => updates.length).toBe(2);
  expect(state.profile.coaching).toEqual({ initiative: "gentle", focus: "" });
  expect(state.health.checkins).toEqual([]);
  expect(state.sessions).toEqual([]);
});
