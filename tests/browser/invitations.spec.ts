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
  await page.goto("/#data");
  await expect(
    page.getByText("Only you have access. No invitations yet."),
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
});
