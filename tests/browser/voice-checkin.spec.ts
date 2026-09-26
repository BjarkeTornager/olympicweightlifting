import { test, expect, browserUser } from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
import { streamingFixture, emit, type StreamWindow } from "./coach-stream";
import type { ActionPreview } from "../../lib/agent/actions";

// Chromium provides a synthetic microphone. The Gemini Live socket is served
// by Playwright, so no Google request, key or real voice is involved.
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

const socketUrl =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=synthetic";

test("a spoken check-in streams the microphone, saves through Coach and reports back", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Synthetic microphone is Chromium-only",
  );
  await context.grantPermissions(["microphone"]);
  await streamingFixture(page);
  await context.route("**/api/journal", (r) =>
    r.fulfill({
      json: { accountId: browserUser.id, state: emptyJournal(), revision: 0 },
    }),
  );
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
  let sessionBody: unknown = null;
  await context.route("**/api/voice/session", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ json: { enabled: true } })
      : ((sessionBody = r.request().postDataJSON()),
        r.fulfill({
          json: {
            url: socketUrl,
            setup: { model: "models/gemini-3.8-live-extended-thinking" },
            maxMinutes: 10,
          },
        })),
  );
  const received: Record<string, unknown>[] = [];
  let audioChunks = 0;
  let server!: { send: (m: string) => void };
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    server = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.realtimeInput?.audio) {
        audioChunks++;
        return;
      }
      received.push(message);
      if (message.setup) ws.send(JSON.stringify({ setupComplete: {} }));
      else if (message.realtimeInput?.text)
        ws.send(
          JSON.stringify({
            serverContent: {
              // 0.1 s of silence at 24 kHz.
              modelTurn: {
                parts: [
                  {
                    inlineData: {
                      data: Buffer.alloc(4800).toString("base64"),
                      mimeType: "audio/pcm;rate=24000",
                    },
                  },
                ],
              },
              outputTranscription: { text: "Hi! Did you train today?" },
              turnComplete: true,
            },
          }),
        );
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check in by voice" }).click();
  const dialog = page.getByRole("dialog", { name: "Check in by voice" });
  await dialog.getByRole("button", { name: "Start talking" }).click();

  await expect(dialog.getByText("Hi! Did you train today?")).toBeVisible();
  expect(received[0]).toEqual({
    setup: { model: "models/gemini-3.8-live-extended-thinking" },
  });
  expect(sessionBody).toEqual({ timezone: expect.any(String) });
  // The synthetic microphone reaches Google as 16 kHz PCM chunks.
  await expect.poll(() => audioChunks).toBeGreaterThan(3);

  server.send(
    JSON.stringify({
      serverContent: {
        inputTranscription: { text: "Snatch 72 made, 75 missed twice." },
      },
    }),
  );
  await expect(
    dialog.getByText("Snatch 72 made, 75 missed twice."),
  ).toBeVisible();
  const report = `Trained today (${today()}): snatch 72 kg x 2 made; 75 kg x 2 missed twice.`;
  server.send(
    JSON.stringify({
      toolCall: {
        functionCalls: [
          {
            id: "call-1",
            name: "save_to_journal",
            args: { topic: "training", report },
          },
        ],
      },
    }),
  );
  const saves = dialog.getByRole("list", { name: "Saved from this call" });
  await expect(saves).toHaveText(/training\s+saving…/);
  const requests = () =>
    page.evaluate(() => (window as unknown as StreamWindow).coachRequests);
  await expect.poll(async () => (await requests()).length).toBe(1);
  const run = (await requests())[0].body;
  expect(run.messages[0].content).toBe(
    `From my spoken check-in (transcribed, so numbers may be misheard): ${report}`,
  );
  const proposal: ActionPreview = {
    id: crypto.randomUUID(),
    title: "Log snatch sets",
    detail: "2 sets",
    workout: null,
    status: "saved",
    automatic: true,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  await emit(page, [
    { type: "STEP_FINISHED", stepName: "Checking your sleep and recovery" },
    {
      type: "RUN_FINISHED",
      threadId: "coach",
      runId: run.runId,
      result: { reply: "Logged your snatches.", proposals: [proposal] },
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect(saves).toHaveText(/training\s+saved$/);
  await expect
    .poll(() => received.find((m) => m.toolResponse))
    .toEqual({
      toolResponse: {
        functionResponses: [
          {
            id: "call-1",
            name: "save_to_journal",
            response: { result: "Saved. Coach: Log snatch sets" },
          },
        ],
      },
    });

  server.send(
    JSON.stringify({
      toolCall: {
        functionCalls: [{ id: "call-2", name: "end_check_in", args: {} }],
      },
    }),
  );
  await expect(
    dialog.getByText("Call ended. Everything saved is in Coach, with Undo."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Review in Coach" }).click();
  await expect(
    page.getByRole("region", { name: "Saved journal entry" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
