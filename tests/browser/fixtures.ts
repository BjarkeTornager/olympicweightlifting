import { test as base, expect, type Page } from "@playwright/test";
import { emptyJournal } from "../../lib/domain";
// Ordinary product workflows now require an authenticated account. Security
// tests import Playwright directly and never receive this mocked session.
export const browserUser = {
  id: "browser-test-account",
  name: "Synthetic athlete",
  email: "browser@example.test",
};
export const test = base.extend<{
  signedInJournal: void;
  mockSession: boolean;
}>({
  serviceWorkers: "block",
  mockSession: [true, { option: true }],
  signedInJournal: [
    async ({ context, mockSession }, use) => {
      if (!mockSession) {
        await use();
        return;
      }
      let state = emptyJournal(),
        revision = 0;
      const unmocked: string[] = [];
      await context.route("**/api/**", (r) => {
        unmocked.push(
          `${r.request().method()} ${new URL(r.request().url()).pathname}`,
        );
        return r.fulfill({ status: 401, json: { error: "Unmocked test API" } });
      });
      await context.route("**/api/tracking/status", (r) =>
        r.fulfill({ json: { notices: [], sleep: { connected: false } } }),
      );
      await context.route("**/api/health", (r) =>
        r.fulfill({ json: { status: "ok", version: "2.0.0", commit: null } }),
      );
      await context.route("**/api/maps/config", (r) =>
        r.fulfill({ json: { key: "test-maps-key" } }),
      );
      // Voice check-in stays hidden unless a test turns it on.
      await context.route("**/api/voice/session", (r) =>
        r.fulfill({ json: { enabled: false } }),
      );
      await context.route("**/api/lifting-videos", (r) =>
        r.fulfill({ json: { videos: [] } }),
      );
      await context.route("**/api/session", (r) =>
        r.fulfill({
          json: {
            user: browserUser,
            google: true,
            configured: true,
            localPassword: false,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        }),
      );
      await context.route("**/api/journal", (r) => {
        if (r.request().method() === "PUT") {
          state = r.request().postDataJSON().state;
          revision++;
        }
        return r.fulfill({
          json: { accountId: browserUser.id, state, revision },
        });
      });
      await context.route("**/api/agent", (r) =>
        r.fulfill({
          json: { enabled: true, provider: "Test provider", turns: [] },
        }),
      );
      await context.route("**/api/agent?turnId=*", (r) =>
        r.fulfill({ json: { turn: null } }),
      );
      await context.route(/\/api\/images(?:\?.*)?$/, (r) =>
        r.fulfill({ json: { images: [] } }),
      );
      await context.route(/\/api\/food\/photos(?:\?.*)?$/, (r) =>
        r.fulfill({ json: { photos: [] } }),
      );
      await use();
      expect(
        unmocked,
        "Every API used by this simulated account needs a fixture",
      ).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
export async function openJournalArea(page: Page, name: string) {
  await page.locator('nav a[href="#journal"]:visible').first().click();
  await page
    .getByRole("navigation", { name: "Journal destinations" })
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();
}
export async function openTodayOverview(page: Page) {
  await page.locator('nav a[href="#today"]:visible').first().click();
  const more = page.locator(".today-extra");
  if (!(await more.getAttribute("open"))) {
    // HTML boolean attributes are an empty string when present.
    if (await more.evaluate((el) => !(el as HTMLDetailsElement).open))
      await more.locator(":scope > summary").click();
  }
}
