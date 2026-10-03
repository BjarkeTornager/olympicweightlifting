import * as restate from "@restatedev/restate-sdk";

// Checks the whole path: ingress, Restate, this endpoint and one recorded
// step. It says which deployment ran the step, so a rehearsal can see which
// container private DNS reached. No account data.
export const ping = restate.service({
  name: "Ping",
  handlers: {
    ping: async (ctx: restate.Context) => {
      const answer = await ctx.run("answer", () => ({
        at: new Date().toISOString(),
        deployment: process.env.RAILWAY_DEPLOYMENT_ID ?? "local",
      }));
      return { pong: true, ...answer };
    },
  },
  options: {
    journalRetention: { hours: 1 },
    idempotencyRetention: { hours: 1 },
  },
});
