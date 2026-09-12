import { userAllowed } from "@/lib/access";
import { getAuth } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin)
    return Response.json(
      { error: "Untrusted request origin." },
      { status: 403 },
    );
  try {
    const user = (await getAuth().api.getSession({ headers: request.headers }))
      ?.user;
    if (!user || !(await userAllowed(user)))
      return Response.json({ error: "Sign in again." }, { status: 401 });
    if (request.headers.get("x-journal-account") !== user.id)
      return Response.json(
        { error: "Your account changed. Reload before continuing." },
        { status: 401 },
      );
    await getAuth().api.revokeOtherSessions({ headers: request.headers });
    return Response.json({ revoked: true });
  } catch {
    return Response.json(
      { error: "Could not sign out other devices." },
      { status: 503 },
    );
  }
}
