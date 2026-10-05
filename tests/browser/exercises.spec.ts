import { test, expect, isJournalSave } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("gym library filters, aliases and attributed technique guides work on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const embeds: string[] = [];
  await page.route("https://www.youtube-nocookie.com/**", (r) => {
    embeds.push(r.request().url());
    return r.fulfill({
      contentType: "text/html",
      body: "<html lang='en'><title>Mock technique video</title><body>Video fixture</body></html>",
    });
  });
  await page.goto("/#library");
  await page.getByRole("button", { name: "Gym training", exact: true }).click();
  await page.getByLabel("Muscle group").selectOption("Chest");
  await page
    .getByRole("combobox", { name: "Equipment", exact: true })
    .selectOption("Dumbbells");
  await page
    .getByRole("searchbox", { name: "Search exercises" })
    .fill("DB bench");
  await expect(page.locator(".library-card")).toHaveCount(2);
  const card = page.locator(".library-card").filter({
    has: page.getByRole("heading", {
      name: "Dumbbell bench press",
      exact: true,
    }),
  });
  await expect(card.getByRole("heading")).toHaveText("Dumbbell bench press");
  expect(embeds).toEqual([]);
  await card.getByRole("button", { name: "Technique" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Instruction by PureGym/)).toBeVisible();
  await expect(dialog.getByText(/two 20 kg dumbbells = 40 kg/)).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: /Open YouTube/ }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=AduT4Eq-iP0");
  await expect(
    dialog.getByRole("link", { name: /PureGym guide/ }),
  ).toHaveAttribute(
    "href",
    "https://www.puregym.com/exercises/chest/bench-press/dumbbell-bench-press/",
  );
  await expect(dialog.locator("iframe")).toHaveAttribute(
    "src",
    /AduT4Eq-iP0\?rel=0&playsinline=1$/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByRole("searchbox", { name: "Search exercises" })
    .fill("zzzz missing");
  await expect(
    page.getByRole("heading", { name: "No exercises found." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all exercises" }).click();
  await expect(page.locator(".library-card")).toHaveCount(53);
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
});

test("a gym routine retains new exercises and logs after reload; changing search clears a pending selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#workout/choose");
  await page.getByRole("button", { name: "New routine" }).click();
  await page.getByLabel("Routine name").fill("Gym strength");
  await page
    .getByRole("searchbox", { name: "Find an exercise" })
    .fill("DB bench");
  await page
    .getByRole("combobox", { name: "Add exercise", exact: true })
    .selectOption("dumbbell_bench_press");
  await page.getByLabel("Set 1 · kg").fill("40");
  await expect(page.getByText(/two 20 kg dumbbells = 40 kg/)).toBeVisible();
  const routineSynced = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/journal") &&
      isJournalSave(r.request()) &&
      r.status() === 200,
  );
  await page.getByRole("button", { name: "Save routine", exact: true }).click();
  await routineSynced;
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await page
    .locator(".routine-list")
    .getByRole("button", { name: "Start", exact: true })
    .click();
  await page.getByLabel("Log set 1 as made", { exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Find an exercise or activity" })
    .fill("lat pull down");
  await page
    .getByRole("combobox", { name: "Add an exercise or activity", exact: true })
    .selectOption("lat_pulldown");
  const addButton = page.locator(".add-exercise").getByRole("button");
  await expect(addButton).toBeEnabled();
  await page
    .getByRole("searchbox", { name: "Find an exercise or activity" })
    .fill("hamstring curl");
  await expect(addButton).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Add an exercise or activity", exact: true })
    .selectOption("seated_leg_curl");
  const workoutSynced = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/journal") &&
      isJournalSave(r.request()) &&
      r.status() === 200 &&
      // The whole journal or only the changes: either names the exercise.
      r.request().postData()!.includes('"exerciseId":"seated_leg_curl"'),
  );
  await addButton.click();
  await workoutSynced;
  await expect(
    page.locator(".exercise-toggle").filter({ hasText: "Seated leg curl" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".exercise-toggle").filter({ hasText: "Seated leg curl" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const benchToggle = page
    .locator(".exercise-toggle")
    .filter({ hasText: "Dumbbell bench press" });
  if ((await benchToggle.getAttribute("aria-expanded")) !== "true")
    await benchToggle.click();
  await expect(
    page.getByLabel("Log set 1 as made", { exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("an exercise the library lacks is added as the athlete's own, then listed as theirs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#workout/choose");
  await page.getByRole("button", { name: "New routine" }).click();
  await page.getByLabel("Routine name").fill("Upper back");
  const search = page.getByRole("searchbox", { name: "Find an exercise" });
  // A library exercise, named in the plural, is offered as itself.
  await search.fill("front squats");
  await expect(
    page.locator("option", { hasText: /as a new exercise/ }),
  ).toHaveCount(0);
  await search.fill("standing  cable reverse fly");
  await expect(
    page.getByText("“Standing cable reverse fly” isn’t in the library."),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Add exercise", exact: true })
    .selectOption("custom:Standing cable reverse fly");
  await expect(
    page.getByRole("group", { name: "Standing cable reverse fly" }),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/journal") &&
      isJournalSave(r.request()) &&
      r.status() === 200 &&
      r
        .request()
        .postData()!
        .includes('"exerciseId":"custom:Standing cable reverse fly"'),
  );
  await page.getByRole("button", { name: "Save routine", exact: true }).click();
  await saved;
  await page.reload();
  await page
    .locator(".routine-list")
    .getByRole("button", { name: "Start", exact: true })
    .click();
  await expect(
    page
      .locator(".exercise-toggle")
      .filter({ hasText: "Standing cable reverse fly" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your own exercise. No demo video yet.").first(),
  ).toBeVisible();
  // Next time it is one of theirs, not new again.
  await page
    .getByRole("searchbox", { name: "Find an exercise or activity" })
    .fill("reverse fly");
  const add = page.getByRole("combobox", {
    name: "Add an exercise or activity",
    exact: true,
  });
  await expect(
    add.locator('optgroup[label="Your exercises"] option'),
  ).toHaveText(["Standing cable reverse fly"]);
  await expect(
    add.locator("option", { hasText: /as a new exercise/ }),
  ).toHaveCount(0);
});
