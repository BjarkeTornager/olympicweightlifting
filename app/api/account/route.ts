import { after } from "next/server";
import { getPool } from "@/lib/db";
import { isOwnerEmail, normalizeEmail } from "@/lib/access";
import { ApiError, apiFailure, requireAthlete } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
import { accountTraceCode } from "@/lib/tracing/ids";
import { deleteAccountTraces } from "@/lib/tracing/admin";

export const dynamic = "force-dynamic";

// Permanently deletes the signed-in member's account (App Store guideline
// 5.1.1(v)). Every table holding personal data cascades from users: journal,
// workouts, photos, videos, voice transcripts, Coach turns and their
// pictures, Apple Health
// imports, reminders, sessions and sign-in accounts. The member's invitation
// goes too, so coming back needs a new one. Its diagnostic traces in MLflow
// (lib/tracing) are deleted just after the reply. The owner's account holds
// every invitation, so it cannot be deleted this way.
export async function DELETE(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (isOwnerEmail(user.email))
      throw new ApiError(
        "The owner account can't be deleted from the app, because it holds everyone's invitations.",
        409,
      );
    if (!(await allowRequest(user.id, "account-delete", 3)))
      throw new ApiError("Please wait before trying again.", 429);
    // The code the account's traces carry; null without MLflow.
    const traces = accountTraceCode(user.id);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM journal_invitations WHERE email=$1", [
        normalizeEmail(user.email),
      ]);
      await client.query("DELETE FROM users WHERE id=$1", [user.id]);
      await client.query(
        "DELETE FROM request_limits WHERE key LIKE '%:' || $1",
        [user.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // Best effort, once the reply is sent; the 30-day expiry is the
    // backstop.
    if (traces) after(() => deleteAccountTraces(traces));
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
