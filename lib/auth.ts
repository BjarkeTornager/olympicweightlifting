import { betterAuth, APIError, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, getPool } from "./db";
import { assertAccessConfigured, emailAllowed, userAllowed } from "./access";
import * as schema from "./db/schema";
export const localPasswordEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.LOCAL_PASSWORD_AUTH === "true";
export const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
let instance: ReturnType<typeof betterAuth> | undefined;
export function getAuth() {
  if (instance) return instance;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw Error("Set a random BETTER_AUTH_SECRET of at least 32 characters");
  assertAccessConfigured();
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
            overrideUserInfoOnSignIn: true,
            mapProfileToUser: async (profile) => {
              if (
                !profile.email_verified ||
                !(await emailAllowed(profile.email))
              )
                throw new APIError("FORBIDDEN", {
                  message: "This journal is invitation only.",
                });
              return {};
            },
          },
        }
      : {},
    emailAndPassword: {
      enabled: localPasswordEnabled(),
      minPasswordLength: 12,
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    account: { accountLinking: { enabled: false } },
    onAPIError: { errorURL: "/?signin=failed" },
    rateLimit: { enabled: true, window: 60, max: 30 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (
              !(await emailAllowed(user.email)) ||
              (process.env.NODE_ENV === "production" && !user.emailVerified)
            )
              throw new APIError("FORBIDDEN", {
                message: "This journal is invitation only.",
              });
            return { data: user };
          },
        },
        update: {
          before: async (user) => {
            if (
              user.email !== undefined &&
              (!(await emailAllowed(user.email)) ||
                (process.env.NODE_ENV === "production" && !user.emailVerified))
            )
              throw new APIError("FORBIDDEN", {
                message: "This journal is invitation only.",
              });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const result = await getPool().query(
              'SELECT id, email, email_verified AS "emailVerified" FROM users WHERE id=$1',
              [session.userId],
            );
            if (!result.rows[0] || !(await userAllowed(result.rows[0])))
              throw new APIError("FORBIDDEN", {
                message: "This journal is invitation only.",
              });
          },
        },
      },
    },
  };
  instance = betterAuth(options);
  return instance;
}
