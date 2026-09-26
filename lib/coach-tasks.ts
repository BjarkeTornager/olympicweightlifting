import {
  activityLoggingPrompt,
  imageCoachPrompt,
  sleepLoggingPrompt,
  type ImageCategory,
} from "./images";
import { liftingPrompt } from "./lifting-coach";

// A logging or planning request Coach should handle. The instruction goes to
// the model; the person only sees the label and writes their own words.
export type CoachTask = {
  label: string;
  placeholder: string;
  instruction: string;
};

const optional = "Add anything Coach should know (optional)";

const liftingLabels: Record<string, string> = {
  nutrition: "Fuel my training",
  plan: "Build my lifting plan",
  review: "Review my lifting",
  session: "Prepare my next session",
  debrief: "Debrief my session",
};

const sleep = (photo = false): CoachTask => ({
  label: photo ? "Sleep screenshot" : "Logging sleep",
  placeholder: photo ? optional : "How long did you sleep?",
  instruction: sleepLoggingPrompt(photo),
});
const activity = (photo = false): CoachTask => ({
  label: photo ? "Activity screenshot" : "Logging a walk, run or ride",
  placeholder: photo ? optional : "What did you do, and for how long?",
  instruction: activityLoggingPrompt(photo),
});
const mealPhotos = (count: number): CoachTask => ({
  label: count > 1 ? `${count} meal photos` : "Meal photo",
  placeholder: "Anything to add? For example: I only ate half",
  instruction: imageCoachPrompt("food", count),
});

export const coachTasks = {
  sleep,
  activity,
  mealPhotos,
  // A single image opened in Coach, by its library category.
  photo: (category: ImageCategory): CoachTask =>
    category === "food"
      ? mealPhotos(1)
      : category === "sleep"
        ? {
            label: "Sleep screenshot",
            placeholder: optional,
            instruction: imageCoachPrompt("sleep"),
          }
        : category === "activity"
          ? activity(true)
          : {
              label: "Image",
              placeholder: "What would you like to know about it?",
              instruction: imageCoachPrompt(category),
            },
  lifting: (intent: string): CoachTask => ({
    label: liftingLabels[intent] ?? liftingLabels.review,
    placeholder: optional,
    instruction: liftingPrompt(intent),
  }),
  newProgram: (): CoachTask => ({
    label: "Build a training program",
    placeholder: "What’s your goal?",
    instruction:
      "Help me build a reusable training program in Train. My goal is below.",
  }),
  editProgram: (name: string): CoachTask => ({
    label: `Edit “${name}”`,
    placeholder: "What should change?",
    instruction: `Update my saved training program “${name}”. What to change is below.`,
  }),
};

export function taskMessage(task: CoachTask | null, text: string) {
  const own = text.trim();
  if (!task) return own;
  return own ? `${task.instruction}\n\n${own}` : task.instruction;
}

// Instructions that can appear in saved messages, including ones the older
// composer pasted into the draft, mapped to the short label shown instead.
function knownInstructions(): [string, string][] {
  const tasks = [
    coachTasks.sleep(),
    coachTasks.sleep(true),
    coachTasks.activity(),
    coachTasks.activity(true),
    coachTasks.newProgram(),
    ...[1, 2, 3, 4].map(coachTasks.mealPhotos),
    ...Object.keys(liftingLabels).map(coachTasks.lifting),
  ].map((t): [string, string] => [t.instruction, t.label]);
  return [
    ...tasks,
    [imageCoachPrompt("sleep"), "Sleep screenshot"],
    [imageCoachPrompt("unclassified"), "Image"],
    [
      "Log what I ate with sensible portion estimates. Save it now, label assumptions, and let me correct details afterward.",
      "Logging food",
    ],
    [
      "Please use this to log my sleep. Ask about any unclear date or time asleep and save the entry.",
      "Logging sleep",
    ],
    [
      "Log my workout from the attached photo and any details I provided.",
      "Logging a workout",
    ],
    ["Please log this workout.", "Logging a workout"],
    ["Log my workout:", "Logging a workout"],
    [
      "Help me build a reusable training program in Train. My goal is",
      "Build a training program",
    ],
  ];
}

// What a sent message looks like in the conversation: the person's own words,
// with any instruction replaced by its label.
export function displayMessage(message: string): {
  label?: string;
  text: string;
} {
  const trimmed = message.trim();
  for (const [instruction, label] of knownInstructions()) {
    if (trimmed === instruction) return { label, text: "" };
    if (trimmed.startsWith(instruction))
      return { label, text: trimmed.slice(instruction.length).trim() };
    if (trimmed.endsWith(`\n\n${instruction}`))
      return { label, text: trimmed.slice(0, -instruction.length).trim() };
  }
  const edit =
    /^Update my saved training program “([^”]+)”[.:] ?(?:What to change is below\.)?/.exec(
      trimmed,
    );
  if (edit)
    return {
      label: `Edit “${edit[1]}”`,
      text: trimmed.slice(edit[0].length).trim(),
    };
  return { text: message };
}
