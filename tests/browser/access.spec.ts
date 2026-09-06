// Intentionally no authenticated fixture: these tests exercise the access gate.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal } from "../../lib/domain";
import { saveCheckin } from "../../lib/health";
const userA = {
  id: "privacy-account-a",
  name: "Private account A",
  email: "private-a@example.test",
};
const userB = {
  id: "privacy-account-b",
  name: "Private account B",
  email: "private-b@example.test",
};
const session = (user: typeof userA | null) => ({
  user,
  google: true,
  configured: true,
  localPassword: false,
  expiresAt: user ? new Date(Date.now() + 3600000).toISOString() : null,
});
const stateFor = (marker: string) => {
  const state = emptyJournal();
  saveCheckin(
    state,
    { date: "2026-09-06", notes: marker, sleepHours: 7.5 },
    "2026-09-06",
  );
  return state;
};
test.describe("private access boundaries", () => {
  test.use({ serviceWorkers: "block" });
  test("signed-out deep links and a forged cached identity never reveal records or request private APIs", async ({
    page,
    context,
  }, testInfo) => {
    let reads = 0,
      finish!: () => void;
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await context.route("**/api/session", async (r) => {
      await delayed;
      await r.fulfill({ json: session(null) });
    });
    await context.route(/\/api\/(journal|agent|images|food\/photos)/, (r) => {
      reads++;
      return r.fulfill({ status: 401, json: { error: "Unauthorized" } });
    });
    await page.addInitScript(
      ({ user, state }) => {
        localStorage.setItem("lift-cloud:identity", JSON.stringify(user));
        const request = indexedDB.open("lift-journal-cloud", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("journals", {
            keyPath: "accountId",
          });
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("journals", "readwrite");
          tx.objectStore("journals").put({
            accountId: user.id,
            state,
            revision: 1,
            seq: 1,
            dirty: true,
          });
          tx.oncomplete = () => db.close();
        };
      },
      { user: userA, state: stateFor("PRIVATE-CACHED-CHECKIN") },
    );
    await page.goto("/#history");
    await expect(page.locator(".public-landing")).toBeVisible();
    await expect(page.locator(".private-shell")).toHaveCount(0);
    await expect(
      page.getByText("PRIVATE-CACHED-CHECKIN", { exact: false }),
    ).toHaveCount(0);
    expect(reads).toBe(0);
    finish();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    for (const route of [
      "coach",
      "data",
      "health",
      "food",
      "images",
      "workout",
      "progress",
      "library",
      "history",
      "cardio",
      "coach/photo/00000000-0000-4000-8000-000000000000",
    ]) {
      await page.goto(`/#${route}`);
      await expect(
        page.getByRole("button", { name: "Continue with Google" }),
      ).toBeVisible();
      await expect(page.locator(".private-shell")).toHaveCount(0);
      expect(await page.locator("body").innerText()).not.toMatch(
        /PRIVATE-CACHED|private-a@example|Private account A/,
      );
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
    await page.screenshot({
      path: testInfo.outputPath("private-landing-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("private-landing-mobile.png"),
      fullPage: true,
    });
    expect(reads).toBe(0);
  });

  test("account switching never flashes another account’s cached profile or health data", async ({
    page,
    context,
  }) => {
    let active = userA;
    const records = {
      [userA.id]: stateFor("PRIVATE-A-ONLY"),
      [userB.id]: stateFor("PRIVATE-B-ONLY"),
    };
    await context.route("**/api/session", (r) =>
      r.fulfill({ json: session(active) }),
    );
    await context.route("**/api/journal", (r) =>
      r.fulfill({
        json: { accountId: active.id, state: records[active.id], revision: 1 },
      }),
    );
    await context.route("**/api/images**", (r) =>
      r.fulfill({ json: { images: [] } }),
    );
    await page.goto("/#health");
    await expect(
      page.getByText("PRIVATE-A-ONLY", { exact: true }),
    ).toBeVisible();
    active = userB;
    await page.addInitScript(() => {
      (window as Window & { privateFlash?: boolean }).privateFlash = false;
      new MutationObserver(() => {
        if (document.body?.innerText.includes("PRIVATE-A-ONLY"))
          (window as Window & { privateFlash?: boolean }).privateFlash = true;
      }).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
    });
    await page.reload();
    await expect(
      page.getByText("PRIVATE-B-ONLY", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("PRIVATE-A-ONLY", { exact: false }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as Window & { privateFlash?: boolean }).privateFlash,
      ),
    ).toBe(false);
  });

  test("revocation and sign-out remove private views and confirmed device copies, including browser back", async ({
    page,
    context,
  }) => {
    let signedIn = true;
    await context.route("**/api/session", (r) =>
      r.fulfill({ json: session(signedIn ? userA : null) }),
    );
    await context.route("**/api/journal", (r) =>
      r.fulfill(
        signedIn
          ? {
              json: {
                accountId: userA.id,
                state: stateFor("PRIVATE-SESSION-ONLY"),
                revision: 1,
              },
            }
          : { status: 401, json: { error: "Session revoked" } },
      ),
    );
    await context.route("**/api/images**", (r) =>
      r.fulfill({ json: { images: [] } }),
    );
    await context.route("**/api/auth/sign-out", (r) => {
      signedIn = false;
      return r.fulfill({ json: { success: true } });
    });
    await page.goto("/#health");
    await expect(
      page.getByText("PRIVATE-SESSION-ONLY", { exact: true }),
    ).toBeVisible();
    signedIn = false;
    await page
      .getByRole("button", { name: "All changes synced", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(page.locator(".private-shell")).toHaveCount(0);
    signedIn = true;
    await page.goto("/#data");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Make yourself at home." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All changes synced", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(async (accountId) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("lift-journal-cloud", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return new Promise<boolean>((resolve) => {
            const request = db
              .transaction("journals")
              .objectStore("journals")
              .get(accountId);
            request.onsuccess = () => {
              resolve(Boolean(request.result));
              db.close();
            };
          });
        }, userA.id),
      )
      .toBe(false);
    await page.goBack();
    await expect(page.locator(".public-landing")).toBeVisible();
    await expect(
      page.getByText("PRIVATE-SESSION-ONLY", { exact: false }),
    ).toHaveCount(0);
  });

  test("expired sessions and offline cold starts cannot unlock a stored journal", async ({
    page,
    context,
  }) => {
    let expired = false;
    await context.route("**/api/session", (r) =>
      r.fulfill({
        json: {
          ...session(userA),
          expiresAt: new Date(
            Date.now() + (expired ? -1000 : 3600000),
          ).toISOString(),
        },
      }),
    );
    await context.route("**/api/journal", (r) =>
      r.fulfill({
        json: {
          accountId: userA.id,
          state: stateFor("PRIVATE-EXPIRY-ONLY"),
          revision: 1,
        },
      }),
    );
    await context.route("**/api/images**", (r) =>
      r.fulfill({ json: { images: [] } }),
    );
    await page.goto("/#health");
    await expect(
      page.getByText("PRIVATE-EXPIRY-ONLY", { exact: true }),
    ).toBeVisible();
    expired = true;
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(page.locator(".private-shell")).toHaveCount(0);
    await context.route("**/api/session", (r) =>
      r.abort("internetdisconnected"),
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Check connection" }),
    ).toBeVisible();
    await expect(page.locator(".private-shell")).toHaveCount(0);
    await expect(
      page.getByText("PRIVATE-EXPIRY-ONLY", { exact: false }),
    ).toHaveCount(0);
  });
});
