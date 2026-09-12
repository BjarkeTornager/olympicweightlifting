import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("a failed Google return opens a retryable sign-in page without downloading JSON", async ({
  page,
  context,
}) => {
  let downloads = 0;
  let privateReads = 0;
  page.on("download", () => downloads++);
  await context.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        user: null,
        google: true,
        configured: true,
        localPassword: false,
        canInvite: false,
      },
    }),
  );
  await context.route(/\/api\/(journal|agent|images|food\/photos)/, (route) => {
    privateReads++;
    return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
  });
  // Substitute only Google's external journey. The callback route and landing
  // screen are served by the real app, including when no OAuth state returns.
  await context.route("**/api/auth/sign-in/social", (route) => {
    expect(route.request().postDataJSON().provider).toBe("google");
    return route.fulfill({
      json: { url: "/api/auth/callback/google?error=access_denied" },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\?signin=failed/);
  await expect(page.locator(".public-landing").getByRole("alert")).toContainText(
    "Use the Google account the owner invited",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  await expect(page.locator(".private-shell")).toHaveCount(0);
  expect(downloads).toBe(0);
  expect(privateReads).toBe(0);
});
