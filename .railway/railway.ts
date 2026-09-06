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
      MIGRATION_DATABASE_URL: preserve(),
      PORT: preserve(),
      OLLAMA_BASE_URL: preserve(),
      OLLAMA_MODEL: preserve(),
      OLLAMA_API_KEY: preserve(),
      AGENT_PROVIDER: preserve(),
      AGENT_MODEL: preserve(),
      OPENROUTER_API_KEY: preserve(),
    },
  });
  return project("olympicweightlifting", {
    resources: [journal],
  });
});
