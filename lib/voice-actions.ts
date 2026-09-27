import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { agentProposals, agentTurns } from "./db/schema";
import { uid } from "./domain";
import { readJournal, writeJournal } from "./server";
import { cardioActivitySchema } from "./cardio";
import { foodGroupSchema } from "./nutrition";
import { bodyGoalsRequestSchema } from "./body-goals";
import { bodyFatInputSchema } from "./body-composition";
import { drinkInputSchema } from "./hydration";
import type { JournalState } from "./model";
import { prepareAction, type ActionPreview } from "./agent/actions";
import type { AgentAction } from "./agent/action-schema";
import { guardChange } from "./agent/change-guards";
import { newTurnReads } from "./agent/read-tools";
import { listUserImages } from "./user-images";
import { dayRange, journalForVoice } from "./journal-summary";
import {
  recentConversations,
  searchConversations,
} from "./conversation-memory";
import { applyProposal } from "./agent/engine";
import { ApiError } from "./agent/http";
import { VOICE_PREFIX } from "./coach-tasks";
import { routeNotesFor } from "./workout-routes";

// Saves requested by the voice coach. They skip a second model: each tool call
// becomes one ordinary journal action, checked by the same guards and saved
// with the same receipt and Undo as a Coach message.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const summarySchema = z.string().trim().min(1).max(500);

const exercisesSchema = z
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
  .max(30);
const mealArgs = z.object({
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
  // Omitted on an update keeps the meal's photos.
  photo_ids: z.array(z.string().uuid()).max(4).optional(),
});

const workoutFrom = (
  title: string,
  day: string,
  exercises: z.infer<typeof exercisesSchema>,
) => ({
  title,
  date: day,
  category: "open" as const,
  exercises: exercises.map((e) => ({
    exerciseId: e.exercise,
    sets: e.sets.map((s) => ({
      weight: s.weight_kg,
      reps: s.reps,
      result: s.made ? ("success" as const) : ("miss" as const),
    })),
  })),
});

const mealFrom = (a: z.infer<typeof mealArgs>, photoIds: string[]) => ({
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
    // Ingredients come from what the athlete said, or what the coach saw
    // in a photo.
    classification: {
      foodGroups: [...new Set(i.food_groups)],
      ingredients: [...new Set(i.ingredients.map((n) => n.toLowerCase()))].map(
        (name) => ({
          name,
          evidence: photoIds.length
            ? ("visible" as const)
            : ("reported" as const),
        }),
      ),
    },
  })),
  source: photoIds.length ? ("photo" as const) : ("text" as const),
  estimated: true,
  notes: "",
  photoIds,
});

