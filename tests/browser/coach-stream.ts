import type { Page } from "@playwright/test";

export type StreamWindow = Window & {
  coachEvents: (event: Record<string, unknown>) => void;
  closeCoachStream: () => void;
  coachRequests: {
    body: {
      runId: string;
      messages: { content: string }[];
      forwardedProps: { revision: number; photoIds: string[] };
    };
    account: string | null;
    cache?: RequestCache;
  }[];
  coachAborted: boolean;
};

// A controllable network stream using the real browser fetch/ReadableStream
// boundary and shipped AG-UI client. No provider or production records are used.
export async function streamingFixture(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as StreamWindow;
    const original = window.fetch.bind(window);
    state.coachRequests = [];
    window.fetch = async (input, init) => {
      if (new URL(String(input), location.href).pathname !== "/api/agent/run")
        return original(input, init);
      const body = JSON.parse(String(init?.body));
      state.coachRequests.push({
        body,
        account: new Headers(init?.headers).get("X-Journal-Account"),
        cache: init?.cache,
      });
      const encoder = new TextEncoder();
      let ended = false;
      return new Response(
        new ReadableStream({
          start(controller) {
            state.coachEvents = (event) => {
              if (!ended)
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                );
            };
            state.closeCoachStream = () => {
              if (!ended) {
                ended = true;
                controller.close();
              }
            };
            init?.signal?.addEventListener("abort", () => {
              state.coachAborted = true;
              if (!ended) {
                ended = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              }
            });
            state.coachEvents({
              type: "RUN_STARTED",
              threadId: body.threadId,
              runId: body.runId,
            });
            state.coachEvents({
              type: "STEP_STARTED",
              stepName: "Checking your sleep and recovery",
            });
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "private, no-store",
          },
        },
      );
    };
  });
}
export const emit = (page: Page, events: Record<string, unknown>[]) =>
  page.evaluate((events) => {
    for (const event of events)
      (window as unknown as StreamWindow).coachEvents(event);
  }, events);
export const startReply = [
  { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
  { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
];
