import { test, expect, openJournalArea } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("four main destinations keep all journal areas accessible on phone and desktop", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobile.getByRole("link")).toHaveText([
    "Today",
    "Train",
    "Coach",
    "Journal",
  ]);
  await expect(
    page.getByRole("button", { name: "Log something", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Start workout", exact: false }),
  ).toBeInViewport();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`today-${width}.png`),
      fullPage: true,
    });
  }
  const desktop = page.getByRole("navigation", {
    name: "Primary",
    exact: true,
  });
  await expect(desktop.getByRole("link")).toHaveText([
    "Today",
    "Train",
    "Coach",
    "Journal",
  ]);
  await expect(mobile).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, hash] of [
    ["Food", "food"],
    ["Health", "health"],
    ["History", "history"],
    ["Progress", "progress"],
    ["Images", "images"],
    ["Cardio", "cardio"],
    ["Exercises", "library"],
  ]) {
    await openJournalArea(page, name);
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(
      mobile.getByRole("link", { name: "Journal", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#data$/);
  await mobile.getByRole("link", { name: "Today", exact: true }).click();
  await page
    .getByRole("button", { name: "Review my week", exact: true })
    .click();
  await expect(page).toHaveURL(/#journal\/week$/);
  await expect(page.locator(".week-stats")).toBeVisible();
  for (const alias of ["dashboard", "coach/today"]) {
    await page.goto(`/#${alias}`);
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
  }
});
