import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "./agent/http";
import { actionSchema } from "./agent/action-schema";
import { prepareAction } from "./agent/actions";
import { getDb } from "./db";
import { mutations } from "./db/schema";
import {
  program,
  setTechniqueChecked,
  setWorkoutRecovery,
  takeLoadReset,
} from "./domain";
import type { JournalState } from "./model";
import { actionRequest } from "./native-api";
import { trainingPrograms } from "./training-programs";
import {
  nativeClient,
  nativeSupported,
  nativeUpdateMessage,
} from "./native-client";
import { localClock, timeZoneSchema } from "./reminders";
import {
  MutationConflict,
  readJournal,
  RevisionConflict,
  writeJournal,
} from "./server";
import { countUse } from "./feature-use";
import {
  goalsCheckClosedNote,
  goalsCheckNote,
  takeTargetsProposal,
} from "./coaching";
import { keepCurrentTargets } from "./target-proposals";

// Every /api/v1 route is for the installed app only, and an unsupported build
// gets a 426 it can show as "update in TestFlight".
export function requireNative(request: Request) {
  const client = nativeClient(request);
  if (!client) throw new ApiError("This endpoint is for the iPhone app.", 400);
  if (!nativeSupported(client)) throw new ApiError(nativeUpdateMessage, 426);
  return client;
}

const saved = async (userId: string, id: string) =>
  (
    await getDb()
      .select({ id: mutations.id })
      .from(mutations)
      .where(and(eq(mutations.userId, userId), eq(mutations.id, id)))
  ).length > 0;

type Prepared = { state: JournalState; title: string; detail: string };
type NativeActionInput = z.infer<typeof actionRequest>["action"];
type ProgrammeInput = Extract<
  NativeActionInput,
  { kind: "create_training_program" }
>["trainingProgram"];

// The Coach schema needs an explicit null weight for "choose a load".
const withLoads = (p: ProgrammeInput) => ({
  ...p,
  days: p.days.map((d) => ({
    ...d,
    exercises: d.exercises.map((e) => ({ ...e, weight: e.weight ?? null })),
  })),
});

// The app's own changes to the workout in progress: its recovery, the
// under-18 technique check and taking a proposed reset.
function workoutPlanChange(raw: NativeActionInput) {
  switch (raw.kind) {
    case "set_workout_recovery": {
      const limited = raw.recovery === "limited";
      return {
        change: (s: JournalState) => setWorkoutRecovery(s, raw.recovery),
        title: limited ? "Hold loads today" : "Follow the programme’s loads",
        detail: limited
          ? "Exercises you haven’t started repeat their previous loads."
          : "Exercises you haven’t started follow the programme’s loads.",
      };
    }
    case "confirm_technique":
      return {
        change: (s: JournalState) => setTechniqueChecked(s, raw.checked),
        title: raw.checked
          ? "Coach checked your technique"
          : "Technique not checked today",
        detail: raw.checked
          ? "Exercises you haven’t started can go up in load."
          : "Exercises you haven’t started repeat their loads.",
      };
    case "take_load_reset":
      return {
        change: (s: JournalState) => takeLoadReset(s, raw.entryId),
        title: "Reset the load",
        detail: "This exercise starts lighter today and builds back up.",
      };
  }
}

