import { test, expect, browserUser } from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
import { streamingFixture, emit, type StreamWindow } from "./coach-stream";
import type { ActionPreview } from "../../lib/agent/actions";
import type { Page } from "@playwright/test";

const requests = (page: Page) =>
  page.evaluate(() => (window as unknown as StreamWindow).coachRequests);
async function finish(page: Page, proposals: ActionPreview[]) {
  const id = (await requests(page)).at(-1)!.body.runId;
  await emit(page, [
    { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
    {
      type: "RUN_FINISHED",
      threadId: "coach",
      runId: id,
      result: { reply: "Saved to your journal.", proposals },
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
}
function receipt(): ActionPreview {
  return {
    id: crypto.randomUUID(),
    title: "Log your sleep",
    detail: "7 h 30 min of sleep. Other check-in values kept.",
    workout: null,
    checkin: {
      date: today(),
      sleepHours: 7.5,
      energy: null,
      soreness: null,
      waterMl: null,
      bodyweight: null,
      notes: "",
      updatedAt: new Date().toISOString(),
    },
    status: "saved",
    automatic: true,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}

test("reported sleep saves during navigation, syncs the journal, and exposes Undo without a Save click", async ({
  page,
  context,
}) => {
  await streamingFixture(page);
  let state = emptyJournal(),
    revision = 0,
    saves = 0;
  const entry = receipt();
  let holdNext = false,
    held = false;
  let releaseRead!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await context.route("**/api/journal", async (r) => {
    const snapshot = structuredClone({
      accountId: browserUser.id,
      state,
      revision,
    });
    if (holdNext) {
      holdNext = false;
      held = true;
      await waiting;
    }
    return r.fulfill({ json: snapshot });
  });
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
  await context.route("**/api/agent/action", (r) => {
    expect(r.request().postDataJSON()).toEqual({ id: entry.id, undo: true });
    saves++;
    state = emptyJournal();
    revision++;
    return r.fulfill({
      json: { accountId: browserUser.id, state, revision, status: "undone" },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  const composer = page.getByLabel("Message your coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await composer.fill("I slept 7.5 hours last night");
  await composer.press("Enter");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  await nav.getByRole("link", { name: "Food", exact: true }).click();
  holdNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => held).toBe(true);
  state.health.checkins = [entry.checkin!];
  revision = 1;
  await finish(page, [entry]);
  await page.getByRole("link", { name: "Open Coach", exact: true }).click();
  const saved = page.getByRole("region", { name: "Saved journal entry" });
  await expect(saved).toBeVisible();
  // The in-flight pre-save snapshot cannot become the next message's revision.
  await expect(
    saved.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  releaseRead();
  await expect(
    saved.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await expect(
    saved.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save this change" }),
  ).toHaveCount(0);
  expect(saves).toBe(0);
  await composer.fill("How does that compare with my week?");
  await composer.press("Enter");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].body.forwardedProps.revision).toBe(1);
  await finish(page, []);
  await saved.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByText("Change undone and saved to your account.", { exact: true }),
  ).toBeVisible();
  expect(saves).toBe(1);
  expect(revision).toBe(2);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("a stream lost after commit recovers the saved receipt and keeps the next draft", async ({
  page,
  context,
}) => {
  await streamingFixture(page);
  const entry = receipt();
  const state = emptyJournal();
  state.health.checkins = [entry.checkin!];
  let committed = false,
    recoveryReads = 0;
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
  await context.route("**/api/journal", (r) =>
    r.fulfill({
      json: {
        accountId: browserUser.id,
        state: committed ? state : emptyJournal(),
        revision: committed ? 1 : 0,
      },
    }),
  );
  await context.route("**/api/agent?turnId=*", (r) => {
    recoveryReads++;
    return r.fulfill({
      json: {
        turn: {
          id: new URL(r.request().url()).searchParams.get("turnId"),
          question: "Log my sleep",
          reply: "Saved your sleep.",
          proposals: [entry],
          status: "done",
        },
      },
    });
  });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Log my sleep");
  await composer.press("Enter");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await composer.fill("What about today's training?");
  committed = true;
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect(
    page.getByText("Saved your sleep.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveValue("What about today's training?");
  expect(recoveryReads).toBe(1);
  expect((await requests(page)).length).toBe(1);
});

test("an unknown save result retries with the same run ID instead of risking a duplicate", async ({
  page,
  context,
}) => {
  await streamingFixture(page);
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
  await context.route("**/api/agent?turnId=*", (r) =>
    r.fulfill({ status: 503, json: { error: "Offline" } }),
  );
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("I slept 7.5 hours last night");
  await composer.press("Enter");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect(composer).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Retry message", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Retry message", exact: true })
    .click();
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  const sent = await requests(page);
  expect(sent[1].body.runId).toBe(sent[0].body.runId);
  await finish(page, [receipt()]);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".chat-user")
      .filter({ hasText: "I slept 7.5 hours last night" }),
  ).toHaveCount(1);
});
