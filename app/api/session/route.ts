import {
  getAuth,
  googleEnabled,
  localPasswordEnabled,
  pilotEmailAllowed,
} from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
    return Response.json({
      user: null,
      google: false,
      localPassword: false,
      configured: false,
    });
  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    return Response.json({
      user:
        session && pilotEmailAllowed(session.user.email)
          ? {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
            }
          : null,
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
