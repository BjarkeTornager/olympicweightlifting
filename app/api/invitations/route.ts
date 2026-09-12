import { z } from "zod";
import { getPool } from "@/lib/db";
import { isOwnerEmail, normalizeEmail } from "@/lib/access";
import {
  ApiError,
  apiFailure,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";

export const dynamic = "force-dynamic";
const response = (data: unknown) =>
  Response.json(data, { headers: { "Cache-Control": "no-store" } });
async function requireOwner(request: Request, mutation = false) {
  const user = await requireAthlete(request, mutation);
  if (!isOwnerEmail(user.email))
    throw new ApiError("Only the owner can manage invitations.", 403);
  if (mutation && !(await allowRequest(user.id, "invitations", 20)))
    throw new ApiError(
      "Please wait a minute before changing invitations again.",
      429,
    );
  return user;
}

export async function GET(request: Request) {
  try {
    await requireOwner(request);
    const { rows } = await getPool().query(
      `SELECT i.id, i.email, i.created_at AS "createdAt", i.revoked_at AS "revokedAt",
       EXISTS (SELECT 1 FROM users u JOIN auth_accounts a ON a.user_id=u.id
               WHERE lower(u.email)=i.email AND a.provider_id='google') AS joined
       FROM journal_invitations i ORDER BY i.created_at DESC LIMIT 1000`,
    );
    return response({ invitations: rows });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true);
    const { email } = z
      .object({ email: z.string().trim().toLowerCase().email().max(254) })
      .strict()
      .parse(await readJson(request, 2000));
    if (isOwnerEmail(email))
      throw new ApiError("Your owner account already has access.");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(81521343)");
      const count = await client.query(
        "SELECT count(*)::int AS count FROM journal_invitations",
      );
      const existing = await client.query(
        "SELECT id FROM journal_invitations WHERE email=$1",
        [email],
      );
      if (count.rows[0].count >= 1000 && !existing.rowCount)
        throw new ApiError("The invitation limit has been reached.", 409);
      const { rows } = await client.query(
        `INSERT INTO journal_invitations (id,email,created_by) VALUES ($1,$2,$3)
         ON CONFLICT (email) DO UPDATE SET revoked_at=NULL, created_by=$3, created_at=now()
         RETURNING id`,
        [crypto.randomUUID(), email, owner.id],
      );
      await client.query("COMMIT");
      return response({ id: rows[0].id });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireOwner(request, true);
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await readJson(request, 2000));
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(81521343)");
      const { rows } = await client.query(
        "SELECT email FROM journal_invitations WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!rows[0]) throw new ApiError("Invitation not found.", 404);
      const email = normalizeEmail(rows[0].email);
      if (isOwnerEmail(email))
        throw new ApiError("Your owner account cannot be revoked.");
      await client.query(
        "UPDATE journal_invitations SET revoked_at=now() WHERE id=$1",
        [id],
      );
      await client.query(
        "DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE lower(email)=$1)",
        [email],
      );
      await client.query("COMMIT");
      return response({ revoked: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return apiFailure(error);
  }
}
