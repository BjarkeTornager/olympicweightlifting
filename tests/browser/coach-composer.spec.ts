import { test, expect, coachTask } from "./fixtures";

test("the composer stays simple: your words are sent as typed, and a task shows as a label", async ({
  page,
  context,
}, info) => {
  const requests: { message: string }[] = [];
  await context.route("**/api/agent", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({
        json: { enabled: true, provider: "Synthetic model", turns: [] },
      });
    requests.push(r.request().postDataJSON());
    return r.fulfill({
      json: { reply: "Synthetic reply.", proposals: [] },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ["Add images", "Send"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeInViewport();
      const bounds = (await button.boundingBox())!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height, `${name} at ${width}px`).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // No instruction is ever pasted into the message.
  await expect(composer).toHaveValue("");
  await expect(coachTask(page)).toHaveCount(0);
  await composer.fill("Back squat: 80 kg × 5, 90 kg × 5.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].message).toBe("Back squat: 80 kg × 5, 90 kg × 5.");
  await expect(
    page.getByText("Synthetic reply.", { exact: true }),
  ).toBeVisible();

  // A sleep link sets a task; the bubble shows its label and your words.
  await page.goto("/#coach/sleep");
  await expect(coachTask(page)).toHaveText("Logging sleep");
  await expect(composer).toHaveValue("");
  await expect(composer).toHaveAttribute(
    "placeholder",
    "How long did you sleep?",
  );
  await composer.fill("7 and a half hours");
  await page.screenshot({ path: info.outputPath("coach-task-mobile.png") });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].message).toMatch(
    /^Help me log my sleep\.[\s\S]*\n\n7 and a half hours$/,
  );
  const bubble = page.locator(".chat-user").last();
  await expect(bubble).toContainText("Logging sleep");
  await expect(bubble).toContainText("7 and a half hours");
  await expect(bubble).not.toContainText("Help me log my sleep");
  await expect(coachTask(page)).toHaveCount(0);

  // A task can be removed before sending.
  await page.goto("/#coach/cardio");
  await page.getByRole("button", { name: /^Remove: / }).click();
  await expect(coachTask(page)).toHaveCount(0);
});
