import { test, expect } from "./fixtures";

test("Add workout keeps the user in Coach, preserves reported sets, and submits only on Send", async ({
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
      json: { reply: "Synthetic workout reply.", proposals: [] },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message your coach");
  const shortcut = page.getByRole("button", {
    name: "Add workout",
    exact: true,
  });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of [
      "Add workout",
      "Log food",
      "Log sleep",
      "Add images",
      "Send",
    ]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeInViewport();
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
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
  await shortcut.click();
  await expect(composer).toBeFocused();
  expect(requests).toHaveLength(0);
  await expect(page).toHaveURL(/#coach$/);
  await composer.fill("Back squat: 80 kg × 5, 90 kg × 5. I am still training.");
  await shortcut.click();
  await expect(composer).toHaveValue(
    /^Back squat: 80 kg × 5, 90 kg × 5\. I am still training\./,
  );
  await expect(composer).toBeFocused();
  expect(requests).toHaveLength(0);
  await page.screenshot({
    path: info.outputPath("coach-add-workout-mobile.png"),
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].message).toContain("80 kg × 5, 90 kg × 5");
  expect(requests[0].message).toContain("I am still training.");
  expect(requests[0].message).toContain("Please log this workout.");
  await expect(
    page.getByText("Synthetic workout reply.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#coach$/);
});
