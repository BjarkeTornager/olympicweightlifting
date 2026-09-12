import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { emptyJournal, today } from "../../lib/domain";
import type { CoachResponse, SavedVisual } from "../../lib/coach-visuals";

test("Coach displays private galleries through AG-UI and history, with enlargement and fresh access checks", async ({
  page,
  context,
}, testInfo) => {
  let account = "gallery-account-a",
    sent = false;
  const imageIds = Array.from({ length: 3 }, () => crypto.randomUUID());
  const available = new Set(imageIds);
  const labels = ["Breakfast bowl", "Lunch plate", "Dinner bowl"];
  const calls: { id: string; account?: string; metadata: boolean }[] = [];
  const gallery: SavedVisual = {
    id: crypto.randomUUID(),
    content: {
      kind: "photo_gallery",
      title: "Today’s meal photos",
      imageIds,
      caption:
        "Private photos · Library dates shown below.",
    },
  };
  const reply: CoachResponse = {
    reply: "Here are the three photos linked to today’s meals.",
    proposals: [],
    visuals: [gallery],
  };
  const question = "Show me images of what I ate today";
  const turn = { id: crypto.randomUUID(), question, ...reply, status: "done" };
  const pixels = await sharp(
    Buffer.from(
      '<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#e9dfc8"/><circle cx="200" cy="150" r="110" fill="#fffdf6"/><circle cx="200" cy="150" r="78" fill="#76977d"/><circle cx="170" cy="120" r="22" fill="#c27757"/><circle cx="225" cy="172" r="30" fill="#e4c98b"/></svg>',
    ),
  )
    .jpeg()
    .toBuffer();
  await context.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: {
          id: account,
          name: "Synthetic gallery test",
          email: "gallery@example.test",
        },
        configured: true,
        google: true,
      },
    }),
  );
  await context.route("**/api/journal", (r) =>
    r.fulfill({
      json: { accountId: account, state: emptyJournal(), revision: 1 },
    }),
  );
  await context.route("**/api/agent", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        provider: "Test provider",
        protocol: "ag-ui",
        turns: sent ? [turn] : [],
      },
    }),
  );
  await context.route("**/api/agent/run", (r) => {
    const input = r.request().postDataJSON();
    expect(input.messages[0].content).toBe(question);
    expect(input.forwardedProps.photoIds).toEqual([]);
    expect(r.request().headers()["x-journal-account"]).toBe(account);
    sent = true;
    const events = [
      { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
      { type: "STEP_STARTED", stepName: "Bringing your photos into chat" },
      { type: "CUSTOM", name: "coach.visual", value: gallery },
      { type: "STEP_FINISHED", stepName: "Bringing your photos into chat" },
      { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: reply.reply },
      { type: "TEXT_MESSAGE_END", messageId: "answer" },
      {
        type: "RUN_FINISHED",
        threadId: input.threadId,
        runId: input.runId,
        result: reply,
      },
    ];
    return r.fulfill({
      contentType: "text/event-stream",
      headers: { "Cache-Control": "private, no-store" },
      body: events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await context.route("**/api/images/*", (r) => {
    const url = new URL(r.request().url()),
      id = url.pathname.split("/").at(-1)!;
    const metadata = url.searchParams.get("metadata") === "1";
    calls.push({
      id,
      metadata,
      account: r.request().headers()["x-journal-account"],
    });
    if (account !== "gallery-account-a" || !available.has(id))
      return r.fulfill({
        status: 404,
        json: { error: "Image not found in your library." },
      });
    return metadata
      ? r.fulfill({
          json: {
            id,
            date: today(),
            label: labels[imageIds.indexOf(id)],
            category: "food",
          },
        })
      : r.fulfill({
          body: pixels,
          contentType: "image/jpeg",
          headers: { "Cache-Control": "private, no-store" },
        });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const photos = page.getByRole("list", {
    name: "Photos from your private library",
  });
  await expect(photos.getByRole("img")).toHaveCount(3);
  for (const img of await photos.getByRole("img").all())
    await expect(img).toHaveAttribute("src", /^blob:/);
  expect(calls.every((c) => c.account === "gallery-account-a")).toBe(true);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(composer).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open photo: Breakfast bowl" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("coach-gallery-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open photo: Breakfast bowl" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("img", { name: "Breakfast bowl" }),
  ).toHaveAttribute("src", /^blob:/);
  await expect(
    dialog.getByRole("link", { name: "Download photo" }),
  ).toHaveAttribute("href", /^blob:/);
  await page.screenshot({
    path: testInfo.outputPath("coach-photo-enlarged-mobile.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(composer).toBeInViewport();
  labels[0] = "Renamed breakfast";
  available.delete(imageIds[1]);
  calls.length = 0;
  await page.reload();
  await expect(photos.getByRole("img")).toHaveCount(2);
  await expect(photos).toContainText("Renamed breakfast");
  await expect(photos).toContainText("This photo is no longer available");
  expect(calls.some((c) => c.id === imageIds[1] && !c.metadata)).toBe(false);
  // Even a stale/replayed gallery cannot reuse another account's image blobs.
  account = "gallery-account-b";
  calls.length = 0;
  await page.reload();
  await expect(photos.locator(".coach-photo-unavailable")).toHaveCount(3);
  await expect(photos.getByRole("img")).toHaveCount(0);
  await expect(photos).not.toContainText("Renamed breakfast");
  expect(
    calls.every((c) => c.account === "gallery-account-b" && c.metadata),
  ).toBe(true);
});
