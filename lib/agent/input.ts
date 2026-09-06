import { z } from "zod";
import { RunAgentInputSchema } from "@ag-ui/core";

const contextFields = {
  photoIds: z.array(z.string().uuid()).max(4).default([]),
  revision: z.number().int().min(0),
  timezone: z
    .string()
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
};
const message = z.string().trim().min(1).max(6000);
export const turnInputSchema = z
  .object({
    id: z.string().uuid(),
    message,
    ...contextFields,
  })
  .strict();

// This endpoint owns its tools, history and journal. AG-UI's client state,
// context and thread ID must never become an authority for account data.
const envelope = z
  .object({
    threadId: z.string().min(1).max(128),
    runId: z.string().uuid(),
    messages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            role: z.literal("user"),
            content: message,
          })
          .strict(),
      )
      .length(1),
    state: z.object({}).strict(),
    tools: z.array(z.never()).max(0),
    context: z.array(z.never()).max(0),
    forwardedProps: z.object(contextFields).strict(),
  })
  .strict();

export function parseCoachRun(raw: unknown) {
  // Validate the official protocol plus this service's deliberately narrower contract.
  const input = envelope.parse(raw);
  if (!RunAgentInputSchema.safeParse(input).success)
    throw new Error("Invalid AG-UI envelope.");
  return {
    threadId: input.threadId,
    input: turnInputSchema.parse({
      id: input.runId,
      message: input.messages[0].content,
      ...input.forwardedProps,
    }),
  };
}
