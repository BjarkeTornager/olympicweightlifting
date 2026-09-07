import { test, expect, browserUser } from "./fixtures";
import type { BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { emptyJournal, today } from "../../lib/domain";
import { prepareAction } from "../../lib/agent/actions";
import { trainingPrograms } from "../../lib/training-programs";
import { simpleRoutine, mixedProgram } from "../fixtures/training-programs";
import type { JournalState } from "../../lib/model";

async function fixture(
  context: BrowserContext,
  initial: JournalState,
  prepared?: ReturnType<typeof prepareAction>,
) {
  let state = initial,
    revision = 1;
  const proposal = prepared
    ? {
        id: crypto.randomUUID(),
        title: prepared.title,
        detail: prepared.detail,
        training: prepared.training,
        workout: prepared.workout,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }
    : null;
  await context.route("**/api/journal", (r) => {
    if (r.request().method() === "PUT") {
      state = r.request().postDataJSON().state;
      revision++;
    }
    return r.fulfill({ json: { accountId: browserUser.id, state, revision } });
  });
  if (proposal) {
    await context.route("**/api/agent", (r) =>
      r.fulfill({
        json: {
          enabled: true,
          provider: "Synthetic provider",
          turns: [
            {
              id: crypto.randomUUID(),
              question: "Create or edit my training program.",
              reply: "Ready for your review.",
              status: "done",
              proposals: [proposal],
            },
          ],
        },
      }),
    );
    await context.route("**/api/agent/action", (r) => {
      expect(r.request().headers()["x-training-programs-version"]).toBe("1");
      const undo = r.request().postDataJSON().undo;
      state = structuredClone(undo ? initial : prepared!.state);
      revision++;
      return r.fulfill({
        json: {
          accountId: browserUser.id,
          state,
          revision,
          status: undo ? "undone" : "saved",
        },
      });
    });
  }
  return () => state;
}

test("a Coach routine with an unknown starting load remains editable without inventing a weight", async ({
  page,
  context,
}) => {
  const routine = structuredClone(simpleRoutine) as {
    name: string;
    exercises: {
      exerciseId: string;
      sets: { weight: number | null; reps: number }[];
    }[];
  };
  routine.exercises[0].sets.forEach((s) => {
    s.weight = null;
  });
  const initial = prepareAction(
    emptyJournal(),
    { kind: "create_routine", routine },
    today(),
  ).state;
  const current = await fixture(context, initial);
  await page.goto("/#workout/choose");
  await page
    .locator(".templates-panel")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Routine name", { exact: true })
    .fill("Choose loads later");
  await dialog
    .getByRole("button", { name: "Save routine", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => current().templates[0].name)
    .toBe("Choose loads later");
  expect(
    current().templates[0].exercises[0].sets.every((s) => s.weight === ""),
  ).toBe(true);
});

test("Coach reviews a new routine, saves it in Train and starts fresh unlogged sets", async ({
  page,
  context,
}, info) => {
  const initial = emptyJournal(),
    prepared = prepareAction(
      initial,
      { kind: "create_routine", routine: simpleRoutine },
      today(),
    );
  const current = await fixture(context, initial, prepared);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Review (1)", exact: true }).click();
  const card = page.getByRole("region", { name: "Review journal change" });
  await expect(card).toContainText("Seated leg curl");
  await expect(card).toContainText("3 sets · 35 kg × 12");
  await expect(card).toContainText("3 sets · 20 kg × 15");
  expect(current().templates.length).toBe(0);
  await page.screenshot({
    path: info.outputPath("routine-review-mobile.png"),
    fullPage: true,
  });
  await card
    .getByRole("button", { name: "Save this change", exact: true })
    .click();
  await expect(card).toHaveClass(/saved/);
  await card.locator(".proposal-summary").click();
  await card.getByRole("button", { name: "Open Train", exact: true }).click();
  const routines = page.locator(".templates-panel");
  await expect(routines).toContainText(simpleRoutine.name);
  await routines.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator(".workout-heading")).toContainText(
    "0 of 6 sets logged",
  );
  await expect.poll(() => Boolean(current().activeWorkout)).toBe(true);
  expect(
    current().activeWorkout!.exercises.every((e) =>
      e.sets.every((s) => !s.logged && !s.result),
    ),
  ).toBe(true);
  expect(current().sessions).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: simpleRoutine.name, exact: true }),
  ).toBeVisible();
});

