import { privateFetch } from "./private-fetch";
import { HttpAgent } from "@ag-ui/client";
import {
  savedVisualSchema,
  type CoachResponse,
  type SavedVisual,
} from "./coach-visuals";

type RunInput = {
  id: string;
  message: string;
  revision: number;
  timezone: string;
  photoIds: string[];
};
export type CoachUpdate = {
  reply?: string;
  activity?: string;
  visual?: SavedVisual;
};

export async function runCoach(
  accountId: string,
  input: RunInput,
  signal: AbortSignal,
  update: (value: CoachUpdate) => void,
): Promise<CoachResponse> {
  signal.throwIfAborted();
  let connectionFailure: string | undefined;
  const agent = new HttpAgent({
    url: "/api/agent/run",
    threadId: "coach",
    debug: false,
    headers: { "X-Journal-Account": accountId },
    // Send only this question. The server loads the owner's trusted history.
    initialMessages: [{ id: input.id, role: "user", content: input.message }],
    fetch: async (url, init) => {
      const response = await privateFetch(url, {
        ...init,
        signal: AbortSignal.any([
          signal,
          ...(init.signal ? [init.signal] : []),
        ]),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        connectionFailure =
          data.error ?? "Your coach could not connect. Please try again.";
        throw Error(connectionFailure);
      }
      return response;
    },
  });
  let result: CoachResponse | undefined;
  let failure: string | undefined;
  try {
    await agent.runAgent(
      {
        runId: input.id,
        forwardedProps: {
          revision: input.revision,
          timezone: input.timezone,
          photoIds: input.photoIds,
        },
      },
      {
        onStepStartedEvent: ({ event }) => {
          update({ activity: event.stepName });
        },
        onTextMessageStartEvent: () => {
          update({ reply: "", activity: "Writing your response" });
        },
        onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
          // Subscribers run before AG-UI appends this event to the buffer.
          update({ reply: textMessageBuffer + event.delta });
        },
        onCustomEvent: ({ event }) => {
          if (event.name !== "coach.visual") return;
          const parsed = savedVisualSchema.safeParse(event.value);
          if (parsed.success) update({ visual: parsed.data });
        },
        onRunErrorEvent: ({ event }) => {
          failure = event.message;
        },
        onRunFinishedEvent: ({ event }) => {
          const value = event.result as CoachResponse | undefined;
          if (
            !value ||
            typeof value.reply !== "string" ||
            !Array.isArray(value.proposals)
          )
            return;
          result = {
            ...value,
            visuals: (value.visuals ?? [])
              .flatMap((visual) => {
                const parsed = savedVisualSchema.safeParse(visual);
                return parsed.success ? [parsed.data] : [];
              })
              .slice(0, 3),
          };
        },
      },
    );
  } catch {
    signal.throwIfAborted();
    throw Error(
      failure ??
        connectionFailure ??
        "Coach lost its connection before finishing. Your message is ready to try again.",
    );
  }
  signal.throwIfAborted();
  if (failure || !result)
    throw Error(
      failure ??
        "The connection ended before Coach finished. Your message is ready to try again.",
    );
  return result;
}
