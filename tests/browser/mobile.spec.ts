import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const challenge = "a".repeat(43),
  state = "b".repeat(32);
const path = `/mobile?${new URLSearchParams({ challenge, state })}`;
test("native sign-in bridge requires app proof and preserves it through Google login", async ({
  page,
  context,
}) => {
  let privateReads = 0;
  await context.route(/\/api\/(journal|agent|images)/, (r) => {
    privateReads++;
    return r.abort();
  });
  await page.goto("/mobile");
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "Open sign-in from the Lift Journal iPhone app.",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
  await context.route("**/api/session", (r) =>
    r.fulfill({ json: { user: null } }),
  );
  let request: Record<string, unknown> | undefined;
  await context.route("**/api/auth/sign-in/social", (r) => {
    request = r.request().postDataJSON();
    return r.fulfill({ status: 403, json: { error: "Invitation required" } });
  });
  await page.goto(path);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Invitation required");
  expect(request).toEqual({
    provider: "google",
    callbackURL: path,
    errorCallbackURL: "/?signin=failed",
  });
  expect(privateReads).toBe(0);
});
test("native handoff requires an explicit connection and rejects an unexpected callback", async ({
  page,
  context,
}) => {
  await context.route("**/api/session", (r) =>
    r.fulfill({ json: { user: { id: "synthetic-native", name: "Alex" } } }),
  );
  let requests = 0;
  await context.route("**/api/mobile/authorize", (r) => {
    requests++;
    expect(r.request().headers()["x-journal-account"]).toBe("synthetic-native");
    expect(r.request().postDataJSON()).toEqual({ challenge, state });
    return r.fulfill({ json: { callback: "https://untrusted.example/token" } });
  });
  await page.goto(path);
  await expect(page.getByText("Continue as Alex.")).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Connect iPhone app" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "Start sign-in again from the app.",
  );
  expect(requests).toBe(1);
  expect(page.url()).toContain("/mobile?");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});
