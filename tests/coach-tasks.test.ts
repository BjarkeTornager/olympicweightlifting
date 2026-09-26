import { test } from "node:test";
import assert from "node:assert/strict";
import { coachTasks, displayMessage, taskMessage } from "../lib/coach-tasks";
import { activityLoggingPrompt, sleepLoggingPrompt } from "../lib/images";

test("a task sends its instruction with the person's own words after it", () => {
  const sleep = coachTasks.sleep();
  assert.equal(taskMessage(sleep, "  "), sleepLoggingPrompt(false));
  assert.equal(
    taskMessage(sleep, "7.5 hours, woke at 6"),
    `${sleepLoggingPrompt(false)}\n\n7.5 hours, woke at 6`,
  );
  assert.equal(taskMessage(null, " Just a question "), "Just a question");
  // The activity-photo guard compares against this exact text.
  assert.equal(
    taskMessage(coachTasks.activity(true), ""),
    activityLoggingPrompt(true),
  );
});

test("sent messages show the label and the person's words, never the instruction", () => {
  const sleep = coachTasks.sleep();
  assert.deepEqual(displayMessage(taskMessage(sleep, "")), {
    label: "Logging sleep",
    text: "",
  });
  assert.deepEqual(displayMessage(taskMessage(sleep, "7 hours")), {
    label: "Logging sleep",
    text: "7 hours",
  });
  assert.deepEqual(
    displayMessage(taskMessage(coachTasks.mealPhotos(3), "only half")),
    { label: "3 meal photos", text: "only half" },
  );
  assert.deepEqual(
    displayMessage(taskMessage(coachTasks.editProgram("Base"), "less squats")),
    { label: "Edit “Base”", text: "less squats" },
  );
  assert.deepEqual(displayMessage("How did my week go?"), {
    text: "How did my week go?",
  });
});

test("older messages with pasted instructions display cleanly too", () => {
  assert.deepEqual(
    displayMessage(
      "I had eggs\n\nLog what I ate with sensible portion estimates. Save it now, label assumptions, and let me correct details afterward.",
    ),
    { label: "Logging food", text: "I had eggs" },
  );
  assert.deepEqual(displayMessage("Log my workout: squats 5x5 at 100"), {
    label: "Logging a workout",
    text: "squats 5x5 at 100",
  });
  assert.deepEqual(
    displayMessage(
      "Help me build a reusable training program in Train. My goal is get stronger",
    ),
    { label: "Build a training program", text: "get stronger" },
  );
});
