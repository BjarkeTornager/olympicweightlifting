import { betterAuth, APIError, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "./db";
import * as schema from "./db/schema";
export const localPasswordEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.LOCAL_PASSWORD_AUTH === "true";
export const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export function pilotEmailAllowed(email: string) {
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return (
    allowed.includes(email.toLowerCase()) ||
    (!allowed.length && process.env.NODE_ENV !== "production")
  );
}
let instance: ReturnType<typeof betterAuth> | undefined;
export function getAuth() {
  if (instance) return instance;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw Error("Set a random BETTER_AUTH_SECRET of at least 32 characters");
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production" && !allowed.length)
    throw Error("Set ALLOWED_EMAILS for the private pilot");
  const options: BetterAuthOptions = {
    logger: {
      level: "error",
      log: (level) =>
        console.error(JSON.stringify({ event: "auth_event", level })),
    },
    appName: "Lift Journal",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    socialProviders: googleEnabled()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            accessType: "online",
            prompt: "select_account",
          },
        }
      : {},
    emailAndPassword: {
      enabled: localPasswordEnabled(),
      minPasswordLength: 12,
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 30 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!pilotEmailAllowed(user.email))
              throw new APIError("FORBIDDEN", {
                message: "This journal is invitation only.",
              });
            return { data: user };
          },
        },
      },
    },
  };
  instance = betterAuth(options);
  return instance;
}
