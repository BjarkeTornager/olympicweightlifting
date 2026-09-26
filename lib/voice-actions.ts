import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { agentProposals, agentTurns } from "./db/schema";
import { uid } from "./domain";
import { readJournal, writeJournal } from "./server";
import { cardioActivitySchema } from "./cardio";
import { foodGroupSchema } from "./nutrition";
import type { JournalState } from "./model";
import { prepareAction, type ActionPreview } from "./agent/actions";
import type { AgentAction } from "./agent/action-schema";
import { guardChange } from "./agent/change-guards";
import { newTurnReads } from "./agent/read-tools";
import { applyProposal } from "./agent/engine";
import { ApiError } from "./agent/http";
import { VOICE_PREFIX } from "./coach-tasks";

// Saves requested by the voice coach. They skip a second model: each tool call
// becomes one ordinary journal action, checked by the same guards and saved
// with the same receipt and Undo as a Coach message.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const summarySchema = z.string().trim().min(1).max(500);

export const voiceToolArgs = {
  log_training: z.object({
    summary: summarySchema,
    date,
    title: z.string().trim().min(1).max(120),
    finished: z.boolean().default(true),
    exercises: z
      .array(
        z.object({
          exercise: z.string().min(1).max(160),
          sets: z
            .array(
              z.object({
                weight_kg: z.number().min(0).max(1000),
                reps: z.number().int().min(1).max(1000),
                made: z.boolean().default(true),
              }),
            )
            .min(1)
            .max(30),
        }),
      )
      .min(1)
      .max(30),
  }),
  log_meal: z.object({
    summary: summarySchema,
    date,
    meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    name: z.string().trim().min(1).max(160),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(160),
          portion: z.string().trim().min(1).max(200),
          calories: z.number().min(0).max(10000),
          protein_g: z.number().min(0).max(1000),
          carbs_g: z.number().min(0).max(2000),
          fat_g: z.number().min(0).max(1000),
          food_groups: z.array(foodGroupSchema).max(13).default([]),
          ingredients: z
            .array(z.string().trim().min(1).max(80))
            .max(30)
            .default([]),
        }),
      )
      .min(1)
      .max(30),
    photo_ids: z.array(z.string().uuid()).max(4).default([]),
  }),
  log_sleep: z.object({
    summary: summarySchema,
    date,
    hours: z.number().min(0).max(24),
  }),
  log_activity: z.object({
    summary: summarySchema,
    date,
    activity: cardioActivitySchema,
    minutes: z.number().min(1).max(10080),
    distance_km: z.number().min(0).max(10000).optional(),
  }),
  clear_unfinished_workout: z.object({ summary: summarySchema }),
  undo_save: z.object({ save_id: z.string().uuid() }),
};
export type VoiceToolName = keyof typeof voiceToolArgs;

// Turns a voice tool call into a journal action for the current state.
export function voiceAction(
  name: Exclude<VoiceToolName, "undo_save">,
  raw: unknown,
  state: JournalState,
  today: string,
): AgentAction {
  switch (name) {
    case "log_training": {
      const a = voiceToolArgs.log_training.parse(raw);
      const workout = {
        title: a.title,
        date: a.date,
        category: "open" as const,
        exercises: a.exercises.map((e) => ({
          exerciseId: e.exercise,
          sets: e.sets.map((s) => ({
            weight: s.weight_kg,
            reps: s.reps,
            result: s.made ? ("success" as const) : ("miss" as const),
          })),
        })),
      };
      const completion = a.finished ? "completed" : "ongoing";
      // Same-day training continues the workout already there.
      if (state.activeWorkout?.date === a.date)
        return { kind: "log_workout_progress", workout, completion };
      const earlier = state.sessions.filter((s) => s.date === a.date).at(-1);
      if (earlier)
        return {
          kind: "log_workout_progress",
          workout,
          completion,
          sessionId: earlier.id,
        };
      // Anything still in progress today becomes the ongoing workout, unless
      // an older unfinished workout holds that place.
      if (!a.finished && a.date === today && !state.activeWorkout)
        return { kind: "log_workout_progress", workout, completion };
      return { kind: "record_session", workout };
    }
    case "log_meal": {
      const a = voiceToolArgs.log_meal.parse(raw);
      return {
        kind: "record_meal",
        meal: {
          date: a.date,
          name: a.name,
          type: a.meal_type,
          items: a.items.map((i) => ({
            name: i.name,
            portion: i.portion,
            calories: i.calories,
            protein: i.protein_g,
            carbs: i.carbs_g,
            fat: i.fat_g,
            // Ingredients come from what the athlete said, or what the coach
            // saw in a photo taken during the call.
            classification: {
              foodGroups: [...new Set(i.food_groups)],
              ingredients: [
                ...new Set(i.ingredients.map((n) => n.toLowerCase())),
              ].map((name) => ({
                name,
                evidence: a.photo_ids.length
                  ? ("visible" as const)
                  : ("reported" as const),
              })),
            },
          })),
          source: a.photo_ids.length ? "photo" : "text",
          estimated: true,
          notes: "",
          photoIds: a.photo_ids,
        },
      };
    }
    case "log_sleep": {
      const a = voiceToolArgs.log_sleep.parse(raw);
      return {
        kind: "record_checkin",
        checkin: { date: a.date, sleepHours: Math.round(a.hours * 100) / 100 },
      };
    }
    case "log_activity": {
      const a = voiceToolArgs.log_activity.parse(raw);
      return {
        kind: "record_cardio",
        cardio: {
          activity: a.activity,
          date: a.date,
          durationSeconds: Math.round(a.minutes * 60),
          distanceKm: a.distance_km ?? null,
          title: "",
          durationType: "unspecified",
          averageHeartRate: null,
          maxHeartRate: null,
          effort: null,
          elevationGainM: null,
          caloriesKcal: null,
          notes: "",
          photoIds: [],
        },
      };
    }
    case "clear_unfinished_workout": {
      voiceToolArgs.clear_unfinished_workout.parse(raw);
      const draft = state.activeWorkout;
      if (!draft) throw Error("There is no unfinished workout.");
      const logged = draft.exercises.some((e) =>
        e.sets.some((s) => s.logged || s.result),
      );
      return { kind: logged ? "finish_workout" : "discard_workout" };
    }
  }
}

