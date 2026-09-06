import { z } from "zod";
import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { agentProposals, agentTurns } from "../db/schema";
import { days, EXERCISES, exerciseName, program, uid } from "../domain";
import { planProgramDay } from "../../js/progression.js";
import { readJournal, writeJournal } from "../server";
import { trainingSummary, workoutTotals } from "../training";
import type { Workout } from "../model";
import { actionSchema, actionToolSchema, prepareAction, type ActionPreview } from "./actions";
import { ApiError } from "./http";
import { callModel, type ModelMessage, type ToolDefinition } from "./provider";
import { siteHelp, systemPrompt } from "./knowledge";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z
  .object({
    from: date.optional(),
    to: date.optional(),
    exerciseId: z.string().max(160).optional(),
  })
  .strict();
const specifications = {
  training_summary: {
    schema: range,
    description:
      "Totals, rep records and recent session summaries for this athlete, optionally filtered by dates/exercise.",
  },
  find_sessions: {
    schema: range.extend({
      offset: z.number().int().min(0).max(5000).optional(),
    }),
    description:
      "Find owned sessions by date/exercise, 20 at a time; returns IDs for read_session.",
  },
  read_session: {
    schema: z.object({ sessionId: z.string().max(160) }).strict(),
    description:
      "Read a full session before discussing detailed sets or updating it.",
  },
  current_workout: {
    schema: z.object({}).strict(),
    description:
      "Read the current unfinished workout and logged/planned sets. Required before logging sets or finishing.",
  },
  programmes: {
    schema: z.object({ date: date }).strict(),
    description:
      "Current programme days, exercise targets and progression reasons calculated by the site's rules, plus personal routine summaries.",
  },
  exercises: {
    schema: z.object({ query: z.string().max(100).optional() }).strict(),
    description:
      "Look up supported exercise IDs and technique information. Use these IDs in changes.",
  },
  site_help: {
    schema: z.object({}).strict(),
    description:
      "Read the app's actual features, screens, sync behaviour and account options.",
  },
  prepare_change: {
    schema: actionToolSchema,
    description:
      "Prepare one validated change requested by the athlete. Nothing is saved until the athlete reviews and confirms the proposal. Never guess missing weights/reps/date. record_session is completed history; plan_workout is an unlogged draft. update_session replaces every exercise and set. log_sets fills unlogged draft sets before appending.",
  },
};
export const toolDefinitions: ToolDefinition[] = Object.entries(
  specifications,
).map(([name, s]) => ({
  type: "function",
  function: {
    name,
    description: s.description,
    parameters: z.toJSONSchema(s.schema),
  },
}));
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
            weight: s.weight,
            reps: s.reps,
            result: s.result,
            logged: Boolean(s.logged || s.result),
            rpe: s.rpe,
          })),
        })),
      }
    : null;
