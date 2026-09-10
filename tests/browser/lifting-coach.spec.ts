import { test, expect, browserUser } from "./fixtures";
import type { BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today } from "../../lib/domain";
import type { JournalState } from "../../lib/model";
import { liftingFixture, liftingBrief } from "../fixtures/lifting-coach";
import { prepareAction } from "../../lib/agent/actions";
import { liftingPrompt } from "../../lib/lifting-coach";
import { streamingFixture, type StreamWindow } from "./coach-stream";

async function fixture(context: BrowserContext, initial: JournalState) {
  let state = initial,
    revision = 1;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  return () => state;
}

test("a private lifting brief can be saved, revisited and cleared without changing training", async ({
  page,
  context,
}) => {
  const initial = emptyJournal(),
    current = await fixture(context, initial);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#workout/choose");
  await page
    .getByRole("navigation", { name: "Training navigation" })
    .getByRole("link", { name: "Lifting coach", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A clear focus. A plan that fits." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Lifting coach", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/No completed training recorded/)).toBeVisible();
  await page.getByRole("button", { name: "Add your brief" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Your lifting goal", { exact: true })
    .fill(liftingBrief.goal);
  await dialog.getByLabel("Days per week", { exact: true }).fill("3");
  await dialog.getByLabel("Minutes per session", { exact: true }).fill("60");
  await dialog
    .getByLabel("Schedule & constraints", { exact: true })
    .fill("Travel on Fridays");
  await dialog
    .getByRole("button", { name: "Save lifting brief", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => current().profile.lifting?.goal)
    .toBe(liftingBrief.goal);
  expect(current().profile.lifting?.experience).toBe("unknown");
  expect(current().sessions).toEqual([]);
  expect(current().activeWorkout).toBeNull();
  await page.reload();
  await expect(page.locator(".lifting-goal")).toHaveText(liftingBrief.goal);
  await page.getByRole("button", { name: "Edit brief", exact: true }).click();
  await expect(
    dialog.getByLabel("Schedule & constraints", { exact: true }),
  ).toHaveValue("Travel on Fridays");
  await dialog.getByText("Clear saved brief", { exact: true }).click();
  await dialog
    .getByRole("button", { name: "Clear lifting brief", exact: true })
    .click();
  await expect.poll(() => current().profile.lifting).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add your brief" }),
  ).toBeVisible();
});

test("lifting evidence distinguishes unknown data, ongoing training and source sessions on mobile and desktop", async ({
  page,
  context,
}, info) => {
  await fixture(context, liftingFixture(today()));
  await page.goto("/#workout/coaching");
  await expect(
    page.getByText("1 recorded session · 3 logged sets", { exact: true }),
  ).toBeVisible();
  const table = page.getByRole("region", { name: "Weekly training evidence" });
  await expect(table).toContainText("7/10 · 2 sets");
  await expect(table).toContainText("7.5 h · 1 night");
  await expect(table).toContainText("Not reported");
  await expect(page.locator(".lifting-active")).toContainText(
    "Next lifting session",
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `no page overflow at ${width}`).toBe(false);
    await expect(
      page.getByRole("button", { name: "Build my plan" }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("lifting-coach-mobile.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByText("Recorded lifts & set outcomes", { exact: true })
    .click();
  await expect(page.locator(".lifting-records")).toContainText(
    "1 made · 1 missed · 1 without an outcome",
  );
  await expect(page.locator(".lifting-records")).toContainText("45 kg × 2");
  await page.locator(".lifting-records a").click();
  await expect(
    page.getByRole("heading", { name: "Training history", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".history-content")).toContainText(
    "The second set felt steadier.",
  );
  await expect(page.locator(".history-content")).toBeVisible();
});

test("lifting starters preserve a written draft and don't submit or disturb an active Coach run", async ({
  page,
  context,
}) => {
  await fixture(context, liftingFixture(today()));
  await streamingFixture(page);
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const input = page.getByLabel("Message your coach");
  await input.fill("Review my lifting today");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as StreamWindow).coachRequests.length,
      ),
    )
    .toBe(1);
  await input.fill("I have 45 minutes on Thursday.");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Train", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Training navigation" })
    .getByRole("link", { name: "Lifting coach", exact: true })
    .click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(input).toHaveValue(
    `I have 45 minutes on Thursday.\n\n${liftingPrompt("plan")}`,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as StreamWindow).coachRequests.length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      Boolean((window as unknown as StreamWindow).coachAborted),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const state = window as unknown as StreamWindow;
    state.coachEvents({
      type: "STEP_FINISHED",
      stepName: "Checking your sleep and recovery",
    });
    state.coachEvents({
      type: "RUN_FINISHED",
      threadId: "coach",
      runId: state.coachRequests[0].body.runId,
      result: { reply: "We can review one priority.", proposals: [] },
    });
    state.closeCoachStream();
  });
  await expect(
    page.getByText("We can review one priority.", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue(
    `I have 45 minutes on Thursday.\n\n${liftingPrompt("plan")}`,
  );
});

test("Coach brief reviews show every field and save with reversible account-scoped changes", async ({
  page,
  context,
}) => {
  const initial = emptyJournal(),
    prepared = prepareAction(
      initial,
      { kind: "set_lifting_brief", liftingBrief },
      today(),
    );
  let state = initial,
    revision = 1;
  const proposal = {
    id: crypto.randomUUID(),
    title: prepared.title,
    detail: prepared.detail,
    workout: null,
    liftingBrief: prepared.liftingBrief,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  await context.route("**/api/journal", (r) =>
    r.fulfill({ json: { accountId: browserUser.id, state, revision } }),
  );
  await context.route("**/api/agent", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        provider: "Synthetic provider",
        turns: [
          {
            id: crypto.randomUUID(),
            question: "Remember my lifting goals",
            reply: "Ready for your review.",
            status: "done",
            proposals: [proposal],
          },
        ],
      },
    }),
  );
  await context.route("**/api/agent/action", (r) => {
    expect(r.request().headers()["x-lifting-coach-version"]).toBe("1");
    const undo = r.request().postDataJSON().undo;
    state = structuredClone(undo ? initial : prepared.state);
    revision++;
    return r.fulfill({
      json: {
        accountId: browserUser.id,
        state,
        revision,
        status: undo ? "undone" : "saved",
      },
    });
  });
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Review (1)", exact: true }).click();
  const card = page.getByRole("region", { name: "Review journal change" });
  for (const text of [
    liftingBrief.goal,
    liftingBrief.why,
    liftingBrief.equipment,
    liftingBrief.constraints,
    liftingBrief.priority,
    "3 days/week · 60 minutes/session",
    "2026-12-01",
  ])
    await expect(card).toContainText(text);
  expect(state.profile.lifting).toBeUndefined();
  await card
    .getByRole("button", { name: "Save this change", exact: true })
    .click();
  await expect(card).toHaveClass(/saved/);
  await card.locator(".proposal-summary").click();
  await card
    .getByRole("button", { name: "Undo this change", exact: true })
    .click();
  await expect.poll(() => state.profile.lifting).toBeUndefined();
  await expect(card).toHaveClass(/undone/);
  await card.locator(".proposal-summary").click();
  await card
    .getByRole("button", { name: "Open lifting coach", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add your brief" }),
  ).toBeVisible();
});

test("manual Undo clears a newly saved brief after sync instead of resurrecting it as an omitted legacy field", async ({
  page,
  context,
}) => {
  let state = emptyJournal(),
    revision = 1;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      const next = r.request().postDataJSON().state as JournalState;
      // Match the server's compatibility rule: omission preserves; null clears.
      if (next.profile.lifting === undefined)
        next.profile.lifting = state.profile.lifting;
      state = next;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.goto("/#workout/coaching");
  await expect(
    page.getByRole("button", { name: "All changes synced", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add your brief", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Your lifting goal", { exact: true })
    .fill("Enjoy learning the lifts");
  await page
    .getByRole("button", { name: "Save lifting brief", exact: true })
    .click();
  await expect
    .poll(() => state.profile.lifting?.goal)
    .toBe("Enjoy learning the lifts");
  await expect(
    page.getByRole("button", { name: "All changes synced", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect.poll(() => state.profile.lifting).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add your brief", exact: true }),
  ).toBeVisible();
});
