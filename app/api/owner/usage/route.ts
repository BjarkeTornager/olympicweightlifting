import { isOwnerEmail } from "@/lib/access";
import { ApiError, apiFailure, requireAthlete } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
import { loadUsageReport } from "@/lib/usage-report";

export const dynamic = "force-dynamic";

// Totals and averages across all accounts, for the owner only.
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    if (!isOwnerEmail(user.email))
      throw new ApiError("Only the owner can see usage.", 403);
    if (!(await allowRequest(user.id, "owner-usage", 20)))
      throw new ApiError("Please wait a minute before refreshing.", 429);
    return Response.json(await loadUsageReport(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
