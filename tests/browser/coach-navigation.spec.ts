import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { emptyJournal, today } from "../../lib/domain";
import {
  streamingFixture,
  emit,
  startReply,
  type StreamWindow,
} from "./coach-stream";
import type { Page } from "@playwright/test";

const mobile = (page: Page) =>
  page.getByRole("navigation", { name: "Mobile navigation" });
const requestCount = (page: Page) =>
  page.evaluate(() => (window as unknown as StreamWindow).coachRequests.length);
const aborted = (page: Page) =>
  page.evaluate(() =>
    Boolean((window as unknown as StreamWindow).coachAborted),
  );
async function finish(page: Page, reply: string, proposals: unknown[] = []) {
  const runId = await page.evaluate(
    () => (window as unknown as StreamWindow).coachRequests.at(-1)!.body.runId,
  );
  await emit(page, [
    {
      type: "RUN_FINISHED",
      threadId: "coach",
      runId,
      result: { reply, proposals },
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
}

test("Coach finishes while navigating and editing Health, preserves review safety and returns to the latest reply", async ({
  page,
  context,
}, testInfo) => {
  await streamingFixture(page);
  let reads = 0,
    saves = 0,
    revision = 0,
    state = emptyJournal();
  await context.route("**/api/agent", (r) => {
    reads++;
    return r.fulfill({
      json: {
        enabled: true,
        protocol: "ag-ui",
        provider: "Test provider",
        turns: [],
      },
    });
  });
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await context.route("**/api/agent/action", (r) => {
    saves++;
    return r.fulfill({
      status: 409,
      json: { error: "Your journal changed. Ask Coach for a fresh proposal." },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Log seven hours of sleep for today");
  await composer.press("Enter");
  await expect.poll(() => requestCount(page)).toBe(1);
  await composer.fill("My next question is about lunch");
  for (const destination of ["Train", "Food", "Health"]) {
    await mobile(page)
      .getByRole("link", { name: destination, exact: true })
      .click();
    await expect(
      page.getByText("Coach is working…", { exact: true }),
    ).toBeVisible();
    await expect(composer).toHaveCount(0);
    expect(await aborted(page)).toBe(false);
  }
  await page
    .getByRole("button", { name: "Daily check-in", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Water today", { exact: true }).fill("500");
  await dialog
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => revision).toBe(1);
  const pageTop = await page.evaluate(() => window.scrollY);
  await emit(page, [
    ...startReply,
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "answer",
      delta: "Preparing your sleep entry.",
    },
    { type: "TEXT_MESSAGE_END", messageId: "answer" },
  ]);
  await finish(
    page,
    "Ready for your review. Check the sleep entry before saving.",
    [
      {
        id: "navigation-sleep-proposal",
        title: "Log your sleep",
        detail: "Updates sleep and preserves other check-in values.",
        workout: null,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        checkin: {
          date: today(),
          sleepHours: 7,
          energy: null,
          soreness: null,
          waterMl: null,
          bodyweight: null,
          notes: "",
        },
      },
    ],
  );
  await expect(
    page.getByText("Your Coach reply is ready", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(pageTop);
  expect(await aborted(page)).toBe(false);
  expect(saves).toBe(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("coach-reply-ready.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Open Coach", exact: true }).click();
  await expect(composer).toHaveValue("My next question is about lunch");
  await expect(page.locator(".assistant-response").last()).toContainText(
    "Ready for your review",
  );
  await expect(page.locator(".chat-user").last()).toBeInViewport();
  await expect(composer).toBeInViewport();
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Save this change" }).click();
  await expect(page.locator(".agent-page").getByRole("alert")).toContainText(
    "Ask Coach for a fresh proposal",
  );
  expect(state.health.checkins[0].waterMl).toBe(500);
  expect(state.health.checkins[0].sleepHours).toBeNull();
  expect(revision).toBe(1);
  expect(saves).toBe(1);
  expect(reads).toBe(1);
  expect(await requestCount(page)).toBe(1);
});

test("Photo and sleep entry links preserve a running turn and the next draft; leaving options closes its portal", async ({
  page,
  context,
}) => {
  await streamingFixture(page);
  await context.route("**/api/agent", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        protocol: "ag-ui",
        provider: "Test provider",
        turns: [],
      },
    }),
  );
  const imageIds = [crypto.randomUUID(), crypto.randomUUID()];
  const pixels = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "#c8b9e9" },
  })
    .jpeg()
    .toBuffer();
  await context.route("**/api/images/*", (r) => {
    const url = new URL(r.request().url()),
      id = url.pathname.split("/").at(-1)!;
    expect(imageIds).toContain(id);
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    return url.searchParams.has("metadata")
      ? r.fulfill({
          json: {
            id,
            label: "Test photo",
            date: today(),
            category: "food",
            version: 1,
            bytes: pixels.length,
            createdAt: new Date().toISOString(),
            classification: {
              status: "ready",
              confidence: "high",
              source: "automatic",
              tags: ["food"],
            },
          },
        })
      : r.fulfill({ body: pixels, contentType: "image/jpeg" });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#coach/photo/${imageIds[0]}`);
  const composer = page.getByLabel("Message your coach");
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toHaveCount(1);
  await composer.fill("Log this breakfast");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await composer.press("Enter");
  await expect.poll(() => requestCount(page)).toBe(1);
  await composer.fill("Keep this next draft");
  await page.getByRole("button", { name: "Coach options" }).click();
  await page
    .getByRole("button", { name: "Health history", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Log sleep with Coach" }).click();
  await expect(composer).toHaveValue(/^Keep this next draft\n\n/);
  await expect(composer).toHaveValue(/sleep/);
  await mobile(page).getByRole("link", { name: "Food", exact: true }).click();
  // Simulate the catalog's exact in-site photo link, with no document reload.
  await page.evaluate((id) => {
    location.hash = `coach/photo/${id}`;
  }, imageIds[1]);
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toHaveCount(1);
  const nextDraft = await composer.inputValue();
  await mobile(page).getByRole("link", { name: "Train", exact: true }).click();
  await emit(page, [
    { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
  ]);
  await finish(page, "Your breakfast proposal is ready.");
  await page.getByRole("link", { name: "Open Coach", exact: true }).click();
  await expect(composer).toHaveValue(nextDraft);
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await aborted(page)).toBe(false);
  await composer.press("Enter");
  await expect.poll(() => requestCount(page)).toBe(2);
  const photos = await page.evaluate(() =>
    (window as unknown as StreamWindow).coachRequests.map(
      (r) => r.body.forwardedProps.photoIds,
    ),
  );
  expect(photos).toEqual([[imageIds[0]], [imageIds[1]]]);
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(
    page.getByRole("region", { name: "Message queue" }),
  ).toContainText(nextDraft);
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toHaveCount(0);
});

for (const action of ["sign-out", "account-switch"] as const) {
  test(`A background Coach run is cancelled on ${action} and cannot leak into another account`, async ({
    page,
    context,
  }) => {
    await streamingFixture(page);
    let currentUser: typeof browserUser | null = browserUser;
    await context.route("**/api/session", (r) =>
      r.fulfill({
        json: { user: currentUser, google: true, configured: true },
      }),
    );
    await context.route("**/api/journal", (r) =>
      r.fulfill({
        json: {
          accountId: currentUser?.id,
          state: emptyJournal(),
          revision: 0,
        },
      }),
    );
    await context.route("**/api/agent", (r) =>
      r.fulfill({
        json: {
          enabled: true,
          protocol: "ag-ui",
          provider: "Test provider",
          turns: [],
        },
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#coach");
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    const composer = page.getByLabel("Message your coach");
    await composer.fill("Private question from account A");
    await composer.press("Enter");
    await expect.poll(() => requestCount(page)).toBe(1);
    await mobile(page).getByRole("link", { name: "Food", exact: true }).click();
    expect(await aborted(page)).toBe(false);
    currentUser =
      action === "sign-out"
        ? null
        : {
            id: "navigation-account-b",
            name: "Second synthetic athlete",
            email: "second@example.test",
          };
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect.poll(() => aborted(page)).toBe(true);
    await expect(page.locator(".coach-background-status")).toHaveCount(0);
    await expect(
      page.getByText("Private question from account A", { exact: true }),
    ).toHaveCount(0);
    if (action === "sign-out") {
      await expect(
        page.getByRole("button", { name: "Continue with Google" }),
      ).toBeVisible();
    } else {
      await mobile(page)
        .getByRole("link", { name: "Coach", exact: true })
        .click();
      await expect(composer).toHaveValue("");
      await expect(page.locator(".conversation-turn")).toHaveCount(0);
    }
  });
}

test("Legacy Coach requests also finish away from chat, and interrupted replies remain recoverable", async ({
  page,
  context,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await context.route("**/api/agent", async (r) => {
    if (r.request().method() !== "POST")
      return r.fulfill({
        json: { enabled: true, provider: "Test provider", turns: [] },
      });
    requests++;
    await waiting;
    await r.fulfill({
      status: 503,
      json: {
        error: "The provider is temporarily unavailable. Please try again.",
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Help with my week");
  await composer.press("Enter");
  await expect.poll(() => requests).toBe(1);
  await mobile(page).getByRole("link", { name: "Food", exact: true }).click();
  await expect(
    page.getByText("Coach is working…", { exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("Coach needs your attention", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open Coach", exact: true }).click();
  await expect(composer).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await expect(page.locator(".agent-page").getByRole("alert")).toContainText(
    "provider is temporarily unavailable",
  );
  expect(requests).toBe(1);
});
