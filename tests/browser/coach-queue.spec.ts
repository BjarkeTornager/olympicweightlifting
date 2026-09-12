import { test, expect, browserUser } from "./fixtures";
import { emptyJournal } from "../../lib/domain";
import { streamingFixture, type StreamWindow } from "./coach-stream";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const requests = (page: Page) =>
  page.evaluate(() => (window as unknown as StreamWindow).coachRequests);
async function finish(page: Page, reply: string, saved = false) {
  await page.evaluate(
    ({ reply, saved }) => {
      const state = window as unknown as StreamWindow;
      const runId = state.coachRequests.at(-1)!.body.runId;
      // Close this stream in the same task, before the queue opens another one.
      state.coachEvents({
        type: "STEP_FINISHED",
        stepName: "Checking your sleep and recovery",
      });
      state.coachEvents({
        type: "RUN_FINISHED",
        threadId: "coach",
        runId,
        result: {
          reply,
          proposals: saved
            ? [
                {
                  id: crypto.randomUUID(),
                  title: "Saved sleep",
                  detail: "7 hours",
                  status: "saved",
                  automatic: true,
                  expiresAt: new Date(Date.now() + 86400000).toISOString(),
                  workout: null,
                },
              ]
            : [],
        },
      });
      state.closeCoachStream();
    },
    { reply, saved },
  );
}
async function open(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
}
async function send(page: Page, text: string) {
  const input = page.getByLabel("Message your coach");
  await input.fill(text);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

test.beforeEach(async ({ page, context }) => {
  await streamingFixture(page);
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
});

test("rapid messages run FIFO after fresh sync, preserve focus, and continue away from chat", async ({
  page,
  context,
}, testInfo) => {
  let revision = 0,
    held = false,
    hold = false;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/api/journal", async (r) => {
    if (hold) {
      held = true;
      await waiting;
    }
    await r.fulfill({
      json: { accountId: browserUser.id, state: emptyJournal(), revision },
    });
  });
  await open(page);
  await send(page, "I slept seven hours");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await expect(page.getByLabel("Message your coach")).toBeFocused();
  await send(page, "I also ran five kilometres");
  await send(page, "How should I recover?");
  const queue = page.getByRole("region", { name: "Message queue" });
  await expect(queue).toContainText("2 queued");
  await queue.locator("summary").click();
  await expect(queue.locator("li")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  expect((await requests(page)).length).toBe(1);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("coach-message-queue.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Food", exact: true })
    .click();
  await expect(
    page.getByText("Coach is working… 2 queued", { exact: true }),
  ).toBeVisible();
  revision = 1;
  hold = true;
  await finish(page, "Saved your sleep.", true);
  await expect.poll(() => held).toBe(true);
  expect((await requests(page)).length).toBe(1);
  hold = false;
  release();
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].body.forwardedProps.revision).toBe(1);
  await finish(page, "Saved your run.");
  await expect.poll(async () => (await requests(page)).length).toBe(3);
  await finish(page, "Take it easy today.");
  expect((await requests(page)).map((r) => r.body.messages[0].content)).toEqual(
    [
      "I slept seven hours",
      "I also ran five kilometres",
      "How should I recover?",
    ],
  );
  await page.getByRole("link", { name: "Open Coach", exact: true }).click();
  await expect(queue).toHaveCount(0);
  await expect(page.locator(".chat-user").last()).toBeInViewport();
  await expect(page.getByLabel("Message your coach")).toBeInViewport();
});

test("Stop pauses dependents; retry uses the same ID and keeps a new draft separate", async ({
  page,
}) => {
  await open(page);
  await send(page, "Log my coffee");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await send(page, "Then summarise my breakfast");
  await page.getByLabel("Message your coach").fill("A draft for later");
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Message your coach")).toHaveValue(
    "A draft for later",
  );
  expect((await requests(page)).length).toBe(1);
  await send(page, "And compare it with yesterday");
  expect((await requests(page)).length).toBe(1);
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].body.runId).toBe(
    (await requests(page))[0].body.runId,
  );
  await finish(page, "Coffee saved.");
  await expect.poll(async () => (await requests(page)).length).toBe(3);
  expect((await requests(page))[2].body.messages[0].content).toBe(
    "Then summarise my breakfast",
  );
  await finish(page, "Breakfast summary.");
  await expect.poll(async () => (await requests(page)).length).toBe(4);
  await finish(page, "Yesterday's comparison.");
  await expect(
    page.locator(".chat-user").filter({ hasText: "Log my coffee" }),
  ).toHaveCount(1);
});

test("queued messages can be removed and skipping a failed message resumes the next", async ({
  page,
}) => {
  await open(page);
  await send(page, "First message");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await send(page, "Remove this message");
  await send(page, "Keep this message");
  const queue = page.getByRole("region", { name: "Message queue" });
  await queue.locator("summary").click();
  await queue
    .getByRole("button", { name: "Remove queued message 1", exact: true })
    .click();
  await expect(queue).toContainText("1 queued");
  await page.getByRole("button", { name: "Stop response" }).click();
  await page.getByRole("button", { name: "Skip and continue" }).click();
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].body.messages[0].content).toBe(
    "Keep this message",
  );
  await finish(page, "Done.");
});

