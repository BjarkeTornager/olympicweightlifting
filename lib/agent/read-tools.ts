import { listVideos } from "../video/store";
import { weeklyReview } from "../weekly-review";
import { liftingReview } from "../lifting-coach";
import { liftingGuide } from "./lifting-guide";
import { liftingKnowledge } from "../lifting-resources";
import { days, exerciseName, program } from "../domain";
import { trainingPrograms, ownedProgram } from "../training-programs";
import { searchExercises } from "../exercises";
import { planProgramDay } from "../../js/progression.js";
import { trainingSummary, workoutTotals } from "../training";
import type { JournalState, Workout } from "../model";
import { queryFoodJournal } from "../nutrition";
import { cardioSummary } from "../cardio";
import { dailyHealth } from "../health";
import { listFoodPhotos } from "../food-photos";
import { listUserImages } from "../user-images";
import { siteHelp } from "./knowledge";
import { imageTiming } from "./time-context";
import { range, specifications, type ToolArgs } from "./tools";

type DateRange = { from: string; to: string };
// What the model has read during one turn. A change may only rely on records
// read here first, so an entry is never written over data the model never saw.
export type TurnReads = {
  draft: boolean;
  food: boolean;
  coachMemory: boolean;
  liftingReview: boolean;
  sessions: Set<string>;
  meals: Set<string>;
  routines: Set<string>;
  programs: Set<string>;
  cardio: Set<string>;
  healthDates: Set<string>;
  trainingRanges: DateRange[];
  cardioRanges: DateRange[];
  foodRanges: DateRange[];
};
export const newTurnReads = (): TurnReads => ({
  draft: false,
  food: false,
  coachMemory: false,
  liftingReview: false,
  sessions: new Set(),
  meals: new Set(),
  routines: new Set(),
  programs: new Set(),
  cardio: new Set(),
  healthDates: new Set(),
  trainingRanges: [],
  cardioRanges: [],
  foodRanges: [],
});
export type ReadToolContext = {
  userId: string;
  state: JournalState;
  currentDate: string;
  timezone: string;
  reads: TurnReads;
};

const readToolNames = [
  "lifting_videos",
  "lifting_knowledge",
  "lifting_review",
  "weekly_review",
  "coach_memory",
  "meal_favourites",
  "cardio_journal",
  "image_library",
  "health_overview",
  "food_journal",
  "food_photos",
  "training_summary",
  "find_sessions",
  "read_session",
  "current_workout",
  "training_library",
  "programmes",
  "exercises",
  "site_help",
] as const;
export type ReadToolName = (typeof readToolNames)[number];
export const isReadTool = (name: string): name is ReadToolName =>
  (readToolNames as readonly string[]).includes(name);

const PAGE = 20;
const nextOffset = (offset: number, total: number) =>
  offset + PAGE < total ? offset + PAGE : null;
// Large single records are refused rather than truncated, so an edit is never
// prepared from a partial read.
function limitSize<T>(output: T, message: string) {
  if (JSON.stringify(output).length > 40000) throw Error(message);
  return output;
}

const publicWorkout = (w: Workout | null) =>
  w
    ? {
        id: w.id,
        title: w.title,
        date: w.date,
        category: w.programDayId,
        notes: w.athleteNotes,
        coachNotes: w.coachNotes,
        exercises: w.exercises.map((e) => ({
          id: e.id,
          exerciseId: e.exerciseId,
          name: exerciseName(e.exerciseId),
          notes: e.athleteNotes,
          prescribed: e.prescribed,
          sets: e.sets.map((s) => ({
            id: s.id,
            weight: s.weight,
            reps: s.reps,
            result: s.result,
            logged: Boolean(s.logged || s.result),
            rpe: s.rpe,
          })),
        })),
      }
    : null;

