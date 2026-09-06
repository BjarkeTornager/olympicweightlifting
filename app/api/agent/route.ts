import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agentTurns } from "@/lib/db/schema";
import { allowRequest } from "@/lib/server";
import {
  ApiError,
  apiFailure,
  readJson,
  requireAthlete,
} from "@/lib/agent/http";
import { history, runTurn } from "@/lib/agent/engine";
import { providerConfig } from "@/lib/agent/provider";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const inputSchema = z
  .object({
    id: z.string().uuid(),
    message: z.string().trim().min(1).max(6000),
    photoIds: z.array(z.string().uuid()).max(4).default([]),
    revision: z.number().int().min(0),
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
  })
  .strict();
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request),
      config = providerConfig();
    return Response.json(
      {
        enabled: Boolean(config),
        provider: config?.label ?? null,
        turns: await history(user.id),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!providerConfig())
      throw new ApiError(
        "The training assistant is not connected yet. You can keep logging in Train.",
        503,
      );
    if (!(await allowRequest(user.id, "agent", 10)))
      throw new ApiError(
        "Please wait a minute before sending another message.",
        429,
      );
    const input = inputSchema.parse(await readJson(request));
    return Response.json(await runTurn(user.id, input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiFailure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    await getDb().delete(agentTurns).where(eq(agentTurns.userId, user.id));
    return Response.json({ cleared: true });
  } catch (e) {
    return apiFailure(e);
  }
}
