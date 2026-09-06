import { turnInputSchema } from "@/lib/agent/input";
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
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request),
      config = providerConfig();
    return Response.json(
      {
        enabled: Boolean(config),
        provider: config?.label ?? null,
        protocol: "ag-ui",
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
    const input = turnInputSchema.parse(await readJson(request));
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