// Answers one journal/catalogue lookup and records what was read in ctx.reads.
export async function runReadTool(
  key: ReadToolName,
  args: unknown,
  ctx: ReadToolContext,
): Promise<unknown> {
  const { userId, state, currentDate, timezone, reads } = ctx;
  switch (key) {
    case "image_library": {
      const a = specifications.image_library.schema.parse(args),
        offset = a.offset ?? 0;
      const all = (await listUserImages(userId, a.category)).filter(
        (p) => (!a.from || p.date >= a.from) && (!a.to || p.date <= a.to),
      );
      return {
        images: all
          .slice(offset, offset + PAGE)
          .map((p) => ({ ...p, ...imageTiming(p, timezone) })),
        total: all.length,
        nextOffset: nextOffset(offset, all.length),
      };
    }
    case "cardio_journal": {
      const a = specifications.cardio_journal.schema.parse(args);
      if (a.from > a.to) throw Error("Choose a valid date range.");
      const summary = cardioSummary(state, a.from, a.to, a.activity);
      const offset = a.offset ?? 0,
        entries = summary.entries.slice(offset, offset + PAGE);
      entries.forEach((s) => reads.cardio.add(s.id));
      if (!a.activity) reads.cardioRanges.push({ from: a.from, to: a.to });
      return {
        ...summary,
        entries,
        nextOffset: nextOffset(offset, summary.sessions),
      };
    }
    case "weekly_review": {
      const { endDate } = args as ToolArgs<"weekly_review">;
      if (endDate > currentDate)
        throw Error("Choose today or an earlier review date.");
      const report = weeklyReview(state, endDate);
      const compact = (period: typeof report.current) => ({
        ...period,
        days: period.days.map((d) => ({
          date: d.date,
          foodComplete: d.foodComplete,
          nutrients: d.nutrients,
          sleepHours: d.checkin?.sleepHours ?? null,
          sources: {
            mealIds: d.meals.slice(0, 20).map((m) => m.id),
            checkinDate: d.checkin?.date ?? null,
            strengthIds: d.strength.slice(0, 20).map((w) => w.id),
            cardioIds: d.cardio.slice(0, 20).map((c) => c.id),
          },
          sourceCounts: {
            meals: d.meals.length,
            strength: d.strength.length,
            cardio: d.cardio.length,
          },
          sourceIdsTruncated:
            d.meals.length > 20 ||
            d.strength.length > 20 ||
            d.cardio.length > 20,
        })),
      });
      return {
        ...report,
        current: compact(report.current),
        previous: compact(report.previous),
      };
    }
    case "lifting_videos": {
      specifications.lifting_videos.schema.parse(args);
      return {
        reviews: (await listVideos(userId)).map((v) => ({
          id: v.id,
          lift: v.analysis?.identification?.lift ?? null,
          selectedLift: v.lift,
          identificationStatus:
            v.analysis?.identification?.status ?? "not_reviewed",
          date: v.date,
          load: v.load,
          status: v.status,
          feedback: v.feedback,
          measurements: v.analysis
            ? {
                status: v.analysis.tracking.status,
                reason: v.analysis.tracking.reason,
                horizontalRangeCm: v.analysis.tracking.horizontalRangeCm,
                riseCm: v.analysis.tracking.riseCm,
                peakUpwardVelocity: v.analysis.tracking.peakUpwardVelocity,
              }
            : null,
        })),
        open: "#coach/lifting/video",
      };
    }
    case "lifting_knowledge":
      return liftingKnowledge(
        specifications.lifting_knowledge.schema.parse(args).topic,
      );
    case "lifting_review": {
      const a = specifications.lifting_review.schema.parse(args);
      if (a.endDate && a.endDate > currentDate)
        throw Error("Choose today or an earlier date for a lifting review.");
      const output = {
        ...liftingReview(state, a.endDate ?? currentDate, a.exerciseId),
        coachingGuide: liftingGuide,
      };
      reads.liftingReview = true;
      return output;
    }
    case "coach_memory":
      reads.coachMemory = true;
      return (
        state.profile.coaching ?? {
          initiative: "gentle",
          focus: "",
          memories: [],
          plans: [],
        }
      );
    case "meal_favourites": {
      const favourites = state.nutrition.favourites ?? [];
      favourites.forEach((m) => reads.meals.add(m.id));
      return { favourites };
    }
    case "health_overview": {
      const a = specifications.health_overview.schema.parse(args);
      const output = dailyHealth(state, a.date);
      reads.healthDates.add(a.date);
      return output;
    }
    case "food_journal": {
      const a = specifications.food_journal.schema.parse(args);
      const result = queryFoodJournal(state.nutrition, a, currentDate);
      result.meals.forEach((m) => reads.meals.add(m.id));
      reads.food = true;
      // Only an unfiltered read shows every meal on those dates.
      if (
        !a.mealType &&
        !a.query &&
        !a.ingredient &&
        !a.foodGroup &&
        !a.evidence
      )
        reads.foodRanges.push({ from: result.from, to: result.to });
      return result;
    }
    case "food_photos": {
      const a = specifications.food_photos.schema.parse(args),
        offset = a.offset ?? 0;
      const all = (await listFoodPhotos(userId)).filter(
        (p) => (!a.from || p.date >= a.from) && (!a.to || p.date <= a.to),
      );
      return {
        photos: all
          .slice(offset, offset + PAGE)
          .map((p) => ({ ...p, ...imageTiming(p, timezone) })),
        total: all.length,
        nextOffset: nextOffset(offset, all.length),
      };
    }
    case "training_summary": {
      const a = range.parse(args);
      return trainingSummary(state, a.from, a.to ?? currentDate, a.exerciseId);
    }
    case "find_sessions": {
      const a = specifications.find_sessions.schema.parse(args);
      if (!a.exerciseId)
        reads.trainingRanges.push({
          from: a.from ?? "0000-01-01",
          to: a.to ?? currentDate,
        });
      const found = state.sessions
        .filter(
          (w) =>
            (!a.from || w.date >= a.from) &&
            w.date <= (a.to ?? currentDate) &&
            (!a.exerciseId ||
              w.exercises.some((e) => e.exerciseId === a.exerciseId)),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      const offset = a.offset ?? 0;
      return {
        total: found.length,
        nextOffset: nextOffset(offset, found.length),
        sessions: found.slice(offset, offset + PAGE).map((w) => ({
          id: w.id,
          title: w.title,
          date: w.date,
          ...workoutTotals(w),
        })),
      };
    }
    case "read_session": {
      const a = specifications.read_session.schema.parse(args);
      const w = state.sessions.find((w) => w.id === a.sessionId);
      if (!w) throw Error("That session is not in your journal.");
      const output = limitSize(
        publicWorkout(w),
        "This session is too large for the assistant. Open it in History.",
      );
      reads.sessions.add(w.id);
      return output;
    }
    case "current_workout": {
      const output = limitSize(
        publicWorkout(state.activeWorkout),
        "This draft is too large for the assistant. Open it in Train.",
      );
      reads.draft = true;
      return output;
    }
    case "training_library": {
      const a = specifications.training_library.schema.parse(args);
      if (a.routineId) {
        const routine = state.templates.find((t) => t.id === a.routineId);
        if (!routine) throw Error("That routine is not in your journal.");
        const output = limitSize(
          { routine },
          "This routine is too large for Coach to edit safely. Open it in Train.",
        );
        reads.routines.add(routine.id);
        return output;
      }
      if (a.programId) {
        const customProgram = ownedProgram(state, a.programId);
        const output = limitSize(
          { program: customProgram },
          "This program is too large for Coach to edit in one reply. Open it in Train.",
        );
        reads.programs.add(customProgram.id);
        return output;
      }
      const query = a.query?.trim().toLocaleLowerCase() ?? "";
      const records = [
        ...state.templates.map((t) => ({
          kind: "routine",
          id: t.id,
          name: t.name,
          exercises: t.exercises.length,
        })),
        ...trainingPrograms(state).map((p) => ({
          kind: "program",
          id: p.id,
          name: p.name,
          days: p.days.length,
        })),
      ].filter((r) => r.name.toLocaleLowerCase().includes(query));
      const offset = a.offset ?? 0;
      return {
        total: records.length,
        records: records.slice(offset, offset + PAGE),
        nextOffset: nextOffset(offset, records.length),
      };
    }
    case "programmes": {
      const a = specifications.programmes.schema.parse(args);
      return {
        program: program.name,
        days: days.map((day) => ({
          id: day.id,
          title: day.title,
          focus: day.focus,
          exercises: day.exercises,
          targets: planProgramDay(day, {
            sessions: state.sessions,
            programId: program.id,
            date: a.date,
          }),
        })),
        routines: state.templates.map((t) => ({
          id: t.id,
          name: t.name,
          exercises: t.exercises.length,
        })),
        customPrograms: trainingPrograms(state).map((p) => ({
          id: p.id,
          name: p.name,
          days: p.days.map((d) => ({ id: d.id, name: d.name })),
        })),
      };
    }
    case "exercises": {
      const a = specifications.exercises.schema.parse(args);
      const found = a.queries
        ? [
            ...new Map(
              a.queries
                .flatMap((q) => searchExercises(q))
                .map((e) => [e.id, e]),
            ).values(),
          ]
        : searchExercises(a.query);
      return found.map((exercise) => ({
        ...(a.queries
          ? {
              id: exercise.id,
              name: exercise.name,
              category: exercise.category,
              loggingNotes: exercise.loggingNotes,
              sourceName: exercise.sourceName,
            }
          : exercise),
        videoUrl: exercise.videoId
          ? `https://www.youtube.com/watch?v=${exercise.videoId}`
          : null,
      }));
    }
    case "site_help":
      return siteHelp;
  }
}
