import { test, expect, browserUser } from "./fixtures";
import { emptyJournal } from "../../lib/domain";
import type { Page } from "@playwright/test";

async function holdSyncLock(page: Page) {
  await page.addInitScript((accountId) => {
    void navigator.locks.request(
      `lift-sync:${accountId}`,
      () =>
        new Promise<void>((resolve) => {
          (
            window as unknown as { releaseSyncLock: () => void }
          ).releaseSyncLock = resolve;
        }),
    );
  }, browserUser.id);
}

async function releaseSyncLock(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { releaseSyncLock: () => void }).releaseSyncLock(),
  );
}

test("a suspended tab's write lock cannot block a clean journal or Coach submission", async ({
  page,
  context,
}) => {
  await holdSyncLock(page);
  let sent = "",
    writes = 0;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") writes++;
    return r.fulfill({
      json: { accountId: browserUser.id, state: emptyJournal(), revision: 2 },
    });
  });
  await context.route("**/api/agent", (r) => {
    if (r.request().method() === "POST") {
      const input = r.request().postDataJSON();
      sent = input.message;
      expect(input.revision).toBe(2);
      expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
      return r.fulfill({
        json: { reply: "Your synthetic journal is connected.", proposals: [] },
      });
    }
    return r.fulfill({
      json: { enabled: true, provider: "Test provider", turns: [] },
    });
  });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page
    .getByLabel("Message your coach")
    .fill("Check my synthetic journal");
  await page.getByLabel("Message your coach").press("Enter");
  await expect.poll(() => sent).toBe("Check my synthetic journal");
  await expect(page.locator(".assistant-response")).toContainText(
    "Your synthetic journal is connected.",
  );
  expect(writes).toBe(0);
  await releaseSyncLock(page);
});

test("background refresh keeps Send available, a failed sync offers recovery without submitting the draft", async ({
  page,
  context,
}, testInfo) => {
  let reads = 0,
    posts = 0;
  let complete: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await context.route("**/api/journal", async (r) => {
    reads++;
    if (reads === 2) {
      await held;
      await r.fulfill({
        status: 503,
        json: { error: "Synthetic temporary failure" },
      });
    } else {
      await r.fulfill({
        json: { accountId: browserUser.id, state: emptyJournal(), revision: 0 },
      });
    }
  });
  await context.route("**/api/agent", (r) => {
    if (r.request().method() === "POST") posts++;
    return r.fulfill({
      json: { enabled: true, provider: "Test provider", turns: [] },
    });
  });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Keep this unsent draft");
  await page
    .getByRole("button", { name: "All changes synced", exact: true })
    .click();
  await expect.poll(() => reads).toBe(2);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  complete();
  await expect(
    page.getByRole("button", { name: "Reconnect Coach", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".coach-reconnect")).toContainText(
    "Your journal hasn’t connected yet",
  );
  await expect(
    page.getByText("Sign in and connect to the internet to use the assistant."),
  ).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("coach-reconnect.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Reconnect Coach", exact: true })
    .click();
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Keep this unsent draft");
  expect(posts).toBe(0);
});

test("an unavailable Coach connection retries without reloading or erasing the draft", async ({
  page,
  context,
}) => {
  let reads = 0;
  await context.route("**/api/agent", (r) => {
    reads++;
    return reads === 1
      ? r.fulfill({ status: 503, json: { error: "Synthetic cold start" } })
      : r.fulfill({
          json: { enabled: true, provider: "Test provider", turns: [] },
        });
  });
  await page.goto("/#coach");
  const composer = page.getByLabel("Message your coach");
  await composer.fill("My next question");
  await expect(page.locator(".coach-reconnect")).toContainText(
    "Coach couldn’t connect",
  );
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  // Returning online retries both authenticated reads. No POST is performed.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("My next question");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  expect(reads).toBe(2);
});

test("unsynced edits remain protected while another tab holds the write lock and reconnect saves once", async ({
  page,
  context,
}) => {
  let state = emptyJournal(),
    writes = 0;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      writes++;
      state = r.request().postDataJSON().state;
    }
    return r.fulfill({
      json: { accountId: browserUser.id, state, revision: writes },
    });
  });
  await holdSyncLock(page);
  await page.goto("/#workout/monday");
  await expect(
    page.getByRole("button", { name: "All changes synced", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start this programme" }).click();
  await page
    .getByLabel("Set 1 weight in kilograms", { exact: true })
    .fill("42.5");
  await page.getByLabel("Set 1 made", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "Coach", exact: true })
    .click();
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Keep my training question");
  await expect(page.locator(".coach-reconnect")).toContainText(
    "Another tab is syncing",
  );
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(0);
  await releaseSyncLock(page);
  await page
    .getByRole("button", { name: "Reconnect Coach", exact: true })
    .click();
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Keep my training question");
  expect(writes).toBe(1);
  await page
    .getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "Train", exact: true })
    .click();
  await expect(
    page.getByLabel("Set 1 weight in kilograms", { exact: true }),
  ).toHaveValue("42.5");
  await expect(page.getByLabel("Set 1 made", { exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a hung initial Coach request times out and can reconnect without losing text", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let first = true;
    window.fetch = (input, init) => {
      if (
        first &&
        input === "/api/agent" &&
        (!init?.method || init.method === "GET")
      ) {
        first = false;
        return new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        });
      }
      return original(input, init);
    };
  });
  await page.goto("/#coach");
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Preserve my question through a timeout");
  const reconnect = page.getByRole("button", {
    name: "Reconnect Coach",
    exact: true,
  });
  await expect(reconnect).toBeEnabled({ timeout: 13000 });
  await reconnect.click();
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Preserve my question through a timeout");
});

test("a slow read cannot undo a newer sync from another tab or create a false conflict", async ({
  page,
  context,
}) => {
  let state = emptyJournal(),
    revision = 0,
    reads = 0;
  let complete: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await context.route("**/api/journal", async (r) => {
    if (r.request().method() === "PUT") {
      expect(r.request().postDataJSON().revision).toBe(revision);
      state = r.request().postDataJSON().state;
      revision++;
    }
    const snapshot = { accountId: browserUser.id, state, revision };
    if (r.request().method() === "GET" && r.request().frame().page() === page) {
      reads++;
      if (reads === 2) await held;
    }
    await r.fulfill({ json: snapshot });
  });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "All changes synced", exact: true })
    .click();
  await expect.poll(() => reads).toBe(2);
  const second = await context.newPage();
  try {
    await second.goto("/#workout/monday");
    await second.getByRole("button", { name: "Start this programme" }).click();
    await second
      .getByLabel("Set 1 weight in kilograms", { exact: true })
      .fill("57.5");
    await expect(
      second.getByRole("button", { name: "All changes synced", exact: true }),
    ).toBeVisible();
    expect(revision).toBe(1);
    complete();
    await page.bringToFront();
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use server version" }),
    ).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Train", exact: true })
      .click();
    await expect(
      page.getByLabel("Set 1 weight in kilograms", { exact: true }),
    ).toHaveValue("57.5");
    expect(revision).toBe(1);
  } finally {
    complete();
    await second.close();
  }
});
