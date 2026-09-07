import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("mobile destinations and More keep every journal area accessible, with focus restoration", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobile.getByRole("link")).toHaveText([
    "Coach",
    "Train",
    "Food",
    "Health",
  ]);
  await expect(page.getByLabel("Message your coach")).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("coach-start-mobile.png"),
  });
  for (const destination of ["Train", "Food", "Health"]) {
    await mobile.getByRole("link", { name: destination, exact: true }).click();
    await expect(
      mobile.getByRole("link", { name: destination, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.screenshot({
      path: testInfo.outputPath(`${destination.toLowerCase()}-mobile.png`),
    });
  }
  const more = mobile.getByRole("button", { name: "More", exact: true });
  await more.click();
  const dialog = page.getByRole("dialog", {
    name: "Your journal",
    exact: true,
  });
  await expect(dialog.getByRole("link")).toHaveCount(7);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("journal-menu-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  for (const [name, hash] of [
    ["History", "history"],
    ["Progress", "progress"],
    ["Images", "images"],
    ["Cardio", "cardio"],
    ["Exercises", "library"],
    ["Home", "dashboard"],
    ["Settings", "data"],
  ]) {
    await more.click();
    await dialog.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(more).toBeInViewport();
    if (hash === "cardio")
      await expect(
        mobile.getByRole("link", { name: "Train", exact: true }),
      ).toHaveAttribute("aria-current", "page");
  }
  await mobile.getByRole("link", { name: "Coach", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktop = page.getByRole("navigation", {
    name: "Primary",
    exact: true,
  });
  await expect(desktop.getByRole("link")).toHaveCount(11);
  await expect(
    desktop.getByRole("link", { name: "Settings", exact: true }),
  ).toBeInViewport();
  await expect(mobile).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("coach-start-desktop.png"),
  });
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("today-desktop.png") });
});
