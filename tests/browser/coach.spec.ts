import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { emptyJournal, today } from "../../lib/domain";

test.describe("focused Coach conversation", () => {
  test.use({ serviceWorkers: "block" });
  test("long history opens at the latest exchange, keeps the composer reachable and folds saved entries", async ({
    page,
    context,
  }, testInfo) => {
    const user = {
      id: "coach-layout-account",
      name: "Synthetic account",
      email: "coach@example.test",
    };
    await context.route("**/api/session", (r) =>
      r.fulfill({
        json: { user, configured: true, google: true, localPassword: false },
      }),
    );
    await context.route("**/api/journal", (r) =>
      r.fulfill({
        json: { accountId: user.id, state: emptyJournal(), revision: 1 },
      }),
    );
    const turns = Array.from({ length: 18 }, (_, i) => ({
      id: `turn-${i}`,
      question:
        i === 17
          ? "How should I approach training today?"
          : `Review my check-in ${i + 1}.`,
      reply:
        i === 17
          ? "### Keep today simple\nYou reported a good night’s sleep and moderate energy. Start with your warm-up and see how you feel.\n\n1. **Train with intent.** Follow your planned session if the warm-up feels comfortable.\n2. **Keep food logging current.** Add your next meal when you eat.\n3. **Check in this evening.** Note your energy and soreness.\n\n*Logged observation:* Your sleep entry is ready to review below."
          : "Your check-in is recorded. You can find it in Health history.",
      status: "done",
      proposals: [
        {
          id: `proposal-${i}`,
          title:
            i === 17 ? "Log last night’s sleep" : `Daily check-in ${i + 1}`,
          detail: "Updates sleep while keeping your other daily values.",
          checkin: {
            date: today(),
            sleepHours: 7.5,
            waterMl: 1250,
            energy: 3,
            soreness: 2,
            bodyweight: null,
            notes: "Synthetic check-in",
          },
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          ...(i < 17 ? { status: "saved" } : {}),
        },
      ],
    }));
    await context.route("**/api/agent", (r) =>
      r.fulfill({ json: { enabled: true, provider: "Test provider", turns } }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#coach");
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    const composer = page.getByLabel("Message your coach");
    await expect(composer).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeInViewport();
    await expect(page.locator(".chat-user").last()).toBeInViewport();
    await expect(page.locator(".conversation-turn")).toHaveCount(6);
    await expect(
      page.locator(".agent-proposal.saved details[open]"),
    ).toHaveCount(0);
    await expect(
      page.locator(".agent-proposal.pending details[open]"),
    ).toHaveCount(1);
    await expect(page.locator(".assistant-response ol")).toHaveCount(1);
    await expect(page.locator(".assistant-response em")).toContainText(
      "Logged observation",
    );
    await page.screenshot({
      path: testInfo.outputPath("coach-conversation-mobile.png"),
      fullPage: true,
    });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("button", { name: "Latest message" }).click();
      await expect(composer).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Send", exact: true }),
      ).toBeInViewport();
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
    await page.getByRole("button", { name: "Review (1)", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Log last night’s sleep",
        exact: true,
      }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "Latest message" }).click();
    await page.screenshot({
      path: testInfo.outputPath("coach-conversation-desktop.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Earlier messages (12)" }).click();
    await expect(page.locator(".conversation-turn")).toHaveCount(16);
    await page.getByRole("button", { name: "Earlier messages (2)" }).click();
    await expect(page.locator(".conversation-turn")).toHaveCount(18);
    await page.locator(".agent-proposal.saved summary").first().click();
    await expect(
      page
        .locator(".agent-proposal.saved")
        .first()
        .getByRole("button", { name: "Undo this change" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Latest message" }).click();
    await expect(page.locator(".chat-user").last()).toBeInViewport();
    await expect(composer).toBeInViewport();
  });

  test("Today, quick logging and image tools preserve the unsent message and private attachment", async ({
    page,
    context,
  }, testInfo) => {
    const user = {
        id: "coach-draft-account",
        name: "Synthetic account",
        email: "draft@example.test",
      },
      imageId = crypto.randomUUID();
    let requests = 0;
    await context.route("**/api/session", (r) =>
      r.fulfill({
        json: { user, configured: true, google: true, localPassword: false },
      }),
    );
    await context.route("**/api/journal", (r) =>
      r.fulfill({
        json: { accountId: user.id, state: emptyJournal(), revision: 1 },
      }),
    );
    await context.route("**/api/agent", (r) => {
      if (r.request().method() !== "GET") requests++;
      return r.fulfill({
        json: { enabled: true, provider: "Test provider", turns: [] },
      });
    });
    const pixels = await sharp({
      create: { width: 240, height: 320, channels: 3, background: "#c8b9e9" },
    })
      .jpeg()
      .toBuffer();
    await context.route("**/api/images/*", (r) =>
      r.request().url().includes("metadata=1")
        ? r.fulfill({
            json: {
              id: imageId,
              label: "Sleep screenshot",
              date: today(),
              category: "sleep",
              version: 1,
              bytes: pixels.length,
              createdAt: new Date().toISOString(),
              classification: {
                status: "ready",
                confidence: "high",
                source: "automatic",
                tags: ["sleep report"],
              },
            },
          })
        : r.fulfill({ body: pixels, contentType: "image/jpeg" }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#coach/photo/${imageId}/sleep`);
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    const composer = page.getByLabel("Message your coach");
    await composer.fill("I slept 7 hours 47 minutes last night.");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your day, in focus." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Plan my day" }).click();
    await expect(
      page.getByRole("button", { name: "Conversation", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(composer).toHaveValue(
      /^I slept 7 hours 47 minutes last night\./,
    );
    await expect(composer).toHaveValue(/First read my health overview/);
    expect(requests).toBe(0);
    await page.getByRole("button", { name: "Log sleep", exact: true }).click();
    await expect(composer).toHaveValue(
      /^I slept 7 hours 47 minutes last night\./,
    );
    await expect(
      page.getByRole("img", { name: "Image ready to send" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Add images" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Tag uploads automatically" }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Tag uploads automatically" })
      .uncheck();
    await page.getByRole("button", { name: "Add images" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Tag uploads automatically" }),
    ).not.toBeVisible();
    await expect(composer).toHaveValue(
      /^I slept 7 hours 47 minutes last night\./,
    );
    await page.getByRole("button", { name: "Coach options" }).click();
    await expect(page.getByRole("dialog")).toContainText("Test provider");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(composer).toHaveValue(
      /^I slept 7 hours 47 minutes last night\./,
    );
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("coach-image-draft-mobile.png"),
      fullPage: true,
    });
    expect(requests).toBe(0);
    // Model the visual viewport reduction used by iOS when the keyboard opens.
    await composer.focus();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        value: 450,
      });
      window.visualViewport?.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-keyboard-open",
      "",
    );
    const send = page.getByRole("button", { name: "Send", exact: true });
    const bounds = await send.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(450);
    await expect(composer).toHaveValue(
      /^I slept 7 hours 47 minutes last night\./,
    );
  });
});

test("sending on a phone keeps the latest exchange visible through keyboard dismissal and reply layout", async ({
  page,
  context,
}, testInfo) => {
  const turns = Array.from({ length: 10 }, (_, i) => ({
    id: `phone-turn-${i}`,
    question: `Earlier question ${i + 1}`,
    reply: Array.from(
      { length: 6 },
      () =>
        "An earlier answer with enough detail to make this conversation scroll.",
    ).join("\n\n"),
    status: "done",
    proposals: [],
  }));
  let finishReply: (() => Promise<void>) | undefined;
  await context.route("**/api/agent", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { enabled: true, provider: "Test provider", turns },
      });
      return;
    }
    await new Promise<void>((resolve) => {
      finishReply = async () => {
        await route.fulfill({
          json: {
            reply:
              "### Your next step\n" +
              Array.from(
                { length: 20 },
                () =>
                  "Here is a detailed response you can read at your own pace.",
              ).join("\n\n"),
            proposals: [],
          },
        });
        resolve();
      };
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("What should I do next?");
  await composer.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 450,
    });
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "offsetTop", {
      configurable: true,
      value: 60,
    });
    window.visualViewport?.dispatchEvent(new Event("scroll"));
  });
  const sendBounds = await page
    .getByRole("button", { name: "Send", exact: true })
    .boundingBox();
  expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(510);
  await expect(page.locator(".coach-mode .main")).toHaveCSS("top", "60px");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => Boolean(finishReply)).toBe(true);
  // iOS reports several viewport changes after blur, after the first paint.
  for (const height of [570, 700, 844]) {
    await page.evaluate((value) => {
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        value,
      });
      Object.defineProperty(window.visualViewport, "offsetTop", {
        configurable: true,
        value: Math.max(0, (844 - value) / 5),
      });
      window.visualViewport?.dispatchEvent(new Event("resize"));
    }, height);
    await page.waitForTimeout(60);
  }
  await finishReply!();
  await expect(
    page.getByRole("heading", { name: "Your next step" }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scroller = document.querySelector(".conversation")!;
        const question = scroller.querySelector(
          ".conversation-turn:last-child .chat-user",
        )!;
        return Math.abs(
          question.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            16,
        );
      }),
    )
    .toBeLessThan(20);
  await expect(composer).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("coach-phone-after-send.png"),
    fullPage: true,
  });

  // A later reply must not interrupt someone deliberately reading history.
  finishReply = undefined;
  await composer.fill("And what about tomorrow?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => Boolean(finishReply)).toBe(true);
  const log = page.getByRole("log", { name: "Coach conversation" });
  await expect(
    page.getByText("And what about tomorrow?", { exact: false }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      log.evaluate((el) => {
        const question = el.querySelector(
          ".conversation-turn:last-child .chat-user",
        )!;
        return Math.abs(
          question.getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            16,
        );
      }),
    )
    .toBeLessThan(20);
  const latestTop = await log.evaluate((el) => el.scrollTop);
  await log.hover();
  await page.mouse.wheel(0, -700);
  await expect
    .poll(() => log.evaluate((el) => el.scrollTop))
    .toBeLessThan(latestTop - 100);
  let previousTop = -1;
  await expect
    .poll(
      async () => {
        const top = await log.evaluate((el) => el.scrollTop);
        const settled = Math.abs(top - previousTop) < 1;
        previousTop = top;
        return settled;
      },
      { intervals: [100] },
    )
    .toBe(true);
  const readingTop = await log.evaluate((el) => el.scrollTop);
  expect(readingTop).toBeGreaterThan(100);
  await finishReply!();
  await expect(
    page.locator(".conversation-turn").last().locator(".chat-assistant"),
  ).toBeAttached();
  await expect
    .poll(() => log.evaluate((el) => el.scrollTop))
    .toBeCloseTo(readingTop, 0);

  // Returning to Safari revalidates the session and briefly conceals the app.
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expect(page.locator(".private-shell")).toBeHidden();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow")),
  );
  await expect(page.locator(".private-shell")).toBeVisible();
  await expect
    .poll(() => log.evaluate((el) => el.scrollTop))
    .toBeCloseTo(readingTop, 0);
  await page.getByRole("button", { name: "Latest message" }).click();
  await expect(page.locator(".chat-user").last()).toBeInViewport();
  await expect(composer).toBeInViewport();
});