// The server holds the whole journal, so every record a guard asks the model
// to read first counts as read. The remaining checks still apply.
function allRead(state: JournalState, day: string) {
  const reads = newTurnReads();
  const range = [{ from: day, to: day }];
  reads.draft = true;
  reads.food = true;
  reads.trainingRanges = range;
  reads.foodRanges = range;
  reads.cardioRanges = range;
  reads.healthDates.add(day);
  state.sessions.forEach((s) => reads.sessions.add(s.id));
  state.nutrition.meals.forEach((m) => reads.meals.add(m.id));
  state.cardio.sessions.forEach((c) => reads.cardio.add(c.id));
  return reads;
}

export type VoiceResult =
  | { ok: true; saveId?: string; title: string; detail: string }
  | { ok: false; error: string };

export async function runVoiceTool(
  userId: string,
  input: {
    id: string;
    name: VoiceToolName;
    args: unknown;
    today: string;
    // Photos the voice coach saw in this call, eligible as meal sources.
    seenPhotoIds: string[];
  },
): Promise<VoiceResult> {
  if (input.name === "undo_save") {
    const { save_id } = voiceToolArgs.undo_save.parse(input.args);
    await applyProposal(userId, save_id, true);
    return { ok: true, title: "Undone", detail: "That save was undone." };
  }
  const db = getDb();
  const [existing] = await db
    .select()
    .from(agentTurns)
    .where(and(eq(agentTurns.id, input.id), eq(agentTurns.userId, userId)));
  if (existing?.response) {
    const saved = existing.response.proposals?.[0];
    return saved
      ? { ok: true, saveId: saved.id, title: saved.title, detail: saved.detail }
      : { ok: false, error: existing.response.reply };
  }
  const snapshot = await readJournal(userId);
  const action = voiceAction(
    input.name,
    input.args,
    snapshot.state,
    input.today,
  );
  const day =
    "workout" in action
      ? action.workout.date
      : "meal" in action
        ? action.meal.date
        : "checkin" in action
          ? action.checkin.date
          : "cardio" in action
            ? action.cardio.date
            : input.today;
  const { summary } = z
    .object({ summary: summarySchema })
    .passthrough()
    .parse(input.args);
  await guardChange(action, {
    userId,
    state: snapshot.state,
    reads: allRead(snapshot.state, day),
    viewedImageIds: new Set(input.seenPhotoIds),
    message: summary,
    recent: [],
    saving: true,
  });
  const prepared = prepareAction(snapshot.state, action, input.today);
  const id = uid();
  const expiresAt = new Date(Date.now() + 86400000);
  const preview: ActionPreview = {
    id,
    title: prepared.title,
    detail: prepared.detail,
    workout: prepared.workout,
    ...(prepared.meal ? { meal: prepared.meal } : {}),
    ...(prepared.checkin ? { checkin: prepared.checkin } : {}),
    ...(prepared.cardio ? { cardio: prepared.cardio } : {}),
    ...(prepared.workoutReview
      ? { workoutReview: prepared.workoutReview }
      : {}),
    expiresAt: expiresAt.toISOString(),
    status: "saved",
    automatic: true,
  };
  const photoIds = "meal" in action ? action.meal.photoIds : [];
  const response = {
    reply: "Saved from your voice check-in.",
    proposals: [preview],
  };
  // The receipt appears in Coach like any saved message, with Undo.
  await db.transaction(async (tx) => {
    await tx.insert(agentTurns).values({
      id: input.id,
      userId,
      question: `${VOICE_PREFIX}${summary}`,
      photoIds,
      status: "done",
      response,
    });
    await tx.insert(agentProposals).values({
      id,
      userId,
      turnId: input.id,
      revision: snapshot.revision,
      before: snapshot.state,
      after: prepared.state,
      preview,
      undoId: uid(),
      status: "saved",
      expiresAt,
    });
    await writeJournal(
      userId,
      { state: prepared.state, revision: snapshot.revision, mutationId: id },
      tx,
    );
  });
  return {
    ok: true,
    saveId: id,
    title: prepared.title,
    detail: prepared.detail,
  };
}

export function voiceFailure(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "That could not be saved.";
}
