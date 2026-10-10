import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { agentProposals, agentTurns } from "./db/schema";
import { uid } from "./domain";
import {
  MutationConflict,
  readJournal,
  RevisionConflict,
  writeJournal,
} from "./server";
import { cardioActivitySchema } from "./cardio";
import { foodGroupSchema } from "./nutrition";
import {
  applyGoals,
  bodyGoalsRequestSchema,
  describePlan,
  energyQuestionsFor,
  imperialGoalsSchema,
  metricGoals,
  planForState,
  splitGoals,
  type BodyGoalsRequest,
} from "./body-goals";
import { bodyFatInputSchema } from "./body-composition";
import { drinkInputSchema } from "./hydration";
import { supplementInputSchema } from "./supplements";
import type { JournalState } from "./model";
import { prepareAction, type ActionPreview } from "./agent/actions";
import type { AgentAction } from "./agent/action-schema";
import { guardChange } from "./agent/change-guards";
import { newTurnReads } from "./agent/read-tools";
import { listUserImages } from "./user-images";
import { dayRange, journalForVoice } from "./journal-summary";
import { withSavedTargets } from "./visual-targets";
import {
  recentConversations,
  searchConversations,
} from "./conversation-memory";
import { applyProposal } from "./agent/engine";
import { ApiError } from "./agent/http";
import { VOICE_PREFIX } from "./coach-tasks";
import { routeNotesFor } from "./workout-routes";
import {
  visualSchema,
  type CoachVisual,
  type SavedVisual,
} from "./coach-visuals";
import {
  voiceCardKinds,
  voiceClientReadsBack,
  voiceClientShowsCards,
} from "./voice-checkin";
import {
  PICTURE_DRAWING,
  PICTURE_UNAVAILABLE,
  pictureGate,
  pictureStatus,
  reservePicture,
  type PictureJob,
} from "./coach-pictures";

// Saves requested by the voice coach. They skip a second model: each tool call
// becomes one ordinary journal action, checked by the same guards and saved
// with the same receipt and Undo as a Coach message.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const summarySchema = z.string().trim().min(1).max(500);

// Models send an empty value, zero or null for a field they leave out.
const blank = (v: unknown) =>
  v === "" || v === 0 || v === null ? undefined : v;
const optionalText = (max: number) =>
  z.preprocess(blank, z.string().trim().max(max).optional());
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(blank, schema.optional());
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
            rpe: optionalNumber(z.number().min(1).max(10)),
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

// A number said as text ("72.5") is still that text on a card.
const cellText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "number" ? String(v) : v),
    z.string().trim().max(max),
  );
const cardArgs = z.object({
  summary: summarySchema,
  kind: z.enum(voiceCardKinds),
  title: z.string().trim().min(1).max(120),
  caption: optionalText(400),
  servings: optionalNumber(z.number().int().min(1).max(12)),
  minutes: optionalNumber(z.number().int().min(1).max(600)),
  ingredients: z
    .array(
      z.object({
        item: z.string().trim().min(1).max(80),
        amount: optionalText(40),
      }),
    )
    .max(20)
    .optional(),
  steps: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
  kcal: optionalNumber(z.number().min(0).max(5000)),
  protein_g: optionalNumber(z.number().min(0).max(500)),
  carbs_g: optionalNumber(z.number().min(0).max(500)),
  fat_g: optionalNumber(z.number().min(0).max(500)),
  // recipe: a picture of the dish, drawn after the card is on screen.
  picture: z.boolean().optional(),
  columns: z.array(cellText(120)).max(6).optional(),
  rows: z
    .array(z.object({ cells: z.array(cellText(300)).max(6) }))
    .max(30)
    .optional(),
  unit: optionalText(30),
  points: z
    .array(z.object({ label: cellText(120), value: z.number() }))
    .max(60)
    .optional(),
  target: optionalNumber(z.number()),
  targets: z
    .array(
      z.object({
        label: cellText(120),
        value: z.number(),
        target: z.number(),
        unit: cellText(30).default(""),
      }),
    )
    .max(6)
    .optional(),
  stats: z
    .array(
      z.object({
        label: cellText(120),
        value: cellText(40),
        unit: optionalText(30),
        change: optionalText(40),
      }),
    )
    .max(6)
    .optional(),
});

