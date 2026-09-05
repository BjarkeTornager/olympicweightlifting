import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer, request } from "node:http";
import { emptyJournal, createWorkout, days, backup } from "../../lib/domain";
test("log, reload, finish and edit a workout", async ({ page }) => {
  await page.goto("/#workout/monday");
  await page.getByRole("button", { name: "Start this programme" }).click();
  await page
    .getByLabel("Set 1 weight in kilograms", { exact: true })
    .fill("47.5");
  await page.getByLabel("Set 1 made", { exact: true }).click();
  await expect(
    page.getByLabel("Set 2 weight in kilograms", { exact: true }),
  ).toHaveValue("47.5");
  await page.reload();
  await expect(page.getByLabel("Set 1 made", { exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .locator(".workout-dock")
    .getByRole("button", { name: "Finish workout" })
    .click();
  await page.getByRole("button", { name: "Save workout", exact: true }).click();
  await page.getByRole("button", { name: "Keep current PRs" }).click();
  await expect(
    page.getByText("1 saved sessions.", { exact: false }),
  ).toBeVisible();
  await page.locator(".history-detail > summary").click();
  await expect(page.getByText("47.5 kg × 1", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Edit session", exact: true }).click();
  await expect(
    page.getByLabel("Set 1 weight in kilograms", { exact: true }),
  ).toHaveValue("47.5");
});
test("all main screens fit mobile and desktop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "dashboard",
      "workout/choose",
      "workout/gym_accessories",
      "history",
      "progress",
      "library",
      "data",
    ]) {
      await page.goto("/#" + route);
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
        "Opening your journal…",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
test("backup preview imports an active draft without duplicate records", async ({
  page,
}) => {
  const state = emptyJournal();
  state.prs.snatch = 64;
  state.activeWorkout = createWorkout(
    state,
    days.find((d) => d.id === "monday"),
    "2026-09-05",
  );
  state.activeWorkout.exercises[0].sets[0].weight = "52.5";
  state.activeWorkout.exercises[0].sets[0].touched = true;
  await page.goto("/#data");
  for (let i = 0; i < 2; i++) {
    await page.locator('input[type="file"]').setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup(state))),
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Import backup", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.goto("/#workout");
  await expect(
    page.getByLabel("Set 1 weight in kilograms", { exact: true }),
  ).toHaveValue("52.5");
  await page.goto("/#workout/gym_accessories");
  await expect(
    page.getByRole("heading", { name: "Gym Accessories", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Snatch + Back Squat is in progress.", { exact: false }),
  ).toBeVisible();
});
test("offline reload keeps recorded sets and the programme library", async ({
  page,
}) => {
  // Stop a real HTTP origin: WebKit's setOffline emulation can fail internally
  // before dispatching the navigation to its service worker.
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(
      `http://127.0.0.1:34173${incoming.url}`,
      {
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw Error("Missing test origin");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(`${origin}/#workout/monday`);
    await page.getByRole("button", { name: "Start this programme" }).click();
    await page.getByLabel("Set 1 made", { exact: true }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          ),
        );
    });
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await page.reload();
    await expect(
      page.getByLabel("Set 1 made", { exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto(`${origin}/#library`);
    await expect(
      page.getByRole("heading", { name: "Your technique library." }),
    ).toBeVisible();
  } finally {
    proxy.closeAllConnections();
    proxy.close();
  }
});

test("sync client retries an interrupted acknowledgement and protects conflicting device edits", async ({
  browser,
}) => {
  // Deterministic transport fixtures exercise the real IndexedDB queue and UI.
  // tests/database.test.ts separately exercises actual sessions and PostgreSQL.
  const user = {
    id: "sync-test-athlete",
    name: "Test athlete",
    email: "sync@example.test",
  };
  let server = { state: emptyJournal(), revision: 0 };
  const seen = new Set<string>();
  const attempts: string[] = [];
  let loseAcknowledgement = true;
  let secondDisconnected = true;
  const contexts = await Promise.all([
    browser.newContext({ serviceWorkers: "block" }),
    browser.newContext({ serviceWorkers: "block" }),
  ]);
  try {
    for (const [index, context] of contexts.entries()) {
      await context.route("**/api/session", (route) =>
        route.fulfill({
          json: { user, configured: true, google: true, localPassword: false },
        }),
      );
      await context.route("**/api/journal", async (route) => {
        expect(route.request().headers()["x-journal-account"]).toBe(user.id);
        if (
          index === 1 &&
          secondDisconnected &&
          route.request().method() === "PUT"
        ) {
          await route.fulfill({
            status: 503,
            json: { error: "Test connection unavailable" },
          });
          return;
        }
        if (route.request().method() === "PUT") {
          const input = route.request().postDataJSON();
          attempts.push(input.mutationId);
          if (!seen.has(input.mutationId)) {
            if (input.revision !== server.revision) {
              await route.fulfill({ status: 409, json: server });
              return;
            }
            seen.add(input.mutationId);
            server = { state: input.state, revision: server.revision + 1 };
          }
          if (index === 0 && loseAcknowledgement) {
            await route.fulfill({
              status: 503,
              json: { error: "Test acknowledgement lost" },
            });
            return;
          }
        }
        await route.fulfill({ json: { accountId: user.id, ...server } });
      });
    }
    const [first, second] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    await Promise.all([
      first.goto("http://127.0.0.1:34173/#workout/monday"),
      second.goto("http://127.0.0.1:34173/#workout/monday"),
    ]);
    await expect(
      first.getByText("All changes synced", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      second.getByText("All changes synced", { exact: true }).first(),
    ).toBeVisible();
    await second.getByRole("button", { name: "Start this programme" }).click();
    await second
      .getByLabel("Set 1 weight in kilograms", { exact: true })
      .fill("55");
    await second.getByLabel("Set 1 made", { exact: true }).click();
    await first.getByRole("button", { name: "Start this programme" }).click();
    await first
      .getByLabel("Set 1 weight in kilograms", { exact: true })
      .fill("47.5");
    await first.getByLabel("Set 1 made", { exact: true }).click();
    await expect.poll(() => server.revision).toBe(1);
    const interruptedId = attempts[0];
    loseAcknowledgement = false;
    await first.reload();
    await expect(
      first.getByText("All changes synced", { exact: true }).first(),
    ).toBeVisible();
    expect(
      attempts.filter((id) => id === interruptedId).length,
    ).toBeGreaterThanOrEqual(2);
    expect(server.revision).toBe(1);
    secondDisconnected = false;
    await second.goto("http://127.0.0.1:34173/#data");
    await second.getByRole("button", { name: "Sync now" }).click();
    await expect(
      second.getByRole("button", { name: "Use server version" }),
    ).toBeVisible();
    await second.goto("http://127.0.0.1:34173/#workout");
    await expect(
      second.getByLabel("Set 1 weight in kilograms", { exact: true }),
    ).toHaveValue("55");
    await second.getByRole("button", { name: "Use server version" }).click();
    await expect(
      second.getByLabel("Set 1 weight in kilograms", { exact: true }),
    ).toHaveValue("47.5");
    expect(server.revision).toBe(1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("key screens have no WCAG A/AA violations and the skip link keeps the route", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "dashboard",
    "workout/monday",
    "workout",
    "progress",
    "data",
    "library",
    "history",
  ]) {
    await page.goto("/#" + route);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      "Opening your journal…",
    );
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect
      .soft(
        report.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            issue: n.failureSummary,
          })),
        })),
      )
      .toEqual([]);
    if (route === "workout/monday")
      await page.getByRole("button", { name: "Start this programme" }).click();
  }
  await page.goto("about:blank");
  await page.goto("/#dashboard");
  // OS/browser preferences differ on whether Tab stops at links. Focus the
  // skip link explicitly, then verify its real keyboard activation.
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await expect(page).toHaveURL(/#dashboard$/);
});
