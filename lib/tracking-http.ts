import { z } from "zod";
import { ApiError } from "./agent/http";
import { logFailure } from "./error-log";

export const trackingResponse = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export function trackingFailure(error: unknown) {
  if (error instanceof ApiError)
    return trackingResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return trackingResponse({ error: "Check the details and try again." }, 400);
  const incident = logFailure("tracking_request_failed", error);
  return trackingResponse(
    {
      error: "This connection is temporarily unavailable. Please try again.",
      incident,
    },
    503,
  );
}
