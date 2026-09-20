import { test, expect, browserUser } from "./fixtures";
import { emptyJournal, createWorkout, days, today } from "../../lib/domain";
import { offsetDate, saveCheckin } from "../../lib/health";
import { saveTrainingProgram } from "../../lib/training-programs";

const sequence = days.filter((d) => d.weekday !== null);

test("choosing a custom programme changes Today without starting a workout until tapped", async ({
  page,
  context,
}) => {
  let state = emptyJournal(),
    revision = 0;
  const plan = saveTrainingProgram(state, {
    name: "My strength sequence",
    days: [
      {
        name: "Lower strength",
        exercises: [{ exerciseId: "back_squat", sets: 3, reps: 5, weight: 40 }],
      },
    ],
  });
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.goto("/#workout/choose");
  await page
    .getByRole("button", { name: "Use this programme", exact: true })
    .click();
  await expect.poll(() => state.program.activeProgramId).toBe(plan.id);
  expect(state.activeWorkout).toBeNull();
  await page.locator('nav a[href="#today"]:visible').first().click();
  const suggestion = page.getByRole("region", { name: "Suggested session" });
  await expect(suggestion).toContainText("Lower strength");
  await suggestion
    .getByRole("button", { name: "Start workout", exact: true })
    .click();
  await expect.poll(() => state.activeWorkout?.programId).toBe(plan.id);
  expect(state.activeWorkout?.exercises[0].sets[0].logged).toBeFalsy();
});

test("Today suggests the next recorded programme session and resumes the same draft", async ({
  page,
  context,
}) => {
  let state = emptyJournal(),
    revision = 0;
  const last = createWorkout(state, sequence[0], offsetDate(today(), -4));
  Object.assign(last.exercises[0].sets[0], {
    weight: 40,
    reps: 3,
    logged: true,
    result: "success",
  });
  state.sessions.push(last);
  saveCheckin(state, { date: today(), sleepHours: 7.5 }, today());
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  await page.goto("/");
  const suggestion = page.getByRole("region", { name: "Suggested session" });
  await expect(suggestion).toContainText(sequence[1].title);
  await expect(
    page.getByRole("region", { name: "Today's food and sleep" }),
  ).toContainText("7 h 30 min");
  expect(revision).toBe(0);
  await suggestion
    .getByRole("button", { name: "Start workout", exact: true })
    .click();
  await expect(page).toHaveURL(/#workout$/);
  await expect
    .poll(() => state.activeWorkout?.programDayId)
    .toBe(sequence[1].id);
  const id = state.activeWorkout!.id;
  expect(
    state.activeWorkout!.exercises.every((e) => e.sets.every((s) => !s.logged)),
  ).toBe(true);
  await page.locator('nav a[href="#today"]:visible').first().click();
  await suggestion
    .getByRole("button", { name: "Resume workout", exact: true })
    .click();
  expect(state.activeWorkout!.id).toBe(id);
  expect(state.sessions).toHaveLength(1);
});

test("Today exposes import failures and opens sleep setup without claiming a successful connection", async ({
  page,
  context,
}) => {
  await context.route("**/api/tracking/status", (r) =>
    r.fulfill({
      json: {
        notices: [
          {
            code: "sleep_failed",
            message: "Your latest sleep import failed. Check the connection.",
            route: "data/sleep",
          },
        ],
        sleep: { connected: true, lastDate: null },
      },
    }),
  );
  await context.route("**/api/integrations/apple-health", (r) =>
    r.fulfill({
      json: { connected: true, lastResult: "failed", lastSyncAt: null },
    }),
  );
  await context.route("**/api/reminders", (r) =>
    r.fulfill({
      json: {
        configured: false,
        enabled: false,
        publicKey: null,
        preferences: {
          time: "20:00",
          timezone: "Europe/Copenhagen",
          topics: ["food"],
        },
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("status").filter({ hasText: "sleep import failed" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Apple Health · waiting for the first import",
    })
    .click();
  await expect(page).toHaveURL(/#data\/sleep$/);
  await expect(
    page.getByRole("heading", { name: "Sleep from Apple Health" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "3. Test & automate" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Creating a key alone" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh sync status" }).click();
  await expect(
    page.getByRole("heading", { name: "Test before automating" }),
  ).toBeVisible();
});
