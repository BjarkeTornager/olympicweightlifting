import { userAllowed } from "@/lib/access";
import { z } from "zod";
import { getAuth } from "../auth";
import { RevisionConflict, MissingMealPhoto } from "../server";
import { ProviderError } from "./provider";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function requireAthlete(request: Request, mutation = false) {
  if (mutation) {
    const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    if (request.headers.get("origin") !== origin)
      throw new ApiError("Untrusted request origin.", 403);
  }
  const user = (await getAuth().api.getSession({ headers: request.headers }))
    ?.user;
  if (!user || !(await userAllowed(user)))
    throw new ApiError("Sign in to use your personal journal.", 401);
  if (request.headers.get("x-journal-account") !== user.id)
    throw new ApiError("Your account changed. Reload before continuing.", 401);
  return user;
}
export async function readJson(
  request: Request,
  maxBytes = 24000,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError("Expected JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("Missing request body.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError("Message is too long.", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function apiFailure(error: unknown) {
  if (error instanceof MissingMealPhoto)
    return Response.json(
      { error: error.message },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof ApiError || error instanceof ProviderError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof RevisionConflict)
    return Response.json(
      {
        error:
          "Your journal changed after this proposal was prepared. Sync and ask for an updated proposal. Your existing training is safe.",
      },
      { status: 409 },
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json(
      { error: "Check your message and try again." },
      { status: 400 },
    );
  console.error(
    JSON.stringify({
      event: "agent_request_failed",
      type: error instanceof Error ? error.name : "unknown",
    }),
  );
  return Response.json(
    {
      error:
        "The assistant is temporarily unavailable. Your journal is safe; you can keep logging in Train.",
    },
    { status: 503 },
  );
}
