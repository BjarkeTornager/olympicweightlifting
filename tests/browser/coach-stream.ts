import type { BrowserContext, Page } from "@playwright/test";

export type StreamWindow = Window & {
  // Sends an event on the latest stream, with an SSE id when given, as the
  // server does with COACH_TURN_EVENTS on.
  coachEvents: (event: Record<string, unknown>, id?: number) => void;
  // Sends raw text, such as part of a frame.
  coachText: (text: string) => void;
  closeCoachStream: () => void;
  // Fails the latest stream as a dropped connection does.
  dropCoachStream: () => void;
  coachRequests: {
    body: {
      runId: string;
      messages: { content: string }[];
      forwardedProps: { revision: number; photoIds: string[] };
    };
    account: string | null;
    cache?: RequestCache;
  }[];
  // The query of each GET /api/agent/run that resumes a reply.
  coachResumes: string[];
  // The status a resume gets instead of a stream, when set.
  resumeStatus?: number;
  coachAborted: boolean;
};

// A controllable network stream using the real browser fetch/ReadableStream
// boundary and shipped AG-UI client. No provider or production records are used.
export async function streamingFixture(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as StreamWindow;
    const original = window.fetch.bind(window);
    state.coachRequests = [];
    state.coachResumes = [];
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.href);
      if (url.pathname !== "/api/agent/run") return original(input, init);
      const resuming = (init?.method ?? "GET") === "GET";
      const body = resuming ? undefined : JSON.parse(String(init?.body));
      if (resuming) {
        state.coachResumes.push(url.search);
        if (state.resumeStatus)
          return Response.json(
            { error: "This reply can't be resumed." },
            { status: state.resumeStatus },
          );
      } else
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
            state.coachText = (text) => {
              if (!ended) controller.enqueue(encoder.encode(text));
            };
            state.coachEvents = (event, id) =>
              state.coachText(
                `${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`,
              );
            state.closeCoachStream = () => {
              if (!ended) {
                ended = true;
                controller.close();
              }
            };
            state.dropCoachStream = () => {
              if (!ended) {
                ended = true;
                controller.error(new TypeError("network error"));
              }
            };
            init?.signal?.addEventListener("abort", () => {
              state.coachAborted = true;
              if (!ended) {
                ended = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              }
            });
            // A resumed reply carries on from where it was.
            if (resuming) return;
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
// Sends events; with `firstId`, numbered on from it as stored events are.
export const emit = (
  page: Page,
  events: Record<string, unknown>[],
  firstId?: number,
) =>
  page.evaluate(
    ({ events, firstId }) =>
      events.forEach((event, i) =>
        (window as unknown as StreamWindow).coachEvents(
          event,
          firstId === undefined ? undefined : firstId + i,
        ),
      ),
    { events, firstId },
  );
export const startReply = [
  { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
  { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
];

// The website's Stop also cancels the run on the server, by its id.
export async function recordCancels(context: BrowserContext) {
  const cancels: { id: string; account?: string }[] = [];
  await context.route("**/api/agent/run/cancel", (r) => {
    cancels.push({
      ...r.request().postDataJSON(),
      account: r.request().headers()["x-journal-account"],
    });
    return r.fulfill({ json: { cancelled: true } });
  });
  return cancels;
}
