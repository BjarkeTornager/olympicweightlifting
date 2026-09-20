import { test, expect, browserUser, openJournalArea } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import {
  createWorkout,
  days,
  emptyJournal,
  exerciseName,
  today,
} from "../../lib/domain";
import type { BrowserContext } from "@playwright/test";

async function activeWorkout(context: BrowserContext) {
  let state = emptyJournal(),
    revision = 0;
  state.activeWorkout = createWorkout(
    state,
    days.find((d) => d.id === "monday"),
    today(),
  );
  const workoutId = state.activeWorkout.id;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  return { current: () => state, workoutId };
}

test("Train starts simply and the next set is visible without scrolling on phones", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#workout");
  await expect(
    page.getByRole("button", { name: "Start workout", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Choose another", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Take activity photo", exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: info.outputPath("clean-train-mobile.png") });
  await page
    .getByRole("button", { name: "Choose another", exact: true })
    .click();
  await expect(page).toHaveURL(/#workout\/choose$/);
  await expect(
    page.getByRole("button", { name: "New routine", exact: true }),
  ).toBeVisible();
  await page.goto("/#workout/monday");
  await page
    .getByRole("button", { name: "Start this programme", exact: true })
    .click();
  await expect(page.locator(".sync-status.synced")).toBeVisible();
  for (const width of [320, 390, 768, 900, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const input = page.getByLabel("Set 1 weight in kilograms", { exact: true });
    const log = page.getByRole("button", {
      name: "Log set 1 as made",
      exact: true,
    });
    await expect(input).toBeInViewport();
    await expect(log).toBeInViewport();
    const bounds = (await log.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThan(750);
    await expect(
      page.getByRole("navigation", {
        name: width > 768 ? "Primary" : "Mobile navigation",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Take activity photo", exact: true }),
    ).toBeHidden();
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(a11y.violations).toEqual([]);
    if (width === 768) {
      const nav = page.getByRole("navigation", { name: "Mobile navigation" });
      await openJournalArea(page, "Food");
      await expect(nav).toBeVisible();
      await nav.getByRole("link", { name: "Train", exact: true }).click();
      await expect(input).toBeInViewport();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("clean-workout-mobile.png") });
});

test("focused sets preserve exact loads, explicit misses, correction, Undo, reload and partial completion", async ({
  page,
  context,
}) => {
  const fixture = await activeWorkout(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#workout");
  await page
    .getByLabel("Set 1 weight in kilograms", { exact: true })
    .fill("47.5");
  const first = page.getByRole("button", {
    name: "Log set 1 as made",
    exact: true,
  });
  await first.focus();
  await first.press("Enter");
  await expect(page.getByText("Set 2 of 6", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log set 2 as made", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByLabel("Set 2 weight in kilograms", { exact: true }),
  ).toHaveValue("47.5");
  await page.getByLabel("Set 2 missed", { exact: true }).click();
  await expect(page.getByText("Set 3 of 6", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.getByText("Set 2 of 6", { exact: true })).toBeVisible();
  await page.getByLabel("Set 2 missed", { exact: true }).click();
  await expect(page.locator(".sync-status.synced")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Set 3 of 6", { exact: true })).toBeVisible();
  await page.locator(".other-workout-sets > summary").click();
  const correctedWeight = page.getByLabel("Set 1 weight in kilograms", {
    exact: true,
  });
  await correctedWeight.fill("");
  await correctedWeight.pressSequentially("45.5");
  await expect(correctedWeight).toBeFocused();
  await expect(correctedWeight).toHaveValue("45.5");
  await expect(
    page.getByRole("button", { name: "Log set 1 as made", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "Log set 1 as made", exact: true })
    .click();
  await page.locator(".other-workout-sets > summary").click();
  await expect(page.locator(".sync-status.synced")).toBeVisible();
  const draft = fixture.current().activeWorkout!;
  expect(draft.id).toBe(fixture.workoutId);
  await expect
    .poll(() =>
      fixture
        .current()
        .activeWorkout!.exercises[0].sets.slice(0, 3)
        .map((s) => [Number(s.weight), s.result]),
    )
    .toEqual([
      [45.5, "success"],
      [47.5, "miss"],
      [45.5, ""],
    ]);
  expect(fixture.current().sessions).toHaveLength(0);
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Coach", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Train", exact: true })
    .click();
  await expect(page.getByText("Set 3 of 6", { exact: true })).toBeVisible();
  await page
    .locator(".workout-heading")
    .getByRole("button", { name: "Finish workout", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep current PRs", exact: true })
    .click();
  await expect(page.locator(".sync-status.synced")).toBeVisible();
  await expect.poll(() => fixture.current().activeWorkout).toBeNull();
  expect(fixture.current().sessions).toHaveLength(1);
  expect(
    fixture.current().sessions[0].exercises.flatMap((e) => e.sets),
  ).toHaveLength(2);
});

test("workout controls stay usable with larger text and session options remain available", async ({
  page,
  context,
}) => {
  await activeWorkout(context);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/#data");
  await page.getByLabel("Larger text").click();
  await expect(page.getByLabel("Larger text")).toBeChecked();
  await expect(page.locator(".sync-status.synced")).toBeVisible();
  await page.goto("/#workout");
  await expect(
    page.getByRole("button", { name: "Log set 1 as made", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.locator(".session-details > summary").click();
  await expect(
    page.getByRole("combobox", { name: "Recovery today", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take activity photo", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep training", exact: true })
    .click();
  await expect(page.locator(".focus-set")).toBeVisible();
});

test("resuming opens the next unfinished exercise without completing the workout", async ({
  page,
  context,
}) => {
  const fixture = await activeWorkout(context);
  const draft = fixture.current().activeWorkout!;
  for (const set of draft.exercises[0].sets) {
    set.weight = 45;
    set.result = "success";
    set.logged = true;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#workout");
  const currentExercise = page.locator(
    ".exercise-card.expanded .exercise-toggle strong",
  );
  await expect(currentExercise).toHaveText(
    exerciseName(draft.exercises[1].exerciseId),
  );
  await page.getByLabel("Rest duration", { exact: true }).selectOption("120");
  await page.getByRole("button", { name: "Start rest", exact: true }).click();
  await page.locator(".exercise-toggle").first().click();
  await expect(page.getByLabel("Rest duration", { exact: true })).toHaveValue(
    "120",
  );
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset rest timer", exact: true })
    .click();
  await expect(page.locator(".timer-digits")).toHaveText("2:00");
  await page.reload();
  await expect(currentExercise).toHaveText(
    exerciseName(draft.exercises[1].exerciseId),
  );
  expect(fixture.current().activeWorkout?.id).toBe(fixture.workoutId);
  expect(fixture.current().sessions).toHaveLength(0);
});
