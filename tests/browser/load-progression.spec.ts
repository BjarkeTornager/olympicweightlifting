import {
  test,
  expect,
  browserUser,
  isJournalSave,
  savedJournal,
} from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import {
  createWorkout,
  days,
  emptyJournal,
  finishWorkout,
  today,
} from "../../lib/domain";
import type { JournalState } from "../../lib/model";

const daysAgo = (n: number) => {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// A 16-year-old who trained Monday's programme two and one weeks ago: the
// snatch made at 60 kg with RPE 8, the snatch pull at 80 kg ending in a miss
// both times. Last night was 5 h 30 min.
function journal() {
  const monday = days.find((d) => d.id === "monday")!;
  let state = emptyJournal();
  state.profile.age = 16;
  for (const date of [daysAgo(14), daysAgo(7)]) {
    state.activeWorkout = createWorkout(state, monday, date);
    state.activeWorkout.exercises = state.activeWorkout.exercises.slice(0, 2);
    state.activeWorkout.exercises.forEach((entry, i) => {
      const weight = [60, 80][i];
      entry.prescribed.targetWeight = weight;
      entry.sets.forEach((s) =>
        Object.assign(s, {
          weight: String(weight),
          rpe: "8",
          result: "success",
          logged: true,
        }),
      );
    });
    state.activeWorkout.exercises[1].sets[3].result = "miss";
    state = finishWorkout(state);
  }
  state.health.checkins.push({
    date: today(),
    sleepHours: 5.5,
    energy: null,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "",
    updatedAt: new Date().toISOString(),
  } as JournalState["health"]["checkins"][number]);
  state.activeWorkout = createWorkout(state, monday, today());
  return state;
}

test("a short night, the under-18 technique check and a proposed reset are one tap each", async ({
  page,
  context,
}) => {
  let state = journal(),
    revision = 0;
  await context.route("**/api/journal", (r) => {
    if (isJournalSave(r.request())) {
      state = savedJournal(r.request(), state);
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  const snatch = () => state.activeWorkout!.exercises[0];
  const pull = () => state.activeWorkout!.exercises[1];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#workout");
  const snatchCard = page.locator(".exercise-card").first();
  await expect(snatchCard.locator(".exercise-toggle small")).toHaveText(
    "6 sets × 1 reps · 60 kg",
  );
  // Rest for the snatch starts at 3 minutes, by exercise type.
  await expect(page.getByLabel("Rest duration", { exact: true })).toHaveValue(
    "180",
  );

  const check = page.getByLabel(/My coach checked my technique today/);
  await expect(check).not.toBeChecked();
  await check.click();
  await expect(check).toBeChecked();
  await expect.poll(() => snatch().sets[0].weight).toBe("62");
  await expect(snatchCard.locator(".exercise-toggle small")).toHaveText(
    "6 sets × 1 reps · 62 kg",
  );

  await expect(
    page.getByText(/^You slept 5 h 30 min before this session\./),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hold loads today", exact: true })
    .click();
  await expect.poll(() => state.activeWorkout!.recovery).toBe("limited");
  await expect(snatchCard.locator(".exercise-toggle small")).toHaveText(
    "6 sets × 1 reps · 60 kg",
  );
  await expect(page.getByText(/^You slept/)).toBeHidden();

  await page.locator(".exercise-toggle", { hasText: "Snatch pull" }).click();
  await expect(page.getByText(/reset to about 90%: 72 kg/)).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Reset to 72 kg", exact: true })
    .click();
  await expect.poll(() => pull().prescribed.targetWeight).toBe(72);
  expect(pull().sets.map((s) => s.weight)).toEqual(["72", "72", "72", "72"]);
  await expect(
    page.getByRole("button", { name: "Reset to 72 kg", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByLabel("Set 1 weight in kilograms", { exact: true }),
  ).toHaveValue("72");
});

test("Settings offers rest by exercise type as the default", async ({
  page,
}) => {
  await page.goto("/#data");
  const rest = page.getByRole("combobox", {
    name: "Default rest timer",
    exact: true,
  });
  await expect(rest).toHaveValue("");
  await expect(rest.locator("option:checked")).toHaveText("By exercise type");
  await rest.selectOption("120");
  await expect(rest).toHaveValue("120");
  await rest.selectOption("");
  await expect(rest).toHaveValue("");
});
