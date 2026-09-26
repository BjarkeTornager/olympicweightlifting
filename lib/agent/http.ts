import { userAllowed } from "@/lib/access";
import { z } from "zod";
import { logFailure } from "../error-log";
import { getAuth } from "../auth";
import { RevisionConflict, MissingMealPhoto } from "../server";
import { ProviderError } from "./provider";
import {
  nativeClient,
  nativeSupported,
  nativeUpdateMessage,
} from "../native-client";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function requireCurrentCoach(request: Request) {
  // Installed apps are versioned by build, not by the website's feature headers.
  const native = nativeClient(request);
  if (native) {
    if (!nativeSupported(native)) throw new ApiError(nativeUpdateMessage, 426);
    return;
  }
  if (
    request.headers.get("x-coach-journal-version") !== "1" ||
    request.headers.get("x-training-programs-version") !== "2"
  )
    throw new ApiError(
      "Refresh the website to use the updated Coach and review every entry. Your journal is safe.",
      426,
    );
}
// For endpoints that expose nothing account-specific (such as the public
// Maps browser key). A 401 here signs the browser out, so use it only where a
// missing session is the sole reason to refuse.
export async function requireSignedIn(request: Request) {
  const user = (await getAuth().api.getSession({ headers: request.headers }))
    ?.user;
  if (!user || !(await userAllowed(user)))
    throw new ApiError("Sign in to use your personal journal.", 401);
  return user;
}
export async function requireAthlete(request: Request, mutation = false) {
  if (mutation) {
    const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    if (request.headers.get("origin") !== origin)
      throw new ApiError("Untrusted request origin.", 403);
  }
  const user = await requireSignedIn(request);
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
          "Your journal changed while Coach was preparing this entry. Sync and retry your request so Coach can use the latest records. No changes were overwritten.",
      },
      { status: 409 },
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json(
      { error: "Check your message and try again." },
      { status: 400 },
    );
  const incident = logFailure("agent_request_failed", error);
  return Response.json(
    {
      error:
        "The assistant is temporarily unavailable. Your journal is safe; you can keep logging in Train.",
      incident,
    },
    { status: 503 },
  );
}
