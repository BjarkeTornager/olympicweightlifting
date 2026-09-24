import { randomUUID } from "node:crypto";
import { ProviderError } from "./agent/provider";

// A diagnosable name for a failure that never includes account content:
// only error classes, HTTP statuses and PostgreSQL error codes.
export function errorCategory(error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.status === 402) return "provider_budget_exhausted";
    if (error.status === 429) return "provider_rate_limited";
    if (error.status >= 500) return "provider_unavailable";
    return `provider_${error.status}`;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError")
      return "timeout";
    const code = (error as { code?: unknown }).code;
    // PostgreSQL SQLSTATE codes are five characters, e.g. 53100 (disk full).
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code))
      return `database_${code}`;
    if (typeof code === "string" && /^E[A-Z]+$/.test(code))
      return `network_${code.toLowerCase()}`;
    if (error.name === "TypeError" && /fetch/i.test(error.message))
      return "network";
    return error.name || "Error";
  }
  return "unknown";
}

// Logs one failure as a JSON line with a short incident ID that is also
// returned to the client, so a reported failure can be found in the logs.
export function logFailure(
  event: string,
  error: unknown,
  details: Record<string, string | number | boolean | null> = {},
  level: "error" | "warn" = "error",
) {
  const incident = randomUUID().slice(0, 8);
  console[level](
    JSON.stringify({
      event,
      category: errorCategory(error),
      incident,
      ...details,
    }),
  );
  return incident;
}
