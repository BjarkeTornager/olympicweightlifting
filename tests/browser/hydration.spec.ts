import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("water is one tap from Today, adds up, can be undone and survives reload", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#today");
  const drinks = page.getByRole("region", { name: "Drinks today" });
  await expect(drinks).toContainText("Nothing yet");
  await expect(drinks).toContainText("0 L");
  await drinks.getByRole("button", { name: "+500 ml water" }).click();
  await drinks.getByRole("button", { name: "+250 ml water" }).click();
  await expect(drinks).toContainText("0.8 L");
  await expect(drinks).toContainText("2 logged");
  await expect(drinks.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "750",
  );
  await drinks.getByRole("button", { name: "Undo 250 ml" }).click();
  await expect(drinks).toContainText("0.5 L");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Drinks today" }),
  ).toContainText("0.5 L");
  const axe = await new AxeBuilder({ page })
    .include('[aria-label="Drinks today"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("drinks-today.png") });
});
