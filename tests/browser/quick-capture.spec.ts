import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today } from "../../lib/domain";
import { mealSchema } from "../../lib/nutrition";
import { offsetDate } from "../../lib/health";
import sharp from "sharp";

test("quick capture is reachable on phones, preserves a draft and can repeat and undo a usual meal", async ({
  page,
  context,
}, info) => {
  let state = emptyJournal(),
    revision = 0;
  const meal = mealSchema.parse({
    id: crypto.randomUUID(),
    date: offsetDate(today(), -1),
    name: "Morning oats",
    type: "breakfast",
    source: "manual",
    estimated: true,
    items: [
      {
        name: "Oats",
        portion: "One bowl",
        calories: 300,
        protein: 10,
        carbs: 45,
        fat: 8,
      },
    ],
    createdAt: new Date().toISOString(),
  });
  state.nutrition.meals.push(meal);
  state.nutrition.completeDays = [today()];
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  const log = page.getByRole("button", { name: "Log something", exact: true });
  await expect(log).toBeInViewport();
  const input = page.getByRole("textbox", { name: "Message your coach" });
  await input.fill("Slept seven hours and had oats.");
  await log.click();
  const dialog = page.getByRole("dialog", { name: "Log something" });
  await expect(
    dialog.getByLabel("Photograph my meal", { exact: true }),
  ).toBeAttached();
  await expect(
    dialog.getByRole("button", { name: "Type or dictate" }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "I ate this: Morning oats" }),
  ).toBeInViewport();
  expect(
    (
      await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("quick-capture-phone.png") });
  await dialog
    .getByRole("button", { name: "I ate this: Morning oats" })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Morning oats added to today.",
  );
  await expect.poll(() => state.nutrition.meals.length).toBe(2);
  expect(state.nutrition.meals[1].date).toBe(today());
  expect(state.nutrition.meals[1].items).toEqual(meal.items);
  expect(state.nutrition.completeDays).not.toContain(today());
  await dialog.getByRole("button", { name: "Undo meal", exact: true }).click();
  await expect.poll(() => state.nutrition.meals.length).toBe(1);
  await dialog.getByRole("button", { name: "Type or dictate" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveValue("Slept seven hours and had oats.");
  await expect(input).toBeFocused();
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "OPEN_CAPTURE" },
        origin: location.origin,
      }),
    ),
  );
  await expect(
    page.getByRole("dialog", { name: "Log something" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Log something" })
    .getByRole("button", { name: "Type or dictate" })
    .click();
  await expect(input).toHaveValue("Slept seven hours and had oats.");
});

test("meal camera attaches a photo with logging intent without silently sending an existing draft", async ({
  page,
  context,
}) => {
  const pixels = await sharp({
    create: { width: 180, height: 180, channels: 3, background: "#adcca7" },
  })
    .jpeg()
    .toBuffer();
  const id = crypto.randomUUID();
  let uploads = 0,
    messages = 0;
  await context.route("**/api/images", (r) => {
    if (r.request().method() !== "POST")
      return r.fulfill({ json: { images: [] } });
    uploads++;
    return r.fulfill({
      json: {
        id,
        label: "Uploaded image",
        date: today(),
        bytes: pixels.length,
        createdAt: new Date().toISOString(),
        version: 1,
        category: "food",
        classification: {
          status: "ready",
          confidence: "high",
          source: "automatic",
          tags: ["meal"],
        },
      },
    });
  });
  await context.route(`**/api/images/${id}`, (r) =>
    r.fulfill({ body: pixels, contentType: "image/jpeg" }),
  );
  await context.route("**/api/agent", (r) => {
    if (r.request().method() === "POST") messages++;
    return r.fulfill({ json: { enabled: true, turns: [] } });
  });
  await page.goto("/#coach/capture");
  await page.getByLabel("Photograph my meal", { exact: true }).setInputFiles({
    name: "meal.jpg",
    mimeType: "image/jpeg",
    buffer: pixels,
  });
  await expect(page.getByRole("dialog", { name: "Log something" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("textbox", { name: "Message your coach" }),
  ).toHaveValue(/Log the attached photo as my meal/);
  await expect.poll(() => uploads).toBe(1);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  expect(messages).toBe(0);
});

test("tracking setup is opt-in, reports unavailable push and shows a key once with revocation", async ({
  page,
  context,
}, info) => {
  let connected = false,
    creates = 0,
    disconnects = 0;
  const token = `lh_${"a".repeat(43)}`;
  await context.route("**/api/reminders", (r) =>
    r.fulfill({
      json: {
        configured: false,
        publicKey: null,
        enabled: false,
        preferences: {
          time: "20:00",
          timezone: "Europe/Copenhagen",
          topics: ["food", "sleep", "workout"],
        },
        lastStatus: null,
      },
    }),
  );
  await context.route("**/api/integrations/apple-health", (r) => {
    if (r.request().method() === "POST") {
      creates++;
      connected = true;
      return r.fulfill({ json: { token } });
    }
    if (r.request().method() === "DELETE") {
      disconnects++;
      connected = false;
    }
    return r.fulfill({ json: { connected, lastSyncAt: null } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#data");
  await page
    .getByRole("button", { name: "Reminders & Apple Health", exact: true })
    .click();
  await expect(
    page.getByText("Reminder is off.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable reminder on this device" }),
  ).toBeDisabled();
  expect(creates).toBe(0);
  await page.getByRole("button", { name: "Create sleep import key" }).click();
  await expect(page.getByLabel("Sleep import key — shown once")).toHaveValue(
    token,
  );
  await expect(
    page.getByText("Key created. Waiting for your first successful import."),
  ).toBeVisible();
  await page.getByText("Set up the iPhone Shortcut", { exact: true }).click();
  await expect(page.getByLabel("Sleep import endpoint")).toHaveValue(
    /\/api\/integrations\/apple-health\/sleep$/,
  );
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("sleep-connection.png") });
  await page.reload();
  await page
    .getByRole("button", { name: "Reminders & Apple Health", exact: true })
    .click();
  await expect(page.getByLabel("Sleep import key — shown once")).toHaveCount(0);
  await page.getByRole("button", { name: "Disconnect Apple Health" }).click();
  await expect(
    page.getByText(
      "Disconnected. Previously imported sleep stays in your journal.",
    ),
  ).toBeVisible();
  expect(disconnects).toBe(1);
});

test("push permission is requested only on enable; denial stays off; saving and disabling are explicit", async ({
  page,
  context,
}) => {
  const publicKey = "B" + "a".repeat(86);
  await context.addInitScript(() => {
    const fake = {
      permission: "default",
      requests: 0,
      requestPermission: async () => {
        fake.requests++;
        return fake.permission;
      },
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: fake,
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener() {},
        removeEventListener() {},
        register: async () => ({ addEventListener() {} }),
        getRegistration: async () => ({
          active: true,
          pushManager: {
            getSubscription: async () => ({
              toJSON: () => ({
                endpoint: "https://web.push.apple.com/synthetic",
                keys: { p256dh: "B" + "a".repeat(86), auth: "a".repeat(22) },
              }),
            }),
          },
        }),
      },
    });
  });
  let enabled = false,
    saves = 0;
  await context.route("**/api/reminders", (r) => {
    if (r.request().method() === "PUT") {
      saves++;
      enabled = true;
      expect(r.request().postDataJSON().preferences.time).toBe("19:30");
    }
    if (r.request().method() === "DELETE") enabled = false;
    return r.fulfill({
      json: {
        configured: true,
        publicKey,
        enabled,
        preferences: { time: "20:00", timezone: "UTC", topics: ["food"] },
        lastStatus: null,
      },
    });
  });
  await context.route("**/api/integrations/apple-health", (r) =>
    r.fulfill({ json: { connected: false } }),
  );
  await page.goto("/#data");
  await page
    .getByRole("button", { name: "Reminders & Apple Health", exact: true })
    .click();
  const requests = () =>
    page.evaluate(
      () => (window.Notification as unknown as { requests: number }).requests,
    );
  expect(await requests()).toBe(0);
  await page
    .getByRole("button", { name: "Enable reminder on this device" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "One gentle reminder" })
      .getByRole("alert"),
  ).toContainText("Notifications are off");
  expect(saves).toBe(0);
  await page.evaluate(() => {
    (window.Notification as unknown as { permission: string }).permission =
      "granted";
  });
  await page.getByLabel("Reminder time", { exact: true }).fill("19:30");
  await page
    .getByRole("button", { name: "Enable reminder on this device" })
    .click();
  await expect(
    page.getByText("Reminder is on.", { exact: true }),
  ).toBeVisible();
  expect(saves).toBe(1);
  await page.getByRole("button", { name: "Turn off reminders" }).click();
  await expect(
    page.getByText("Reminders turned off on all devices.", { exact: true }),
  ).toBeVisible();
  expect(enabled).toBe(false);
});