/** show_card's flat arguments as a Coach visual, checked by the same strict
 * schema as typed Coach's. Fields of other kinds are ignored. */
export function cardVisual(a: z.infer<typeof cardArgs>): CoachVisual {
  const base = { title: a.title, ...(a.caption ? { caption: a.caption } : {}) };
  const nutrition = {
    kcal: a.kcal,
    protein: a.protein_g,
    carbs: a.carbs_g,
    fat: a.fat_g,
  };
  switch (a.kind) {
    case "recipe":
      return visualSchema.parse({
        ...base,
        kind: "recipe",
        servings: a.servings ?? 1,
        ...(a.minutes ? { minutes: a.minutes } : {}),
        ingredients: (a.ingredients ?? []).map((i) => ({
          item: i.item,
          ...(i.amount ? { amount: i.amount } : {}),
        })),
        ...(a.steps?.length ? { steps: a.steps } : {}),
        ...(Object.values(nutrition).some((v) => v !== undefined)
          ? {
              nutrition: Object.fromEntries(
                Object.entries(nutrition).filter(([, v]) => v !== undefined),
              ),
            }
          : {}),
      });
    case "table":
      return visualSchema.parse({
        ...base,
        kind: "table",
        columns: a.columns ?? [],
        rows: (a.rows ?? []).map((r) => r.cells),
      });
    case "bar_chart":
      return visualSchema.parse({
        ...base,
        kind: "bar_chart",
        unit: a.unit ?? "",
        points: a.points ?? [],
      });
    case "line_chart":
      return visualSchema.parse({
        ...base,
        kind: "line_chart",
        unit: a.unit ?? "",
        series: [{ name: a.title, points: a.points ?? [] }],
        ...(a.target !== undefined ? { target: a.target } : {}),
      });
    case "progress":
      return visualSchema.parse({
        ...base,
        kind: "progress",
        targets: a.targets ?? [],
      });
    case "stats":
      return visualSchema.parse({
        ...base,
        kind: "stats",
        stats: (a.stats ?? []).map((s) => ({
          label: s.label,
          value: s.value,
          ...(s.unit ? { unit: s.unit } : {}),
          ...(s.change ? { change: s.change } : {}),
        })),
      });
  }
}

