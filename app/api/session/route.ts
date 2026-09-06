import { isOwnerEmail, userAllowed } from "@/lib/access";
import { getAuth, googleEnabled, localPasswordEnabled } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
    return Response.json({
      user: null,
      google: false,
      localPassword: false,
      configured: false,
      canInvite: false,
    });
  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    const admitted =
      session && (await userAllowed(session.user)) ? session : null;
    return Response.json({
      user: admitted
        ? {
            id: admitted.user.id,
            name: admitted.user.name,
            email: admitted.user.email,
          }
        : null,
      canInvite: Boolean(admitted && isOwnerEmail(admitted.user.email)),
      expiresAt: admitted?.session.expiresAt.toISOString() ?? null,
      google: googleEnabled(),
      localPassword: localPasswordEnabled(),
      configured: true,
    });
  } catch {
    return Response.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503 },
    );
  }
}
