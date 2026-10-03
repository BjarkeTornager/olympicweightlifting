import { createHmac } from "node:crypto";
import { traceAdminConfig } from "./config";

// Pseudonymous codes that link traces to an account, a Coach day or a call
// without carrying the id itself. The same secret always gives the same code,
// so an account's traces can be found and deleted with it. Rotating
// TRACE_USER_SECRET orphans older traces until the retention expiry removes
// them.
export function traceCode(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

export function userCode(secret: string, userId: string) {
  return traceCode(secret, `user:${userId}`);
}

export function sessionCode(secret: string, key: string) {
  return traceCode(secret, `session:${key}`);
}

// The code an account's traces carry, or null without MLflow or a secret.
// It doesn't depend on TRACING, so traces sent before capture was turned off
// are still found. Compute it before the account is deleted.
export function accountTraceCode(userId: string) {
  const secret = traceAdminConfig()?.userSecret;
  return secret ? userCode(secret, userId) : null;
}