export const voiceToolArgs = {
  log_training: z.object({
    summary: summarySchema,
    date,
    title: z.string().trim().min(1).max(120),
    finished: z.boolean().default(true),
    exercises: exercisesSchema,
  }),
  // Read-only: the journal for a short date range, with ids for corrections.
  read_journal: z.object({ from: date, to: date }),
  list_photos: z.object({ from: date, to: date }),
  recall_conversations: z.object({
    query: z.string().trim().max(200).optional(),
  }),
  update_training: z.object({
    summary: summarySchema,
    session_id: z.string().min(1).max(160),
    title: z.string().trim().min(1).max(120),
    exercises: exercisesSchema,
  }),
  delete_meal: z.object({ summary: summarySchema, meal_id: z.string().uuid() }),
  log_meal: mealArgs,
  update_meal: mealArgs.extend({ meal_id: z.string().uuid() }),
  log_drink: drinkInputSchema.extend({ summary: summarySchema }),
  log_body_fat: bodyFatInputSchema.extend({
    summary: summarySchema,
    method: z.preprocess((v) => v || null, bodyFatInputSchema.shape.method),
  }),
  delete_drink: z.object({
    summary: summarySchema,
    drink_id: z.string().uuid(),
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
  set_goals: bodyGoalsRequestSchema.extend({
    summary: summarySchema,
    // Models sometimes send an empty string for "no date", and an empty
    // value or zero for an unknown focus or body fat.
    targetDate: z.preprocess((v) => v || null, date.nullable()),
    focus: z.preprocess(
      (v) => v || undefined,
      bodyGoalsRequestSchema.shape.focus,
    ),
    bodyFatPercent: z.preprocess(
      (v) => v || undefined,
      bodyGoalsRequestSchema.shape.bodyFatPercent,
    ),
    targetBodyFatPercent: z.preprocess(
      (v) => v || undefined,
      bodyGoalsRequestSchema.shape.targetBodyFatPercent,
    ),
  }),
  undo_save: z.object({ save_id: z.string().uuid() }),
};
export type VoiceToolName = keyof typeof voiceToolArgs;
type ReadTool = "read_journal" | "list_photos" | "recall_conversations";

// Turns a voice tool call into a journal action for the current state.
export function voiceAction(
  name: Exclude<VoiceToolName, "undo_save" | ReadTool>,
  raw: unknown,
  state: JournalState,
  today: string,
): AgentAction {
  switch (name) {
    case "log_training": {
      const a = voiceToolArgs.log_training.parse(raw);
      const workout = workoutFrom(a.title, a.date, a.exercises);
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
    case "update_training": {
      const a = voiceToolArgs.update_training.parse(raw);
      const session = state.sessions.find((s) => s.id === a.session_id);
      if (!session)
        throw Error(
          "That workout is not in the journal. Read the journal first.",
        );
      return {
        kind: "update_session",
        sessionId: session.id,
        workout: workoutFrom(a.title, session.date, a.exercises),
      };
    }
    case "log_meal": {
      const a = voiceToolArgs.log_meal.parse(raw);
      return { kind: "record_meal", meal: mealFrom(a, a.photo_ids ?? []) };
    }
    case "update_meal": {
      const a = voiceToolArgs.update_meal.parse(raw);
      const meal = state.nutrition.meals.find((m) => m.id === a.meal_id);
      if (!meal)
        throw Error("That meal is not in the journal. Read the journal first.");
      return {
        kind: "update_meal",
        mealId: meal.id,
        meal: mealFrom(a, a.photo_ids ?? meal.photoIds),
      };
    }
    case "delete_meal": {
      const a = voiceToolArgs.delete_meal.parse(raw);
      return { kind: "delete_meal", mealId: a.meal_id };
    }
    case "log_drink": {
      const { summary: _summary, ...drink } =
        voiceToolArgs.log_drink.parse(raw);
      void _summary;
      return { kind: "log_drink", drink };
    }
    case "log_body_fat": {
      const { summary: _summary, ...bodyFat } =
        voiceToolArgs.log_body_fat.parse(raw);
      void _summary;
      return { kind: "record_body_fat", bodyFat };
    }
    case "delete_drink": {
      const a = voiceToolArgs.delete_drink.parse(raw);
      return { kind: "delete_drink", drinkId: a.drink_id };
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
    case "set_goals": {
      // The summary is for the journal receipt, not part of the goals.
      const details = Object.entries(voiceToolArgs.set_goals.parse(raw));
      return {
        kind: "set_body_goals",
        bodyGoals: bodyGoalsRequestSchema.parse(
          Object.fromEntries(details.filter(([key]) => key !== "summary")),
        ),
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
  | { ok: true; data: unknown }
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
  if (input.name === "read_journal") {
    const { from, to } = voiceToolArgs.read_journal.parse(input.args);
    const { state } = await readJournal(userId);
    return {
      ok: true,
      data: journalForVoice(
        state,
        from,
        to,
        await routeNotesFor(userId, state, from, to),
      ),
    };
  }
  if (input.name === "list_photos") {
    const { from, to } = voiceToolArgs.list_photos.parse(input.args);
    const inRange = dayRange(from, to);
    const photos = (await listUserImages(userId))
      .filter((p) => inRange(p.date))
      .slice(0, 40)
      .map((p) => ({
        photo_id: p.id,
        date: p.date,
        category: p.category,
        label: p.label,
        tags: p.classification?.tags ?? [],
      }));
    return { ok: true, data: { photos } };
  }
  if (input.name === "recall_conversations") {
    const { query } = voiceToolArgs.recall_conversations.parse(input.args);
    return {
      ok: true,
      data: {
        conversations: query
          ? await searchConversations(userId, query)
          : await recentConversations(userId, { limit: 10 }),
      },
    };
  }
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
          : "drink" in action
            ? action.drink.date
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
    ...(prepared.targets ? { targets: prepared.targets } : {}),
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
