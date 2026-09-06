import { userAllowed } from "@/lib/access";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { journalSchema } from "@/lib/model";
import {
  readJournal,
  writeJournal,
  RevisionConflict,
  MutationConflict,
  MissingMealPhoto,
  allowRequest,
} from "@/lib/server";
import { planProgramDay } from "@/js/progression.js";
import { days, program, today } from "@/lib/domain";
export const dynamic = "force-dynamic";
const schema = z.object({
  state: journalSchema,
  revision: z.number().int().min(0),
  mutationId: z.string().uuid(),
});
async function identity(request: Request) {
  const user = (await getAuth().api.getSession({ headers: request.headers }))
    ?.user;
  return user && (await userAllowed(user)) ? user : undefined;
}
export async function GET(request: Request) {
  try {
    const user = await identity(request);
    if (!user)
      return Response.json(
        { error: "Sign in to sync your journal." },
        { status: 401 },
      );
    if (request.headers.get("x-journal-account") !== user.id)
      return Response.json(
        { error: "The signed-in account changed. Reload before syncing." },
        { status: 401 },
      );
    const snapshot = await readJournal(user.id);
    return Response.json({
      accountId: user.id,
      ...snapshot,
      plans: days.map((day) => ({
        id: day.id,
        ...planProgramDay(day, {
          sessions: snapshot.state.sessions,
          programId: program.id,
          date: today(),
        }),
      })),
    });
  } catch {
    return Response.json(
      {
        error:
          "Your journal could not be loaded. Your local copy is still available.",
      },
      { status: 503 },
    );
  }
}
export async function PUT(request: Request) {
  // Explicit origin verification supplements cookie SameSite for this custom API.
  const expected = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expected)
    return Response.json(
      { error: "Untrusted request origin." },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  try {
    const user = await identity(request);
    if (!user)
      return Response.json(
        { error: "Sign in again to sync." },
        { status: 401 },
      );
    if (request.headers.get("x-journal-account") !== user.id)
      return Response.json(
        { error: "The signed-in account changed. Reload before syncing." },
        { status: 401 },
      );
    if (!(await allowRequest(user.id)))
      return Response.json(
        { error: "Too many saves. Retrying shortly." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "Missing request body." }, { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        return Response.json(
          { error: "Backup exceeds 5 MB." },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const input = schema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    return Response.json({
      accountId: user.id,
      ...(await writeJournal(user.id, input)),
    });
  } catch (error) {
    if (error instanceof RevisionConflict)
      return Response.json(
        { error: error.message, ...error.snapshot },
        { status: 409 },
      );
    if (error instanceof MutationConflict || error instanceof MissingMealPhoto)
      return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json(
        {
          error:
            "Invalid journal data. Check workout values, meal portions, nutrition, dates and backup format.",
        },
        { status: 400 },
      );
    console.error(
      JSON.stringify({
        event: "journal_save_failed",
        type: error instanceof Error ? error.name : "unknown",
      }),
    );
    return Response.json(
      { error: "Sync is unavailable. Changes are saved on this device." },
      { status: 503 },
    );
  }
}
