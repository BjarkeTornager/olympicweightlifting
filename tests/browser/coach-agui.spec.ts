import { test, expect, browserUser } from "./fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { CoachResponse, SavedVisual } from "../../lib/coach-visuals";

type StreamWindow = Window & {
  coachEvents: (event: Record<string, unknown>) => void;
  closeCoachStream: () => void;
  coachRequests: {
    body: { runId: string; messages: { content: string }[] };
    account: string | null;
    cache?: RequestCache;
  }[];
  coachAborted: boolean;
};

// A controllable network stream using the real browser fetch/ReadableStream
// boundary and shipped AG-UI client. No provider or production records are used.
async function streamingFixture(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as StreamWindow;
    const original = window.fetch.bind(window);
    state.coachRequests = [];
    window.fetch = async (input, init) => {
      if (new URL(String(input), location.href).pathname !== "/api/agent/run")
        return original(input, init);
      const body = JSON.parse(String(init?.body));
      state.coachRequests.push({
        body,
        account: new Headers(init?.headers).get("X-Journal-Account"),
        cache: init?.cache,
      });
      const encoder = new TextEncoder();
      let ended = false;
      return new Response(
        new ReadableStream({
          start(controller) {
            state.coachEvents = (event) => {
              if (!ended)
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                );
            };
            state.closeCoachStream = () => {
              if (!ended) {
                ended = true;
                controller.close();
              }
            };
            init?.signal?.addEventListener("abort", () => {
              state.coachAborted = true;
              if (!ended) {
                ended = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              }
            });
            state.coachEvents({
              type: "RUN_STARTED",
              threadId: body.threadId,
              runId: body.runId,
            });
            state.coachEvents({
              type: "STEP_STARTED",
              stepName: "Checking your sleep and recovery",
            });
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "private, no-store",
          },
        },
      );
    };
  });
}
const emit = (page: Page, events: Record<string, unknown>[]) =>
  page.evaluate((events) => {
    for (const event of events)
      (window as unknown as StreamWindow).coachEvents(event);
  }, events);
