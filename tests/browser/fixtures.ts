import { test as base, expect } from "@playwright/test";
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
      await context.route("**/api/images", (r) =>
        r.fulfill({ json: { images: [] } }),
      );
      await context.route("**/api/food/photos", (r) =>
        r.fulfill({ json: { photos: [] } }),
      );
      await use();
    },
    { auto: true },
  ],
});
export { expect };
