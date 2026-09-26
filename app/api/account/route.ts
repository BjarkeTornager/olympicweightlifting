import { getPool } from "@/lib/db";
import { isOwnerEmail, normalizeEmail } from "@/lib/access";
import { ApiError, apiFailure, requireAthlete } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";

export const dynamic = "force-dynamic";

// Permanently deletes the signed-in member's account (App Store guideline
// 5.1.1(v)). Every table holding personal data cascades from users: journal,
// workouts, photos, videos, voice transcripts, Coach turns, Apple Health
// imports, reminders, sessions and sign-in accounts. The member's invitation
// goes too, so coming back needs a new one. The owner's account holds every
// invitation, so it cannot be deleted this way.
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
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
