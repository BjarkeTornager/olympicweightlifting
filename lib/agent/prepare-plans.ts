import { coachSettings } from "../coaching";
import { uid } from "../domain";
import type { JournalState, WorkoutTemplate } from "../model";
import {
  ownedProgram,
  saveTrainingProgram,
  startTrainingDay,
} from "../training-programs";
import { startTemplate } from "../training";
import type { ActionOf, PreparedChange } from "./actions";
import { requireNoDraft } from "./prepare-workouts";

export function prepareLiftingBrief(
  next: JournalState,
  action: ActionOf<"set_lifting_brief">,
): PreparedChange {
  const liftingBrief = action.liftingBrief
    ? { ...action.liftingBrief, updatedAt: new Date().toISOString() }
    : null;
  next.profile.lifting = liftingBrief;
  return {
    liftingBrief,
    title: liftingBrief
      ? "Save your lifting brief"
      : "Clear your lifting brief",
    detail: liftingBrief
      ? "Your chosen goal, availability and constraints will guide future lifting conversations. Training programs and recorded sessions stay as they are."
      : "Removes the saved lifting brief. Programs, sessions, approved memories and earlier chat remain.",
  };
}

export function prepareRoutine(
  next: JournalState,
  action: ActionOf<
    "create_routine" | "update_routine" | "delete_routine" | "start_routine"
  >,
): PreparedChange {
  const original =
    "routineId" in action
      ? next.templates.find((t) => t.id === action.routineId)
      : undefined;
  if ("routineId" in action && !original)
    throw Error(
      "That routine is not in your journal. Read training_library for the correct ID.",
    );
  if (action.kind === "start_routine") {
    requireNoDraft(next);
    const workout = startTemplate(original!, action.date);
    next.activeWorkout = workout;
    return {
      workout,
      title: "Start your routine",
      detail: "Creates an unfinished workout with every set unlogged.",
    };
  }
  if (action.kind === "delete_routine") {
    next.templates = next.templates.filter((t) => t.id !== original!.id);
    return {
      training: { kind: "routine", after: original! },
      title: "Delete this routine",
      detail:
        "Removes this reusable routine. Completed sessions and your unfinished workout are kept.",
    };
  }
  const routine: WorkoutTemplate = {
    id: original?.id ?? uid(),
    name: action.routine.name,
    exercises: action.routine.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      sets: e.sets.map((s) => ({ weight: s.weight ?? "", reps: s.reps })),
    })),
  };
  if (original)
    next.templates = next.templates.map((t) =>
      t.id === original.id ? routine : t,
    );
  else next.templates.push(routine);
  return {
    training: {
      kind: "routine",
      after: routine,
      ...(original ? { before: original } : {}),
    },
    title: original ? "Update your routine" : "Create your routine",
    detail: `“${routine.name}” will be available in Train → Your routines. Completed sessions and your unfinished workout are kept.`,
  };
}

export function prepareTrainingProgram(
  next: JournalState,
  action: ActionOf<
    | "create_training_program"
    | "update_training_program"
    | "delete_training_program"
    | "start_training_day"
  >,
): PreparedChange {
  const original =
    "trainingProgramId" in action
      ? ownedProgram(next, action.trainingProgramId)
      : undefined;
  if (action.kind === "start_training_day") {
    requireNoDraft(next);
    const workout = startTrainingDay(original!, action.dayId, action.date);
    next.activeWorkout = workout;
    return {
      workout,
      title: "Start your training day",
      detail:
        "Starts the prescribed strength sets as an unlogged workout. Cardio instructions remain a plan; log activities after completing them.",
    };
  }
  if (action.kind === "delete_training_program") {
    next.program.customPrograms = next.program.customPrograms.filter(
      (p) => p !== original,
    );
    return {
      training: { kind: "program", after: original! },
      title: "Delete this training program",
      detail:
        "Removes this reusable program. Completed sessions and your unfinished workout are kept.",
    };
  }
  const program = saveTrainingProgram(
    next,
    action.kind === "create_training_program"
      ? action.trainingProgram
      : { ...original!, ...action.programChanges },
    original,
  );
  return {
    training: {
      kind: "program",
      after: program,
      ...(original ? { before: original } : {}),
    },
    title: original
      ? "Update your training program"
      : "Create your training program",
    detail: `“${program.name}” will be available in Train → Your programs. These are planned targets. Completed sessions and your unfinished workout are kept.`,
  };
}

export function prepareMemory(
  next: JournalState,
  action: ActionOf<"save_memory" | "forget_memory">,
): PreparedChange {
  const coaching = coachSettings(next);
  const original = coaching.memories?.find((m) => m.id === action.memoryId);
  if (action.memoryId && !original)
    throw Error("That memory is not in your journal.");
  if (action.kind === "forget_memory") {
    coaching.memories = (coaching.memories ?? []).filter(
      (m) => m.id !== action.memoryId,
    );
    return {
      memory: original,
      title: "Forget this preference",
      detail:
        "Removes this saved memory. Existing chat messages remain until you clear the conversation.",
    };
  }
  const now = new Date().toISOString();
  const memory = {
    ...action.memory,
    id: original?.id ?? uid(),
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
  };
  coaching.memories = [
    ...(coaching.memories ?? []).filter((m) => m.id !== memory.id),
    memory,
  ];
  return {
    memory,
    title: original
      ? "Update what Coach remembers"
      : "Remember this for future conversations",
    detail:
      "Save only if you want Coach to use this preference in future chats. You can edit or delete it in What Coach remembers.",
  };
}

export function preparePlan(
  next: JournalState,
  action: ActionOf<"save_plan" | "delete_plan" | "dismiss_plan">,
  currentDate: string,
): PreparedChange {
  const coaching = coachSettings(next);
  const original = coaching.plans?.find((p) => p.id === action.planId);
  if (action.planId && !original)
    throw Error("That plan is not in your journal.");
  if (action.kind === "dismiss_plan") {
    const plan = {
      ...original!,
      status: "dismissed" as const,
      updatedAt: new Date().toISOString(),
    };
    coaching.plans = (coaching.plans ?? []).map((p) =>
      p.id === plan.id ? plan : p,
    );
    return {
      plan,
      title: "Dismiss this plan",
      detail:
        "Stops follow-up and keeps the plan in your history as dismissed. It does not imply you tried or completed it.",
    };
  }
  if (action.kind === "delete_plan") {
    coaching.plans = (coaching.plans ?? []).filter(
      (p) => p.id !== action.planId,
    );
    return {
      plan: original,
      title: "Delete this agreed plan",
      detail:
        "Removes the saved plan and its follow-up. Existing chat messages remain.",
    };
  }
  if (!original && action.plan.status !== "active")
    throw Error("A new agreed plan must start active.");
  if (action.plan.status === "active" && action.plan.followUpDate < currentDate)
    throw Error("Choose today or a future follow-up date for an active plan.");
  const now = new Date().toISOString();
  const plan = {
    ...action.plan,
    id: original?.id ?? uid(),
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
  };
  coaching.plans = [
    ...(coaching.plans ?? []).filter((p) => p.id !== plan.id),
    plan,
  ];
  return {
    plan,
    title: original ? "Update your agreed plan" : "Agree on one small plan",
    detail:
      "Confirm this is something you want to try. Coach can ask about it when you visit from the follow-up date. You can revise or dismiss it at any time.",
  };
}
