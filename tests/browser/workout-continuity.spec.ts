import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext } from "@playwright/test";
import { emptyJournal, today } from "../../lib/domain";
import { prepareAction } from "../../lib/agent/actions";
import type { JournalState } from "../../lib/model";
const date = today();
const workout = {
  title: "Lower body partial",
  date,
  category: "accessories",
  notes: "Squats next.",
  exercises: [
    {
      exerciseId: "romanian_deadlift",
      sets: [
        { weight: 60, reps: 10, result: "success" },
        { weight: 60, reps: 10, result: "success" },
      ],
    },
  ],
};
async function fixture(
  context: BrowserContext,
  initial: JournalState,
  prepared?: ReturnType<typeof prepareAction>,
) {
  let state = initial,
    revision = 1;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  if (prepared) {
    const proposal = {
      id: crypto.randomUUID(),
      title: prepared.title,
      detail: prepared.detail,
      workout: prepared.workout,
      workoutReview: prepared.workoutReview,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await context.route("**/api/agent", (r) =>
      r.fulfill({
        json: {
          enabled: true,
          provider: "Synthetic",
          turns: [
            {
              id: crypto.randomUUID(),
              question: "I have logged my deadlifts, squats next.",
              reply: "Ready for your review.",
              status: "done",
              proposals: [proposal],
            },
          ],
        },
      }),
    );
    await context.route("**/api/agent/action", (r) => {
      state = structuredClone(
        r.request().postDataJSON().undo ? initial : prepared.state,
      );
      revision++;
      return r.fulfill({
        json: {
          accountId: browserUser.id,
          state,
          revision,
          status: r.request().postDataJSON().undo ? "undone" : "saved",
        },
      });
    });
  }
  return () => state;
}
function splitState() {
  let state = prepareAction(
    emptyJournal(),
    { kind: "record_session", workout },
    date,
  ).state;
  state = prepareAction(
    state,
    {
      kind: "record_session",
      separateSession: true,
      workout: {
        ...workout,
        title: "Lower body final",
        notes: "Finished.",
        exercises: [
          {
            exerciseId: "back_squat",
            sets: [{ weight: 110, reps: 6, result: "success" }],
          },
        ],
      },
    },
    date,
  ).state;
  return state;
}

test("Train exposes ongoing, programs and history on mobile; completed sets still link to the active workout", async ({
  page,
  context,
}) => {
  const initial = emptyJournal();
  const prepared = prepareAction(
    initial,
    { kind: "log_workout_progress", workout, completion: "ongoing" },
    date,
  );
  const current = await fixture(context, initial, prepared);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(
    page.getByText("Ongoing · continue in Train", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save this change", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue workout" }).click();
  await expect(
    page.getByRole("heading", { name: "Lower body partial", exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Training navigation" });
  await nav.getByRole("link", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Training history", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume ongoing workout" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Train", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(current().sessions).toHaveLength(0);
  await nav.getByRole("link", { name: "Programs", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume workout", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume workout", exact: true })
    .click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("review and combine split sessions preserves equal sets and supports undo", async ({
  page,
  context,
}) => {
  const original = splitState(),
    current = await fixture(context, original);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#history");
  await page
    .getByRole("button", { name: "Combine sessions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Combine split workout entries",
  });
  await dialog.getByRole("checkbox", { name: /Lower body partial/ }).check();
  await dialog.getByRole("checkbox", { name: /Lower body final/ }).check();
  await dialog.getByLabel("Workout name").fill("Lower body strength");
  await expect(
    dialog.getByText("2 entries → 1 completed workout · 3 sets"),
  ).toBeVisible();
  await expect(dialog.getByText("60 kg × 10", { exact: true })).toHaveCount(2);
  const violations = (
    await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  ).violations;
  expect(violations).toEqual([]);
  await dialog.getByRole("button", { name: "Combine 2 sessions" }).click();
  await expect.poll(() => current().sessions.length).toBe(1);
  expect(current().sessions[0].exercises.flatMap((e) => e.sets)).toHaveLength(
    3,
  );
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect.poll(() => current().sessions.length).toBe(2);
  expect(current().sessions).toEqual(original.sessions);
});

test("combining into an ongoing workout removes the split history entries and survives reload", async ({
  page,
  context,
}) => {
  const current = await fixture(context, splitState());
  await page.goto("/#history");
  await page
    .getByRole("button", { name: "Combine sessions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Combine split workout entries",
  });
  await dialog.getByRole("checkbox", { name: /Lower body partial/ }).check();
  await dialog.getByRole("checkbox", { name: /Lower body final/ }).check();
  await dialog.getByLabel("After combining").selectOption("ongoing");
  await dialog.getByRole("button", { name: "Combine 2 sessions" }).click();
  await expect(
    page.getByRole("heading", { name: "Lower body partial", exact: true }),
  ).toBeVisible();
  await expect.poll(() => current().sessions.length).toBe(0);
  expect(
    current().activeWorkout!.exercises.flatMap((e) => e.sets),
  ).toHaveLength(3);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Lower body partial", exact: true }),
  ).toBeVisible();
});
