import { getPool } from "@/lib/db";
import { getAuth, googleEnabled } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    getAuth();
    if (process.env.NODE_ENV === "production" && !googleEnabled())
      throw Error("Configure Google sign-in");
    await getPool().query("SELECT 1 FROM journals LIMIT 1");
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
