import { test, expect, browserUser } from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
import { streamingFixture, emit, type StreamWindow } from "./coach-stream";
import type { ActionPreview } from "../../lib/agent/actions";

for (const notifyResize of [true, false]) {
  test(`phone draft and Send stay visible when both viewport heights shrink (${notifyResize ? "resize event" : "delayed focus measurement"})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#coach");
    await expect(
      page.getByText("Ready to help", { exact: true }),
    ).toBeVisible();
    const composer = page.getByLabel("Message your coach");
    // Sync details and Undo occupied space in the reported phone screenshot.
    await page.evaluate(() => {
      const detail = document.createElement("div");
      detail.className = "save-detail";
      detail.textContent =
        "Cloud checked 13:03 · Device saved 08:03 · Undo last change";
      document.querySelector(".coach-mode .main")!.prepend(detail);
    });
    await composer.focus();
    await page.evaluate((notify) => {
      for (const [object, key, value] of [
        [window, "innerHeight", 390],
        [window.visualViewport!, "height", 390],
        [window.visualViewport!, "offsetTop", 45],
      ] as const) {
        Object.defineProperty(object, key, { configurable: true, value });
      }
      if (notify) window.dispatchEvent(new Event("resize"));
    }, notifyResize);
    await expect(page.locator("html")).toHaveAttribute(
      "data-keyboard-open",
      "",
    );
    await expect(page.locator(".coach-mode .topbar")).toBeHidden();
    await expect(page.locator(".coach-mode .save-detail").first()).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeHidden();
    const draft = "I ate three fried eggs for lunch. ".repeat(14);
    await composer.fill(draft);
    await composer.press("End");
    await composer.press("Shift+Enter");
    await composer.press("Z");
    await expect(composer).toHaveValue(/\nZ$/);
    await expect(composer).toHaveCSS("font-size", "17px");
    for (const target of [
      composer,
      page.getByRole("button", { name: "Send", exact: true }),
    ]) {
      const rect = await target.boundingBox();
      expect(rect!.y).toBeGreaterThanOrEqual(45);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(435);
    }
    expect((await composer.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    expect(
      await composer.evaluate((el: HTMLTextAreaElement) => el.selectionStart),
    ).toBe((await composer.inputValue()).length);
    await page.screenshot({
      path: testInfo.outputPath("coach-keyboard-draft.png"),
    });
    const retained = await composer.inputValue();
    await composer.blur();
    await page.evaluate(() => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 844,
      });
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        value: 844,
      });
      Object.defineProperty(window.visualViewport, "offsetTop", {
        configurable: true,
        value: 0,
      });
      window.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-keyboard-open",
    );
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeVisible();
    await expect(composer).toHaveValue(retained);
  });
}

test("a short initial viewport keeps Send stable between pointer-down and click", async ({
  page,
  context,
}) => {
  let submitted = "";
  await context.route("**/api/agent", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { enabled: true, turns: [] } });
    submitted = r.request().postDataJSON().message;
    return r.fulfill({ json: { reply: "Synthetic reply", proposals: [] } });
  });
  await page.setViewportSize({ width: 390, height: 360 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  await composer.focus();
  await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "");
  await composer.fill("Also eat 3 fried eggs");
  const send = page.getByRole("button", { name: "Send", exact: true });
  const rect = (await send.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "");
  expect((await send.boundingBox())!.y).toBeCloseTo(rect.y, 0);
  await page.mouse.up();
  await expect.poll(() => submitted).toBe("Also eat 3 fried eggs");
});

test("a reported meal shows a saved estimate and Undo without another reply or Save click", async ({
  page,
  context,
}) => {
  await streamingFixture(page);
  const state = emptyJournal();
  let revision = 0;
  const entry: ActionPreview = {
    id: crypto.randomUUID(),
    title: "Lunch saved",
    detail: "3 fried eggs. Portions and cooking oil are estimated.",
    workout: null,
    status: "saved",
    automatic: true,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    meal: {
      id: crypto.randomUUID(),
      date: today(),
      name: "Lunch",
      type: "lunch",
      source: "text",
      estimated: true,
      notes:
        "Assumed medium eggs and one teaspoon of cooking oil; correct this whenever you like.",
      photoIds: [],
      items: [
        {
          name: "Fried eggs",
          portion: "3 medium eggs, estimated 1 tsp oil",
          calories: 255,
          protein: 18,
          carbs: 1,
          fat: 20,
          classification: {
            foodGroups: ["eggs", "fats_oils"],
            ingredients: [
              { name: "egg", evidence: "reported" },
              { name: "cooking oil", evidence: "estimated" },
            ],
          },
        },
      ],
      createdAt: new Date().toISOString(),
    },
  };
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
  await context.route("**/api/journal", (r) =>
    r.fulfill({ json: { accountId: browserUser.id, state, revision } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page.getByLabel("Message your coach").fill("Also eat 3 fried eggs");
  await page.getByLabel("Message your coach").press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as StreamWindow).coachRequests.length,
      ),
    )
    .toBe(1);
  state.nutrition.meals = [entry.meal!];
  revision = 1;
  const runId = await page.evaluate(
    () => (window as unknown as StreamWindow).coachRequests[0].body.runId,
  );
  await emit(page, [
    { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
    {
      type: "RUN_FINISHED",
      threadId: "coach",
      runId,
      result: {
        reply:
          "Saved your lunch with estimated portions. You can correct it whenever you like.",
        proposals: [entry],
      },
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  const saved = page.getByRole("region", { name: "Saved journal entry" });
  await expect(
    saved.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Save this change" }),
  ).toHaveCount(0);
  await saved.locator("summary").click();
  await expect(saved).toContainText("Estimated nutrition");
  await expect(saved).toContainText("Assumed medium eggs");
  await expect(saved).toContainText("Assumed ingredient");
  expect(
    await page.evaluate(
      () => (window as unknown as StreamWindow).coachRequests.length,
    ),
  ).toBe(1);
});
