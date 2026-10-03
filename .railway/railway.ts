import { defineRailway, preserve, project, service } from "railway/iac";

// Manage only the application. PostgreSQL, its volume and PITR bucket remain
// managed separately; this partial must never delete those resources.
export const partial = "lift-journal";

export default defineRailway(() => {
  const journal = service("lift-journal", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/ready",
    healthcheckTimeout: 120,
    preDeploy: "node migrate.cjs",
    regions: { "europe-west4-drams3a": 1 },
    // ON_FAILURE is Railway's default; keep it implicit to avoid plan drift.
    deploy: { restartPolicyMaxRetries: 3 },
    // Values are provisioned directly in Railway, never stored in this repo.
    env: {
      ALLOWED_EMAILS: preserve(),
      OWNER_EMAIL: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      DATABASE_URL: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      GOOGLE_MAPS_API_KEY: preserve(),
      MIGRATION_DATABASE_URL: preserve(),
      PORT: preserve(),
      DAILY_REMINDERS_WORKER: preserve(),
      WEB_PUSH_PUBLIC_KEY: preserve(),
      WEB_PUSH_PRIVATE_KEY: preserve(),
      WEB_PUSH_SUBJECT: preserve(),
      OLLAMA_BASE_URL: preserve(),
      OLLAMA_MODEL: preserve(),
      OLLAMA_API_KEY: preserve(),
      AGENT_PROVIDER: preserve(),
      AGENT_MODEL: preserve(),
      AGENT_ROUTING: preserve(),
      OPENROUTER_API_KEY: preserve(),
      TYPESAFE_API_KEY: preserve(),
      VIDEO_SAM3_URL: preserve(),
      VIDEO_SAM3_TOKEN: preserve(),
      VIDEO_SAM3_PILOT_EMAIL: preserve(),
      EXA_API_KEY: preserve(),
      GEMINI_API_KEY: preserve(),
      VOICE_NAME: preserve(),
      VOICE_MODEL: preserve(),
      ELEVENLABS_API_KEY: preserve(),
      // Dish pictures on recipe cards; empty or missing switches them off.
      COACH_PICTURE_MODEL: preserve(),
      // AI cost ledger prices (lib/ai-usage.ts); unset keeps the built-in
      // price for Jev routing, Exa searches and each provider's voice minute.
      AI_PRICE_JEV_REQUEST: preserve(),
      AI_PRICE_EXA_SEARCH: preserve(),
      AI_PRICE_VOICE_GEMINI_MINUTE: preserve(),
      AI_PRICE_VOICE_ELEVENLABS_MINUTE: preserve(),
      // Usage limits (lib/usage-limits.ts): "enforce" refuses, anything else
      // only logs, so losing it would quietly stop enforcement.
      LIMITS_MODE: preserve(),
      // Restate (docs/restate-setup.md): RESTATE_ENDPOINT=1 starts the
      // endpoint Restate calls, which needs RESTATE_IDENTITY_KEYS in
      // production; the two URLs are the restate service's private
      // addresses, for scripts/restate-register.ts and later Coach turns.
      RESTATE_ENDPOINT: preserve(),
      RESTATE_IDENTITY_KEYS: preserve(),
      RESTATE_ADMIN_URL: preserve(),
      RESTATE_INGRESS_URL: preserve(),
      // Releases without downtime: the previous server keeps serving until
      // the new one is live, then gets time to finish open requests. Calls,
      // saves and Coach replies in progress (up to 100 s) are not cut off by
      // a deploy; the server exits as soon as it is idle.
      RAILWAY_DEPLOYMENT_OVERLAP_SECONDS: "30",
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "100",
    },
  });
  return project("olympicweightlifting", {
    resources: [journal],
  });
});
