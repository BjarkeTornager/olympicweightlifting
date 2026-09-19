import { z } from "zod";
import { ApiError } from "./agent/http";

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
  console.error(
    JSON.stringify({
      event: "tracking_request_failed",
      type: error instanceof Error ? error.name : "unknown",
    }),
  );
  return trackingResponse(
    { error: "This connection is temporarily unavailable. Please try again." },
    503,
  );
}