const startReply = [
  { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
  { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
];
const visuals: SavedVisual[] = [
  {
    id: "b419d58a-9408-46a1-81b6-21b42a147599",
    content: {
      kind: "table",
      title: "Your week at a glance",
      caption: "Reported entries · 4–6 September. Missing days are left out.",
      columns: ["Day", "Sleep", "Energy", "Training"],
      rows: [
        ["Friday", "7 hours", "3 / 5", "Accessories"],
        ["Saturday", "8 hours", "4 / 5", "Rest"],
        ["Sunday", "7.5 hours", "3 / 5", "Not logged"],
      ],
    },
  },
  {
    id: "b419d58a-9408-46a1-81b6-21b42a147590",
    content: {
      kind: "bar_chart",
      title: "Your reported sleep",
      caption: "These are your logged hours, not a readiness score.",
      unit: "h",
      points: [
        { label: "Friday · 4 Sep", value: 7 },
        { label: "Saturday · 5 Sep", value: 8 },
        { label: "Sunday · 6 Sep", value: 7.5 },
      ],
    },
  },
  {
    id: "b419d58a-9408-46a1-81b6-21b42a147591",
    content: {
      kind: "diagram",
      title: "A simple check-in routine",
      caption: "Suggested routine, not a health assessment.",
      nodes: [
        { id: "notice", label: "Notice how you feel" },
        { id: "log", label: "Log sleep and energy" },
        { id: "review", label: "Review your plan" },
      ],
      edges: [
        { from: "notice", to: "log", label: "Each morning" },
        { from: "log", to: "review", label: "Then" },
      ],
    },
  },
];

test("AG-UI streams rich Coach responses on a phone, preserves reading position and restores private visuals", async ({
  page,
  context,
}, testInfo) => {
  await streamingFixture(page);
  const turns: ({
    id: string;
    question: string;
    status: string;
  } & CoachResponse)[] = Array.from({ length: 8 }, (_, i) => ({
    id: `older-${i}`,
    question: `Previous question ${i}`,
    reply: "An earlier response.\n\n".repeat(12),
    proposals: [],
    status: "done",
  }));
  await context.route("**/api/agent", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        protocol: "ag-ui",
        provider: "Test provider",
        turns,
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  const question =
    "Show my week in a table, a sleep chart and a simple check-in diagram";
  await composer.fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Checking your sleep and recovery", { exact: true }),
  ).toBeVisible();
  const request = await page.evaluate(
    () => (window as unknown as StreamWindow).coachRequests[0],
  );
  expect(request.account).toBe(browserUser.id);
  expect(request.cache).toBe("no-store");
  expect(request.body.messages).toHaveLength(1);
  expect(request.body.messages[0].content).toBe(question);
  await emit(page, [
    ...startReply,
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "answer",
      delta: "### Your week\nHere is your ",
    },
  ]);
  await expect(page.locator(".assistant-response").last()).toContainText(
    "Here is your",
  );
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  await emit(
    page,
    visuals.map((value) => ({ type: "CUSTOM", name: "coach.visual", value })),
  );
  await expect(page.locator(".coach-visual")).toHaveCount(3);
  await expect(composer).toBeInViewport();
  await expect(page.locator(".chat-user").last()).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // Deliberately read older messages while the answer is still arriving.
  await page.locator(".conversation").dispatchEvent("wheel", { deltaY: -300 });
  await page.locator(".conversation").evaluate((el) => {
    el.scrollTop = 0;
  });
  await emit(page, [
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "answer",
      delta: "logged sleep and a practical routine.",
    },
  ]);
  await expect
    .poll(() => page.locator(".conversation").evaluate((el) => el.scrollTop))
    .toBe(0);
  const result: CoachResponse = {
    reply: "### Your week\nHere is your logged sleep and a practical routine.",
    proposals: [],
    visuals,
  };
  await emit(page, [
    { type: "TEXT_MESSAGE_END", messageId: "answer" },
    {
      type: "RUN_FINISHED",
      runId: request.body.runId,
      threadId: "coach",
      result,
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Latest message" }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(composer).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.locator(".coach-visual-bar_chart").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("coach-rich-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.locator(".coach-visual-diagram").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("coach-diagram-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Latest message" }).click();
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(report.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("coach-rich-mobile.png"),
    fullPage: true,
  });
  turns.push({ id: request.body.runId, question, status: "done", ...result });
  await page.reload();
  await expect(page.locator(".coach-visual")).toHaveCount(3);
  await expect(
    page
      .getByRole("table")
      .getByRole("columnheader", { name: "Sleep", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("img", { name: "A simple check-in routine", exact: true }),
  ).toBeAttached();
});

test("AG-UI cancellation and interrupted replies preserve the question and never offer an unconfirmed save", async ({
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Log seven hours of sleep for today");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  // Stop is available while the lazily loaded client is still downloading.
  // Wait for our synthetic transport before injecting provider events.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as StreamWindow).coachRequests.length,
      ),
    )
    .toBe(1);
  await emit(page, [
    ...startReply,
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "answer",
      delta: "I am checking your entry.",
    },
  ]);
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(composer).toHaveValue("Log seven hours of sleep for today");
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as StreamWindow).coachAborted),
    )
    .toBe(true);
  await expect(
    page.getByText(
      "Response stopped. Your message is ready to edit or send again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save this change" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as StreamWindow).coachRequests.length,
      ),
    )
    .toBe(2);
  await emit(page, [
    ...startReply,
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "answer",
      delta: "Partial reply",
    },
    {
      type: "CUSTOM",
      name: "coach.visual",
      value: {
        id: crypto.randomUUID(),
        content: { kind: "html", html: "<img src=https://tracking.example>" },
      },
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect(composer).toHaveValue("Log seven hours of sleep for today");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Save this change" }),
  ).toHaveCount(0);
  await expect(page.locator(".coach-visual, img[src*=tracking]")).toHaveCount(
    0,
  );

  // A completed AG-UI run can offer a review card; saving still needs a click.
  let saves = 0;
  await context.route("**/api/agent/action", (route) => {
    saves++;
    return route.fulfill({ json: { status: "saved" } });
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as StreamWindow).coachRequests.length,
      ),
    )
    .toBe(3);
  const runId = await page.evaluate(
    () => (window as unknown as StreamWindow).coachRequests.at(-1)!.body.runId,
  );
  await emit(page, [
    { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
    {
      type: "RUN_FINISHED",
      threadId: "coach",
      runId,
      result: {
        reply: "Ready for your review. Check the sleep entry before saving.",
        proposals: [
          {
            id: "synthetic-sleep-proposal",
            title: "Log your sleep",
            detail: "Updates sleep and preserves other check-in values.",
            workout: null,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            checkin: {
              date: "2026-09-06",
              sleepHours: 7,
              energy: null,
              soreness: null,
              waterMl: null,
              bodyweight: null,
              notes: "",
            },
          },
        ],
      },
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  const save = page.getByRole("button", { name: "Save this change" });
  await expect(save).toBeEnabled();
  expect(saves).toBe(0);
  await save.click();
  await expect(page.locator(".agent-proposal.saved")).toHaveCount(1);
  expect(saves).toBe(1);
});