export function athleteDate(timezone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
}
export async function history(userId: string) {
  const rows = await getDb()
    .select()
    .from(agentTurns)
    .where(eq(agentTurns.userId, userId))
    .orderBy(desc(agentTurns.createdAt))
    .limit(40);
  return rows.reverse().map((r) => ({
    id: r.id,
    question: r.question,
    ...r.response,
    status: r.status,
  }));
}
export async function runTurn(
  userId: string,
  input: { id: string; message: string; revision: number; timezone: string },
  model = callModel,
) {
  const db = getDb();
  const existing = await db
    .select()
    .from(agentTurns)
    .where(and(eq(agentTurns.id, input.id), eq(agentTurns.userId, userId)));
  if (existing[0]) {
    if (existing[0].question !== input.message)
      throw new ApiError("That message identifier was already used.", 409);
    if (existing[0].response) return existing[0].response;
    throw new ApiError(
      "That request is still running or failed. Send a new message to try again.",
      409,
    );
  }
  const snapshot = await readJournal(userId);
  if (snapshot.revision !== input.revision)
    throw new ApiError(
      "Sync your latest journal changes before asking the assistant.",
      409,
    );
  const currentDate = athleteDate(input.timezone),
    recent = await history(userId);
  const inserted = await db
    .insert(agentTurns)
    .values({ id: input.id, userId, question: input.message })
    .onConflictDoNothing()
    .returning({ id: agentTurns.id });
  if (!inserted.length)
    throw new ApiError("That request is already being processed.", 409);
  const messages: ModelMessage[] = [
    { role: "system", content: systemPrompt(currentDate, input.timezone) },
    ...recent
      .filter((r) => r.status === "done")
      .slice(-4)
      .flatMap((r) => [
        { role: "user" as const, content: r.question.slice(0, 4000) },
        { role: "assistant" as const, content: (r.reply ?? "").slice(0, 4000) },
      ]),
    { role: "user", content: input.message },
  ];
  const proposals: ActionPreview[] = [],
    readSessions = new Set<string>();
  let readDraft = false,
    calls = 0;
  const signal = AbortSignal.timeout(90000);
  try {
    // Short-lived proposals contain recovery snapshots. Conversation is retained for 90 days.
    await db
      .delete(agentProposals)
      .where(
        and(
          eq(agentProposals.userId, userId),
          lt(agentProposals.expiresAt, new Date()),
        ),
      );
    await db
      .delete(agentTurns)
      .where(
        and(
          eq(agentTurns.userId, userId),
          lt(agentTurns.createdAt, new Date(Date.now() - 90 * 86400000)),
        ),
      );
    let reply =
      "I couldn’t finish that request. Try a shorter question or use Train to log your session.";
    for (let round = 0; round < 5; round++) {
      const result = await model(messages, toolDefinitions, signal);
      messages.push(result);
      if (!result.tool_calls?.length) {
        reply = result.content.trim() || reply;
        break;
      }
      for (const call of result.tool_calls) {
        if (++calls > 10)
          throw new ApiError(
            "That request needs too many steps. Try asking about one session at a time.",
            422,
          );
        const name = call.function.name;
        let output: unknown;
        try {
          if (!(name in specifications))
            throw Error("This tool is not available.");
          const key = name as keyof typeof specifications,
            args = specifications[key].schema.parse(call.function.arguments);
          if (key === "training_summary") {
            const a = range.parse(args);
            output = trainingSummary(
              snapshot.state,
              a.from,
              a.to ?? currentDate,
              a.exerciseId,
            );
          } else if (key === "find_sessions") {
            const a = specifications.find_sessions.schema.parse(args);
            const found = snapshot.state.sessions
              .filter(
                (w) =>
                  (!a.from || w.date >= a.from) &&
                  w.date <= (a.to ?? currentDate) &&
                  (!a.exerciseId ||
                    w.exercises.some((e) => e.exerciseId === a.exerciseId)),
              )
              .sort((a, b) => b.date.localeCompare(a.date));
            const offset = a.offset ?? 0;
            output = {
              total: found.length,
              nextOffset: offset + 20 < found.length ? offset + 20 : null,
              sessions: found.slice(offset, offset + 20).map((w) => ({
                id: w.id,
                title: w.title,
                date: w.date,
                ...workoutTotals(w),
              })),
            };
          } else if (key === "read_session") {
            const a = specifications.read_session.schema.parse(args);
            const w = snapshot.state.sessions.find((w) => w.id === a.sessionId);
            if (!w) throw Error("That session is not in your journal.");
            output = publicWorkout(w);
            if (JSON.stringify(output).length > 40000)
              throw Error(
                "This session is too large for the assistant. Open it in History.",
              );
            readSessions.add(w.id);
          } else if (key === "current_workout") {
            output = publicWorkout(snapshot.state.activeWorkout);
            if (JSON.stringify(output).length > 40000)
              throw Error(
                "This draft is too large for the assistant. Open it in Train.",
              );
            readDraft = true;
          } else if (key === "programmes") {
            const a = specifications.programmes.schema.parse(args);
            output = {
              program: program.name,
              days: days.map((day) => ({
                id: day.id,
                title: day.title,
                focus: day.focus,
                exercises: day.exercises,
                targets: planProgramDay(day, {
                  sessions: snapshot.state.sessions,
                  programId: program.id,
                  date: a.date,
                }),
              })),
              routines: snapshot.state.templates,
            };
          } else if (key === "exercises") {
            const a = specifications.exercises.schema.parse(args);
            output = EXERCISES.filter(
              (e) =>
                !a.query ||
                `${e.id} ${e.name}`
                  .toLowerCase()
                  .includes(a.query.toLowerCase()),
            );
          } else if (key === "site_help") output = siteHelp;
          else {
            if (proposals.length)
              throw Error("Only one proposal can be prepared at a time.");
            const action = actionSchema.parse(args);
            if (
              action.kind === "update_session" &&
              !readSessions.has(action.sessionId)
            )
              throw Error("Read the full original session first.");
            if (
              (action.kind === "log_sets" ||
                action.kind === "finish_workout") &&
              !readDraft
            )
              throw Error("Read the current workout first.");
            const prepared = prepareAction(snapshot.state, action, currentDate),
              id = uid(),
              expiresAt = new Date(Date.now() + 86400000);
            if (
              Buffer.byteLength(JSON.stringify(prepared.state)) >
              5 * 1024 * 1024
            )
              throw Error("Your journal is too large for this change.");
            const preview: ActionPreview = {
              id,
              title: prepared.title,
              detail: prepared.detail,
              workout: prepared.workout,
              expiresAt: expiresAt.toISOString(),
            };
            await db.insert(agentProposals).values({
              id,
              userId,
              turnId: input.id,
              revision: snapshot.revision,
              before: snapshot.state,
              after: prepared.state,
              preview,
              undoId: uid(),
              expiresAt,
            });
            proposals.push(preview);
            output = { prepared: true, saved: false, review: preview };
          }
        } catch (e) {
          output = {
            error:
              e instanceof z.ZodError
                ? "Invalid tool arguments. Use the schema, supported exercise IDs and complete training details."
                : e instanceof Error
                  ? e.message
                  : "Could not complete this tool.",
          };
        }
        const encoded = JSON.stringify(output);
        messages.push({
          role: "tool",
          tool_name: name,
          tool_call_id: call.id,
          content:
            encoded.length > 60000
              ? JSON.stringify({
                  error: "Too much data. Narrow the date or exercise filter.",
                })
              : encoded,
        });
        if (proposals.length) break;
      }
      if (proposals.length) {
        reply =
          "Ready for your review. Check the date, exercises and sets below, then save when they look right.";
        break;
      }
    }
    const response = { reply, proposals };
    await db
      .update(agentTurns)
      .set({ status: "done", response })
      .where(and(eq(agentTurns.id, input.id), eq(agentTurns.userId, userId)));
    return response;
  } catch (e) {
    await db
      .update(agentTurns)
      .set({ status: "failed" })
      .where(and(eq(agentTurns.id, input.id), eq(agentTurns.userId, userId)));
    throw e;
  }
}
export async function applyProposal(userId: string, id: string, undo = false) {
  return getDb().transaction(async (db) => {
    const [proposal] = await db
      .select()
      .from(agentProposals)
      .where(and(eq(agentProposals.id, id), eq(agentProposals.userId, userId)))
      .for("update");
    if (!proposal || proposal.expiresAt.getTime() < Date.now())
      throw new ApiError(
        "This proposal has expired. Ask the assistant to prepare it again.",
        410,
      );
    if (!undo && proposal.status === "undone")
      throw new ApiError(
        "This change was undone. Prepare a new proposal to save it again.",
        409,
      );
    if (undo && proposal.status === "pending")
      throw new ApiError("This change has not been saved.", 409);
    const result = await writeJournal(
      userId,
      {
        state: undo ? proposal.before : proposal.after,
        revision: proposal.revision + (undo ? 1 : 0),
        mutationId: undo ? proposal.undoId : proposal.id,
      },
      db,
    );
    const status = undo ? "undone" : "saved";
    await db
      .update(agentProposals)
      .set({ status })
      .where(and(eq(agentProposals.id, id), eq(agentProposals.userId, userId)));
    const [turn] = await db
      .select()
      .from(agentTurns)
      .where(
        and(eq(agentTurns.id, proposal.turnId), eq(agentTurns.userId, userId)),
      );
    if (turn?.response)
      await db
        .update(agentTurns)
        .set({
          response: {
            ...turn.response,
            proposals: turn.response.proposals.map((p) =>
              p.id === id ? { ...p, status } : p,
            ),
          },
        })
        .where(eq(agentTurns.id, turn.id));
    return { accountId: userId, ...result, status };
  });
}
