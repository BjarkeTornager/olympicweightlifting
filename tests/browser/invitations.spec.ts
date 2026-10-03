import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("Owner can invite a Google account and revoke or restore access on mobile", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: browserUser,
        google: true,
        configured: true,
        canInvite: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
  );
  const email = "invited@example.test";
  let invitations: {
    id: string;
    email: string;
    revokedAt: string | null;
    joined: boolean;
  }[] = [];
  await context.route("**/api/invitations", (r) => {
    const request = r.request();
    expect(request.headers()["x-journal-account"]).toBe(browserUser.id);
    if (request.method() === "POST") {
      expect(request.postDataJSON().email).toBe(email);
      invitations = [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email,
          revokedAt: null,
          joined: false,
        },
      ];
      return r.fulfill({ json: { id: invitations[0].id } });
    }
    if (request.method() === "DELETE") {
      expect(request.postDataJSON().id).toBe(invitations[0].id);
      invitations[0].revokedAt = new Date().toISOString();
      return r.fulfill({ json: { revoked: true } });
    }
    return r.fulfill({ json: { invitations } });
  });
  await context.route("**/api/owner/usage", (r) => {
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    return r.fulfill({
      json: {
        generatedAt: new Date().toISOString(),
        people: { total: 3, active7: 2, active28: 3 },
        weeks: [
          { start: "2026-09-28", active: 2, fullDays: 1.5, anyDays: 3 },
          { start: "2026-09-21", active: 3, fullDays: 2, anyDays: 4.3 },
        ],
        retention: [{ week: "2026-08-03", joined: 2, week4: 1 }],
        features: [
          {
            feature: "coach.message",
            people: 3,
            uses: 41,
            last: "2026-10-02",
          },
        ],
        aiCost: {
          day: "2026-10-03",
          month: "2026-10",
          accounts: [
            {
              account: "a1b2c3d4",
              you: true,
              today: 0.0637,
              month: 1.25,
              calls: 12,
              estimated: 0,
            },
          ],
          total: { today: 0.0637, month: 1.25, calls: 12, estimated: 0 },
        },
        limits: {
          mode: "log",
          rows: [
            {
              account: "a1b2c3d4",
              you: true,
              limit: "coach-messages-day",
              logged: 2,
              refused: 0,
            },
          ],
        },
      },
    });
  });
  await page.goto("/#data");
  await expect(
    page.getByText("Only you have access. No invitations yet."),
  ).toBeVisible();
  // The owner's usage totals sit beside invitations.
  const usage = page.getByRole("region", { name: "Usage" });
  await expect(usage.getByText("coach.message")).toBeVisible();
  await expect(usage.getByText("1 (50%)")).toBeVisible();
  // What each account's AI use cost, by the start of its id.
  const cost = page.getByRole("region", { name: "AI cost per account" });
  await expect(
    cost.getByRole("rowheader", { name: "a1b2c3d4 (you)" }),
  ).toBeVisible();
  await expect(
    cost
      .getByRole("row", { name: /a1b2c3d4/ })
      .getByRole("cell", { name: "$1.25" }),
  ).toBeVisible();
  // While limits only log, how often an account would have been refused.
  await expect(page.getByText("Limits only log for now")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Usage limits reached per account" })
      .getByRole("row", { name: /coach-messages-day/ }),
  ).toBeVisible();
  await page.getByLabel("Google account email").fill(email);
  await page.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy invitation" }),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: "Invitations" });
  await expect(
    panel.getByText("Invited · waiting for Google sign-in"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .include(".invitation-panel")
    .include(".usage-panel")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("owner-invitations-mobile.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Revoke access" }).click();
  await expect(
    panel.getByText("Access revoked", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Copy invitation" }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Restore access" }).click();
  await expect(
    panel.getByText("Invited · waiting for Google sign-in"),
  ).toBeVisible();
});

test("Invited accounts cannot see invitation management", async ({ page }) => {
  await page.goto("/#data");
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Invitations", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Usage", exact: true }),
  ).toHaveCount(0);
});