const workoutFrom = (
  title: string,
  day: string,
  exercises: z.infer<typeof exercisesSchema>,
  durationMinutes?: number,
) => ({
  title,
  date: day,
  category: "open" as const,
  ...(durationMinutes != null ? { durationMinutes } : {}),
  exercises: exercises.map((e) => ({
    exerciseId: e.exercise,
    sets: e.sets.map((s) => ({
      weight: s.weight_kg,
      reps: s.reps,
      result: s.made ? ("success" as const) : ("miss" as const),
      ...(s.rpe ? { rpe: s.rpe } : {}),
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

// Models sometimes send 0 for "not said".
const durationMinutes = z.preprocess(
  (v) => v || undefined,
  z.number().int().min(5).max(600).optional(),
);

export const voiceToolArgs = {
  log_training: z.object({
    summary: summarySchema,
    date,
    title: z.string().trim().min(1).max(120),
    finished: z.boolean().default(true),
    // Only when the athlete said how long the workout took.
    duration_minutes: durationMinutes,
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
    duration_minutes: durationMinutes,
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
  log_supplement: supplementInputSchema.extend({
    summary: summarySchema,
    amount: z.preprocess((v) => v ?? "", supplementInputSchema.shape.amount),
  }),
  delete_supplement: z.object({
    summary: summarySchema,
    supplement_id: z.string().uuid(),
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
    // Height and weights in cm and kg, or in feet and inches and pounds as
    // the athlete said them (metricGoals). A zero is no value.
    heightCm: z.preprocess(
      (v) => v || undefined,
      bodyGoalsRequestSchema.shape.heightCm.optional(),
    ),
    weightKg: z.preprocess(
      (v) => v || undefined,
      bodyGoalsRequestSchema.shape.weightKg.optional(),
    ),
    targetWeightKg: z.preprocess(
      (v) => v || undefined,
      bodyGoalsRequestSchema.shape.targetWeightKg.optional(),
    ),
    heightFeet: z.preprocess(
      (v) => v || undefined,
      imperialGoalsSchema.shape.heightFeet,
    ),
    heightInches: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      imperialGoalsSchema.shape.heightInches,
    ),
    weightLb: z.preprocess(
      (v) => v || undefined,
      imperialGoalsSchema.shape.weightLb,
    ),
    targetWeightLb: z.preprocess(
      (v) => v || undefined,
      imperialGoalsSchema.shape.targetWeightLb,
    ),
    // The plan read back to the athlete, once they said yes to saving it
    // (goalsReadBack).
    confirm_id: z.preprocess(
      (v) => v || undefined,
      z.string().max(64).optional(),
    ),
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
    pregnancy: z.preprocess(
      (v) => v || undefined,
      bodyGoalsRequestSchema.shape.pregnancy,
    ),
    // A baby's age of 0 weeks and a "no" are answers; only an empty value
    // means none was given. Weeks come to the nearest whole one.
    weeksSinceBirth: z.preprocess(
      (v) =>
        v === "" || v === null
          ? undefined
          : typeof v === "number"
            ? Math.round(v)
            : v,
      bodyGoalsRequestSchema.shape.weeksSinceBirth,
    ),
    limitProtein: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      bodyGoalsRequestSchema.shape.limitProtein,
    ),
    // A "no" is an answer here too; only an empty value is none. Saying
    // they'd rather not answer leaves it out, by voice.
    energySigns: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      bodyGoalsRequestSchema.shape.energySigns,
    ),
    weightClass: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      bodyGoalsRequestSchema.shape.weightClass,
    ),
  }),
  undo_save: z.object({ save_id: z.string().uuid() }),
  // Not a save: a card on the athlete's screen, kept in the Coach thread.
  show_card: cardArgs,
  // A picture of the dish on a recipe card already shown.
  show_picture: z.object({ card_id: z.string().uuid() }),
};
export type VoiceToolName = keyof typeof voiceToolArgs;
type ReadTool = "read_journal" | "list_photos" | "recall_conversations";
type CardTool = "show_card" | "show_picture";
// Tools only an app that draws cards may call (voiceClientShowsCards).
export const cardTools = new Set<string>([
  "show_card",
  "show_picture",
] satisfies CardTool[]);

/** Why this app can't use a card tool, or nothing when it can. */
export function cardRefusal(name: string, headers: Headers) {
  return cardTools.has(name) && !voiceClientShowsCards(headers)
    ? "This app version can't show cards; give the gist in words."
    : undefined;
}

// Turns a voice tool call into a journal action for the current state.
export function voiceAction(
  name: Exclude<VoiceToolName, "undo_save" | ReadTool | CardTool>,
  raw: unknown,
  state: JournalState,
  today: string,
): AgentAction {
  switch (name) {
    case "log_training": {
      const a = voiceToolArgs.log_training.parse(raw);
      const workout = workoutFrom(
        a.title,
        a.date,
        a.exercises,
        a.duration_minutes,
      );
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
        workout: workoutFrom(
          a.title,
          session.date,
          a.exercises,
          a.duration_minutes,
        ),
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
    case "log_supplement": {
      const { summary: _summary, ...supplement } =
        voiceToolArgs.log_supplement.parse(raw);
      void _summary;
      return { kind: "log_supplement", supplement };
    }
    case "delete_supplement": {
      const a = voiceToolArgs.delete_supplement.parse(raw);
      return { kind: "delete_supplement", supplementId: a.supplement_id };
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
      // The summary is for the journal receipt and confirm_id for the
      // read-back, not part of the goals.
      const {
        summary,
        confirm_id: heard,
        ...details
      } = voiceToolArgs.set_goals.parse(raw);
      void summary;
      const goals = bodyGoalsRequestSchema.parse(metricGoals(details));
      // A call saves with no review card, so the model's confirmation of a
      // low goal weight counts only after a plan asked for it, for that
      // goal weight: the saved plan, or the plan read back in this call
      // (its confirm_id, with the confirmation or before it). Otherwise
      // the plan holds and its note asks.
      if (
        goals.confirmLowWeight &&
        !(
          planForState(state, today)?.confirmToLose &&
          state.profile.body?.targetWeightKg === goals.targetWeightKg
        ) &&
        !(
          heard &&
          (heard === goalsConfirmId(state, goals, today) ||
            heard ===
              goalsConfirmId(
                state,
                { ...goals, confirmLowWeight: undefined },
                today,
              ))
        )
      )
        delete goals.confirmLowWeight;
      return { kind: "set_body_goals", bodyGoals: goals };
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

// The fingerprint of a goals plan as the voice coach reads it back: what it
// says and saves, so a yes counts only for the plan the athlete heard.
function planFingerprint(prepared: { detail: string; targets?: unknown }) {
  return createHash("sha256")
    .update(JSON.stringify([prepared.detail, prepared.targets ?? null]))
    .digest("hex")
    .slice(0, 12);
}
export function goalsConfirmId(
  state: JournalState,
  bodyGoals: BodyGoalsRequest,
  today: string,
) {
  return planFingerprint(
    prepareAction(state, { kind: "set_body_goals", bodyGoals }, today),
  );
}

// What the voice coach reads out before saving goals: everything but a plan
// that holds the athlete's weight with no deficit, nothing to note and no
// saved answer changed, which saves at once. The changes come first, then
// the plan with its calories, every safety note in full and the other notes,
// the agreed check about 3 weeks on, and the low-energy questions when the
// plan cuts without answers in force. Null when the plan may be saved: a
// quiet one, or the plan the athlete heard (confirmId).
export function goalsReadBack(
  state: JournalState,
  bodyGoals: BodyGoalsRequest,
  prepared: {
    detail: string;
    targets?: unknown;
    plan?: { followUpDate: string };
  },
  today: string,
  confirmId?: string,
) {
  const next = structuredClone(state);
  const plan = applyGoals(next, bodyGoals, today);
  const quiet =
    plan.dailyTargets &&
    plan.direction === "maintain" &&
    plan.calories >= plan.maintenanceKcal &&
    !plan.notes.length &&
    !plan.changes.length;
  const id = planFingerprint(prepared);
  if (quiet || confirmId === id) return null;
  const goals = splitGoals(bodyGoals).goals;
  const safety = new Set(plan.safetyNotes);
  return {
    saved: false,
    confirm_id: id,
    changes: plan.changes,
    plan: describePlan(goals, plan),
    safety_notes: plan.safetyNotes,
    other_notes: plan.notes.filter((note) => !safety.has(note)),
    ...(prepared.plan
      ? {
          follow_up: `The calories are a starting estimate; from ${prepared.plan.followUpDate}, about 3 weeks on, Coach checks them against the weight trend with the athlete.`,
        }
      : {}),
    ...(plan.energyCheckDue
      ? {
          ask_first: energyQuestionsFor(
            goals.sex,
            next.profile.goalChecks?.pregnancy,
          ),
        }
      : {}),
    next: `Not saved yet. Say each of changes first and ask whether it's right. Then read the plan's calories and every safety note in full, kindly; other notes can be summed up. ${plan.energyCheckDue ? "Before that, ask the ask_first questions, saying they're optional and kept only as a yes or no with the date so the plan stays safe, then call set_goals again with energySigns (true for any yes, false for no to all, left out if they'd rather not answer). " : ""}Then ask "Shall I save that?", and only after a yes call set_goals again with the same details and this confirm_id.`,
  };
}

export type VoiceResult =
  | { ok: true; saveId?: string; title: string; detail: string }
  // A card, and the picture to draw once the reply has gone (never sent).
  | { ok: true; data: unknown; visual?: SavedVisual; job?: PictureJob }
  | { ok: false; error: string };

// An app before VOICE_READ_BACK_CLIENT marks any ok result saved, with a
// success haptic, so a goals plan read back before saving reaches it as a
// refusal: its receipt never claims a save, and the coach still gets the
// plan to read, its confirm_id and what to do next.
export function forVoiceClient(
  result: VoiceResult,
  headers: Headers,
): VoiceResult {
  if (!result.ok || !("data" in result) || voiceClientReadsBack(headers))
    return result;
  const data = result.data as { saved?: unknown } | null;
  return data?.saved === false
    ? {
        ok: false,
        error: `Not saved yet: read this plan back first, as its next says. ${JSON.stringify(data)}`,
      }
    : result;
}

export async function runVoiceTool(
  userId: string,
  input: {
    id: string;
    name: VoiceToolName;
    args: unknown;
    today: string;
    // Photos the voice coach saw in this call, eligible as meal sources.
    seenPhotoIds: string[];
    // The call this tool ran in (voice_calls.id), kept with a card.
    callId?: string;
  },
): Promise<VoiceResult> {
  if (input.name === "show_card") return showCard(userId, input);
  if (input.name === "show_picture") return showPicture(userId, input);
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
  const { summary } = z
    .object({ summary: summarySchema })
    .passthrough()
    .parse(input.args);
  // The app runs a reply's tool calls at the same time, so two saves can
  // read the same journal revision. The one that loses prepares again
  // against the newer journal instead of reporting a failure.
  for (let attempt = 0; attempt < 4; attempt++) {
    const [existing] = await getDb()
      .select()
      .from(agentTurns)
      .where(and(eq(agentTurns.id, input.id), eq(agentTurns.userId, userId)));
    if (existing?.response) {
      const saved = existing.response.proposals?.[0];
      return saved
        ? {
            ok: true,
            saveId: saved.id,
            title: saved.title,
            detail: saved.detail,
          }
        : { ok: false, error: existing.response.reply };
    }
    try {
      return await saveVoiceAction(
        userId,
        { ...input, name: input.name },
        summary,
      );
    } catch (error) {
      if (error instanceof RevisionConflict) continue;
      // The same call id was saved at the same time: the next pass returns it.
      if (error instanceof MutationConflict || uniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new ApiError(
    "Your journal is busy saving other changes. Try this save again.",
    409,
  );
}

function uniqueViolation(error: unknown) {
  const code =
    (error as { code?: string; cause?: { code?: string } } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "23505";
}

// A card is its own Spoken turn in the Coach thread, with no reply or save:
// the thread draws it after the call like any visual. The phone's tool-call
// id is the turn's id, so a retry after a lost reply shows the same card. A
// recipe asked for with a picture keeps its place in the same transaction;
// the route draws it once the reply has gone.
async function showCard(
  userId: string,
  input: { id: string; args: unknown; today: string; callId?: string },
): Promise<VoiceResult> {
  const db = getDb();
  const picture =
    (input.args as { picture?: unknown } | null)?.picture === true;
  const shown = (visual: SavedVisual, job?: PictureJob): VoiceResult => ({
    ok: true,
    data: {
      shown: true,
      card_id: input.id,
      ...(picture
        ? {
            picture:
              visual.content.kind !== "recipe"
                ? "not available: pictures are only of dishes, on a recipe card"
                : visual.content.pictureId
                  ? PICTURE_DRAWING
                  : PICTURE_UNAVAILABLE,
          }
        : {}),
    },
    visual,
    ...(job ? { job } : {}),
  });
  const existing = async () => {
    const [turn] = await db
      .select()
      .from(agentTurns)
      .where(and(eq(agentTurns.id, input.id), eq(agentTurns.userId, userId)));
    return turn;
  };
  const before = await existing();
  if (before) {
    const visual = before.response?.visuals?.[0];
    if (visual) return shown(visual);
    return { ok: false, error: "That call id was already used." };
  }
  const args = voiceToolArgs.show_card.parse(input.args);
  const card = cardVisual(args);
  // Progress against the athlete's own daily targets (visual-targets.ts).
  const content =
    card.kind === "progress"
      ? withSavedTargets(card, (await readJournal(userId)).state, input.today)
      : card;
  const wanted = picture && content.kind === "recipe";
  // Before the transaction: the AI allowance is looked up, then cached.
  const gate = wanted ? await pictureGate() : undefined;
  try {
    const kept = await db.transaction(
      async (tx): Promise<{ visual: SavedVisual; job?: PictureJob }> => {
        const visual: SavedVisual = { id: uid(), content };
        const response = {
          reply: "",
          proposals: [],
          visuals: [visual],
          ...(input.callId ? { voiceCallId: input.callId } : {}),
        };
        await tx.insert(agentTurns).values({
          id: input.id,
          userId,
          question: `${VOICE_PREFIX}${args.summary}`,
          photoIds: [],
          status: "done",
          response,
        });
        if (!wanted || content.kind !== "recipe") return { visual };
        const reserved = await reservePicture(tx, {
          userId,
          turnId: input.id,
          recipe: content,
          refused: gate,
        });
        if ("refused" in reserved) return { visual };
        const drawn = {
          ...visual,
          content: { ...content, pictureId: reserved.id },
        };
        await tx
          .update(agentTurns)
          .set({ response: { ...response, visuals: [drawn] } })
          .where(
            and(eq(agentTurns.id, input.id), eq(agentTurns.userId, userId)),
          );
        return { visual: drawn, job: reserved.job };
      },
    );
    return shown(kept.visual, kept.job);
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    // The same call id was shown at the same time: return that card.
    const card = (await existing())?.response?.visuals?.[0];
    if (card) return shown(card);
    return { ok: false, error: "That call id was already used." };
  }
}

// A picture of the dish on a recipe card already shown, when the athlete
// wants to see it after all. One picture per card.
async function showPicture(
  userId: string,
  input: { args: unknown },
): Promise<VoiceResult> {
  const { card_id } = voiceToolArgs.show_picture.parse(input.args);
  const gate = await pictureGate();
  return getDb().transaction(async (tx) => {
    const card = and(eq(agentTurns.id, card_id), eq(agentTurns.userId, userId));
    const [turn] = await tx.select().from(agentTurns).where(card).for("update");
    const [visual, ...others] = turn?.response?.visuals ?? [];
    const content = visual?.content;
    if (!turn?.response || content?.kind !== "recipe")
      return {
        ok: false,
        error:
          "Only a recipe card can have a picture: pass the card_id show_card returned for it.",
      };
    const answer = (
      picture: string,
      saved = visual,
      job?: PictureJob,
    ): VoiceResult => ({
      ok: true,
      data: { card_id, picture },
      visual: saved,
      ...(job ? { job } : {}),
    });
    if (content.pictureId) {
      const status = await pictureStatus(tx, userId, content.pictureId);
      return answer(
        status === "ready"
          ? "already on the card"
          : status === "drawing"
            ? PICTURE_DRAWING
            : PICTURE_UNAVAILABLE,
      );
    }
    const reserved = await reservePicture(tx, {
      userId,
      turnId: card_id,
      recipe: content,
      refused: gate,
    });
    if ("refused" in reserved) return answer(PICTURE_UNAVAILABLE);
    const updated = {
      ...visual,
      content: { ...content, pictureId: reserved.id },
    };
    await tx
      .update(agentTurns)
      .set({ response: { ...turn.response, visuals: [updated, ...others] } })
      .where(card);
    return answer(PICTURE_DRAWING, updated, reserved.job);
  });
}

async function saveVoiceAction(
  userId: string,
  input: {
    id: string;
    name: Exclude<VoiceToolName, "undo_save" | ReadTool | CardTool>;
    args: unknown;
    today: string;
    seenPhotoIds: string[];
  },
  summary: string,
): Promise<VoiceResult> {
  const db = getDb();
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
            : "supplement" in action
              ? action.supplement.date
              : "cardio" in action
                ? action.cardio.date
                : input.today;
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
  // Goals are saved only once the athlete has heard them, unless quiet.
  if (action.kind === "set_body_goals") {
    const readBack = goalsReadBack(
      snapshot.state,
      action.bodyGoals,
      prepared,
      input.today,
      voiceToolArgs.set_goals.parse(input.args).confirm_id,
    );
    if (readBack) return { ok: true, data: readBack };
  }
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
    ...(prepared.targetsBefore
      ? { targetsBefore: prepared.targetsBefore }
      : {}),
    ...(prepared.cardio ? { cardio: prepared.cardio } : {}),
    ...(prepared.drink ? { drink: prepared.drink } : {}),
    ...(prepared.plan ? { plan: prepared.plan } : {}),
    ...(prepared.notes?.length ? { notes: prepared.notes } : {}),
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