// The journal change for an app action. Most are Coach actions and go
// through the same schema and rules; "use_programme", "set_hydration_target",
// taking or keeping over suggested targets and the workout plan changes are
// the app's own.
function preparer(
  raw: NativeActionInput,
  today: string,
): (state: JournalState) => Prepared {
  const planChange = workoutPlanChange(raw);
  if (planChange)
    return (state) => {
      const next = structuredClone(state);
      planChange.change(next);
      next.updatedAt = new Date().toISOString();
      return {
        state: next,
        title: planChange.title,
        detail: planChange.detail,
      };
    };
  if (raw.kind === "use_programme") {
    const id = raw.programmeId;
    return (state) => {
      const known =
        id === program.id || trainingPrograms(state).some((p) => p.id === id);
      if (!known) throw Error("That programme is not in your journal.");
      const next = structuredClone(state);
      next.program.activeProgramId = id;
      next.updatedAt = new Date().toISOString();
      return {
        state: next,
        title: "Follow this programme",
        detail: "Train suggests its next session.",
      };
    };
  }
  if (
    raw.kind === "take_suggested_targets" ||
    raw.kind === "keep_current_targets"
  ) {
    const take = raw.kind === "take_suggested_targets";
    // As Today showed them: a target left out is none.
    const shown = {
      goal: raw.targets.goal,
      calories: raw.targets.calories ?? null,
      protein: raw.targets.protein ?? null,
      carbs: raw.targets.carbs ?? null,
      fat: raw.targets.fat ?? null,
    };
    const answer = raw.energyAnswer;
    const signs =
      answer === undefined
        ? undefined
        : answer === "prefer_not_to_say"
          ? null
          : answer === "yes";
    return (state) => {
      const next = structuredClone(state);
      if (!take) {
        const { held } = keepCurrentTargets(next, today, shown, signs);
        next.updatedAt = new Date().toISOString();
        return {
          state: next,
          title: "Keep your daily targets",
          detail: held
            ? "Your targets stay as they are, and your yes to one of the health questions is saved, so your goals plan won't suggest a deficit; a sports doctor or sports dietitian can help you look into it."
            : "Your goals plan suggests new ones again only once it moves on from these.",
        };
      }
      const { proposal, agreed, closed } = takeTargetsProposal(
        next,
        today,
        shown,
        signs,
      );
      next.updatedAt = new Date().toISOString();
      const kcal = proposal.targets.calories;
      const held = Boolean(proposal.energyCheck) && answer === "yes";
      return {
        state: next,
        title: held ? "Hold your weight" : "Take the suggested daily targets",
        detail: [
          kcal != null
            ? `Your daily target is now ${kcal.toLocaleString("en-GB")} kcal, ${held ? "holding your weight, as you answered yes to one of the health questions. A sports doctor or sports dietitian can help you look into it." : "a starting estimate."}`
            : "Your daily targets are now your goals plan's.",
          ...(agreed ? [goalsCheckNote(agreed.followUpDate)] : []),
          ...(closed ? [goalsCheckClosedNote(closed.followUpDate)] : []),
        ].join(" "),
      };
    };
  }
  if (raw.kind === "set_hydration_target") {
    const hidden = raw.hidden;
    return (state) => {
      const next = structuredClone(state);
      if (hidden) next.preferences.hideHydrationTarget = true;
      else delete next.preferences.hideHydrationTarget;
      next.updatedAt = new Date().toISOString();
      return hidden
        ? {
            state: next,
            title: "Hide the drinks target",
            detail:
              "Drinks still add up; Today shows no target and water reminders stop.",
          }
        : {
            state: next,
            title: "Show the drinks target",
            detail: "Today shows the day's drinks range again.",
          };
    };
  }
  const action = actionSchema.parse(
    raw.kind === "create_training_program"
      ? { ...raw, trainingProgram: withLoads(raw.trainingProgram) }
      : raw.kind === "update_training_program"
        ? { ...raw, programChanges: withLoads(raw.programChanges) }
        : raw,
  );
  return (state) => prepareAction(state, action, today);
}

// Apply one action the app queued. The request ID is the save's identity: a
// retry after a lost response, or from the offline queue, is saved once. The
// action applies to the journal as it is now, so a phone that was offline
// never overwrites what another device saved in the meantime.
export async function applyNativeAction(
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = actionRequest.parse(raw);
  const timezone = timeZoneSchema.parse(input.timezone);
  const today = localClock(now, timezone).date;
  const prepare = preparer(input.action, today);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await saved(userId, input.id)) {
      const { revision } = await readJournal(userId);
      return {
        id: input.id,
        status: "duplicate" as const,
        title: "Already saved",
        detail: "This change was saved earlier.",
        revision,
      };
    }
    const snapshot = await readJournal(userId);
    let prepared: Prepared;
    try {
      prepared = prepare(snapshot.state);
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      throw new ApiError(
        error instanceof Error ? error.message : "This change was refused.",
        422,
      );
    }
    try {
      const result = await writeJournal(userId, {
        state: prepared.state,
        revision: snapshot.revision,
        mutationId: input.id,
      });
      void countUse(userId, `app.${input.action.kind}`);
      return {
        id: input.id,
        status: "saved" as const,
        title: prepared.title,
        detail: prepared.detail,
        revision: result.revision,
      };
    } catch (error) {
      // Another save landed first: prepare again against the newer journal.
      if (error instanceof RevisionConflict) continue;
      // The same ID was saved concurrently: report it as a duplicate.
      if (error instanceof MutationConflict) continue;
      throw error;
    }
  }
  throw new ApiError(
    "Your journal is busy saving other changes. This change is kept and will retry.",
    409,
  );
}