test("program edits display both versions and undo restores every saved day", async ({
  page,
  context,
}, info) => {
  const initial = prepareAction(
    emptyJournal(),
    { kind: "create_training_program", trainingProgram: mixedProgram },
    today(),
  ).state;
  const p = trainingPrograms(initial)[0],
    days = structuredClone(p.days);
  days[0].exercises[0].weight = 40;
  const prepared = prepareAction(
    initial,
    {
      kind: "update_training_program",
      trainingProgramId: p.id,
      programChanges: { days },
    },
    today(),
  );
  const current = await fixture(context, initial, prepared);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await page.getByRole("button", { name: "Review (1)", exact: true }).click();
  const card = page.getByRole("region", { name: "Review journal change" });
  await card.locator(".training-day summary").first().click();
  await expect(card).toContainText("3 × 10–12 · 40 kg");
  await card
    .getByText("Compare with the saved version", { exact: true })
    .click();
  await card.locator(".training-before .training-day summary").first().click();
  await expect(card.locator(".training-before")).toContainText(
    "3 × 10–12 · 35 kg",
  );
  await page.screenshot({
    path: info.outputPath("program-edit-mobile.png"),
    fullPage: true,
  });
  await card
    .getByRole("button", { name: "Save this change", exact: true })
    .click();
  await expect(card).toHaveClass(/saved/);
  expect(trainingPrograms(current())[0].days[0].exercises[0].weight).toBe(40);
  await card.locator(".proposal-summary").click();
  await card
    .getByRole("button", { name: "Undo this change", exact: true })
    .click();
  await expect(card).toHaveClass(/undone/);
  expect(trainingPrograms(current())[0]).toEqual(p);
});

test("Train programs show strength, custom movements, cardio and recovery across mobile sizes", async ({
  page,
  context,
}, info) => {
  const initial = prepareAction(
    emptyJournal(),
    { kind: "create_training_program", trainingProgram: mixedProgram },
    today(),
  ).state;
  const current = await fixture(context, initial);
  await page.goto("/#workout/choose");
  const panel = page.locator(".training-programs-panel");
  await expect(
    panel.getByRole("heading", { name: "Your programs", exact: true }),
  ).toBeVisible();
  for (const summary of await panel.locator(".training-day > summary").all())
    await summary.click();
  await expect(panel).toContainText("Landmine squat");
  await expect(panel).toContainText("Target RPE 7 · Rest 90s");
  await expect(panel).toContainText("Easy conversational effort");
  await expect(panel).toContainText("Rest or gentle mobility");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("train-programs-mobile.png"),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Edit with Coach", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message your coach", exact: true }),
  ).toHaveValue(/Update my saved training program “Strength and movement”/);
  await page.goto("/#workout/choose");
  await panel.locator(".training-day > summary").first().click();
  await panel
    .getByRole("button", { name: "Start workout", exact: true })
    .click();
  await expect.poll(() => Boolean(current().activeWorkout)).toBe(true);
  expect(current().activeWorkout?.programId).toBe(
    trainingPrograms(initial)[0].id,
  );
  expect(current().activeWorkout?.exercises[1].sets[0].weight).toBe("");
  expect(current().cardio.sessions).toEqual([]);
});

test("deleting a saved program preserves a running session and supports local undo", async ({
  page,
  context,
}) => {
  let initial = prepareAction(
    emptyJournal(),
    { kind: "create_training_program", trainingProgram: mixedProgram },
    today(),
  ).state;
  const program = trainingPrograms(initial)[0];
  initial = prepareAction(
    initial,
    {
      kind: "start_training_day",
      trainingProgramId: program.id,
      dayId: program.days[0].id,
      date: today(),
    },
    today(),
  ).state;
  const current = await fixture(context, initial);
  await page.goto("/#workout/choose");
  await page
    .getByRole("button", { name: `Delete ${program.name}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete program", exact: true })
    .click();
  await expect.poll(() => trainingPrograms(current()).length).toBe(0);
  expect(current().activeWorkout).toEqual(initial.activeWorkout);
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect.poll(() => trainingPrograms(current()).length).toBe(1);
  expect(current().activeWorkout).toEqual(initial.activeWorkout);
});