test("an account switch discards queued work and cancels the old active request", async ({
  page,
  context,
}) => {
  let switched = false;
  await context.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: switched
          ? { ...browserUser, id: "queue-account-b" }
          : browserUser,
        google: true,
        configured: true,
      },
    }),
  );
  await context.route("**/api/journal", (r) =>
    r.fulfill({
      json: {
        accountId: switched ? "queue-account-b" : browserUser.id,
        state: emptyJournal(),
        revision: 0,
      },
    }),
  );
  await open(page);
  await send(page, "Private first request");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await send(page, "Private queued request");
  switched = true;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as StreamWindow).coachAborted),
    )
    .toBe(true);
  await expect(page.getByRole("region", { name: "Message queue" })).toHaveCount(
    0,
  );
  await expect(page.locator(".conversation-turn")).toHaveCount(0);
  await send(page, "New account request");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].account).toBe("queue-account-b");
  await finish(page, "New account reply.");
});

test("each queued message owns its photos, and completing one cannot clear the next draft", async ({
  page,
  context,
}) => {
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  // Source images are synthetic; metadata and bytes are always account-scoped.
  const sharp = (await import("sharp")).default;
  const pixels = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#cab9d8" },
  })
    .jpeg()
    .toBuffer();
  await context.route("**/api/images/*", (r) => {
    const url = new URL(r.request().url());
    const id = url.pathname.split("/").at(-1)!;
    expect(ids).toContain(id);
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    return url.searchParams.has("metadata")
      ? r.fulfill({
          json: {
            id,
            label: "Synthetic breakfast",
            category: "food",
            date: "2026-09-09",
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
  await open(page);
  await send(page, "Check my journal");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await page.getByRole("button", { name: "Add images" }).click();
  await expect(page.getByLabel("Attach image", { exact: true })).toBeEnabled();
  await page.evaluate((id) => {
    location.hash = `coach/photo/${id}`;
  }, ids[0]);
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toHaveCount(1);
  await send(page, "Log this breakfast");
  await page.evaluate((id) => {
    location.hash = `coach/photo/${id}`;
  }, ids[1]);
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toHaveCount(1);
  await send(page, "Log this lunch");
  await page.getByLabel("Message your coach").fill("Keep this unsent draft");
  await finish(page, "Journal checked.");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].body.forwardedProps.photoIds).toEqual([
    ids[0],
  ]);
  await finish(page, "Breakfast saved.");
  await expect.poll(async () => (await requests(page)).length).toBe(3);
  expect((await requests(page))[2].body.forwardedProps.photoIds).toEqual([
    ids[1],
  ]);
  await finish(page, "Lunch saved.");
  await expect(page.getByLabel("Message your coach")).toHaveValue(
    "Keep this unsent draft",
  );
});

test("a committed reply recovered after a dropped stream releases the queue with the fresh revision", async ({
  page,
  context,
}) => {
  let committed = false;
  await context.route("**/api/journal", (r) =>
    r.fulfill({
      json: {
        accountId: browserUser.id,
        state: emptyJournal(),
        revision: committed ? 1 : 0,
      },
    }),
  );
  await context.route("**/api/agent?turnId=*", (r) =>
    r.fulfill({
      json: {
        turn: {
          id: new URL(r.request().url()).searchParams.get("turnId"),
          question: "Log seven hours of sleep",
          reply: "Sleep saved.",
          status: "done",
          proposals: [],
        },
      },
    }),
  );
  await open(page);
  await send(page, "Log seven hours of sleep");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await send(page, "Summarise my recovery");
  committed = true;
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].body.forwardedProps.revision).toBe(1);
  await finish(page, "Recovery summary.");
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
});

test("a provider rate limit pauses the queue without dropping or automatically replaying requests", async ({
  page,
  context,
}) => {
  // Switch to the JSON compatibility transport to exercise an actual HTTP 429.
  let posts = 0;
  const sent: { id: string; message: string }[] = [];
  await context.route("**/api/agent", (r) => {
    if (r.request().method() !== "POST")
      return r.fulfill({ json: { enabled: true, turns: [] } });
    posts++;
    sent.push(r.request().postDataJSON());
    return posts === 1
      ? r.fulfill({
          status: 429,
          json: { error: "Please wait a minute before trying again." },
        })
      : r.fulfill({ json: { reply: "Reply completed.", proposals: [] } });
  });
  await open(page);
  await send(page, "Rate limited question");
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeEnabled();
  await send(page, "Follow-up question");
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect.poll(() => posts).toBe(3);
  expect(sent[1].id).toBe(sent[0].id);
  expect(sent[2].message).toBe("Follow-up question");
});
