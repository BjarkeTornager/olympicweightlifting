import { test, expect, browserUser } from "./fixtures";
import { emptyJournal, today } from "../../lib/domain";
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

function tone(seconds: number) {
  const pcm = Buffer.alloc(seconds * 24000 * 2);
  for (let i = 0; i < seconds * 24000; i++)
    pcm.writeInt16LE(
      Math.round(
        12000 *
          (Math.sin((2 * Math.PI * 220 * i) / 24000) +
            0.5 * Math.sin((2 * Math.PI * 660 * i) / 24000)) *
          0.6,
      ),
      i * 2,
    );
  return pcm.toString("base64");
}

const socketUrl =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=synthetic";

test("a spoken check-in streams the microphone, saves directly, uses the camera and reports back", async ({
  page,
  context,
  browserName,
}, info) => {
  test.skip(
    browserName !== "chromium",
    "Synthetic microphone is Chromium-only",
  );
  await context.grantPermissions(["microphone", "camera"]);
  await context.route("**/api/journal", (r) =>
    r.fulfill({
      json: { accountId: browserUser.id, state: emptyJournal(), revision: 0 },
    }),
  );
  // Saved voice receipts appear in Coach's history like any saved message.
  const turns: object[] = [];
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns } }),
  );
  const actions: {
    name: string;
    args: Record<string, unknown>;
    seenPhotoIds: string[];
  }[] = [];
  await context.route("**/api/voice/action", (r) => {
    const body = r.request().postDataJSON();
    actions.push(body);
    const proposal: ActionPreview = {
      id: crypto.randomUUID(),
      title: "Log your workout",
      detail: "Saved to History.",
      workout: null,
      status: "saved",
      automatic: true,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    turns.push({
      id: body.id,
      question: `[voice] ${body.args.summary}`,
      reply: "Saved from your voice check-in.",
      proposals: [proposal],
      status: "done",
    });
    return r.fulfill({
      json: {
        ok: true,
        saveId: proposal.id,
        title: proposal.title,
        detail: proposal.detail,
      },
    });
  });
  const photoId = crypto.randomUUID();
  let uploaded: { purpose?: string } | null = null;
  await context.route(/\/api\/images(?:\?.*)?$/, (r) => {
    if (r.request().method() !== "POST")
      return r.fulfill({ json: { images: [] } });
    uploaded = r.request().postDataJSON();
    return r.fulfill({
      json: {
        id: photoId,
        label: "Meal photo from voice check-in",
        date: today(),
        category: "food",
        version: 1,
        bytes: 1000,
        createdAt: new Date().toISOString(),
        classification: {
          status: "ready",
          confidence: "high",
          source: "manual",
          tags: [],
        },
      },
    });
  });
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
              // 1.5 s of a voice-like tone at 24 kHz, so the visual has sound.
              modelTurn: {
                parts: [
                  {
                    inlineData: {
                      data: tone(1.5),
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
  // The blue Talk button is the composer's main action while it is empty.
  const composer = page.getByLabel("Message your coach");
  const talk = page.getByRole("button", { name: "Talk", exact: true });
  await expect(talk).toBeInViewport();
  await composer.fill("A typed question");
  await expect(talk).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await composer.fill("");
  await talk.click();
  await expect(
    page.getByRole("dialog", { name: "Check in by voice" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("voice-from-talk.png") });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: info.outputPath("coach-talk-button.png") });
  // Reached the way people look for it: through Log something.
  await page.getByRole("button", { name: "Log something" }).click();
  await page
    .getByRole("dialog", { name: "Log something" })
    .getByRole("button", { name: "Check in by voice" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Check in by voice" });
  await dialog.getByRole("button", { name: "Start talking" }).click();

  await expect(dialog.getByText("Hi! Did you train today?")).toBeVisible();
  // The coach's voice is visible: the bars rise while he speaks.
  await expect
    .poll(() =>
      dialog
        .locator(".voice-bars > span")
        .evaluateAll((bars) =>
          Math.max(...bars.map((b) => b.getBoundingClientRect().height)),
        ),
    )
    .toBeGreaterThan(12);
  await page.screenshot({ path: info.outputPath("voice-speaking.png") });
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
  const workout = {
    summary: "Snatch 72 made, 75 missed twice",
    date: today(),
    title: "Snatch",
    exercises: [
      {
        exercise: "snatch",
        sets: [
          { weight_kg: 72, reps: 2, made: true },
          { weight_kg: 75, reps: 2, made: false },
          { weight_kg: 75, reps: 2, made: false },
        ],
      },
    ],
  };
  server.send(
    JSON.stringify({
      toolCall: {
        functionCalls: [{ id: "call-1", name: "log_training", args: workout }],
      },
    }),
  );
  // Saved directly by the journal, without a second model in between.
  const saves = dialog.getByRole("list", { name: "Saved from this call" });
  await expect(saves).toHaveText(/Training\s+saved$/);
  expect(actions[0]).toMatchObject({ name: "log_training", args: workout });
  await expect
    .poll(() => received.find((m) => m.toolResponse))
    .toEqual({
      toolResponse: {
        functionResponses: [
          {
            id: "call-1",
            name: "log_training",
            response: {
              result: {
                saved: "Log your workout",
                detail: "Saved to History.",
                save_id: expect.any(String),
              },
            },
          },
        ],
      },
    });

  // "Take a photo of my dinner": the camera opens inside the call.
  server.send(
    JSON.stringify({
      toolCall: {
        functionCalls: [{ id: "call-cam", name: "open_camera", args: {} }],
      },
    }),
  );
  const viewfinder = dialog.locator(".voice-camera video");
  await expect(viewfinder).toBeVisible();
  await expect
    .poll(() => viewfinder.evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("voice-camera.png") });
  await dialog.getByRole("button", { name: "Take photo" }).click();
  await expect(viewfinder).toHaveCount(0);
  await expect.poll(() => uploaded?.purpose).toBe("meal-photo");
  // The coach sees the photo and learns its id for the meal.
  await expect
    .poll(() =>
      received.some(
        (m) =>
          (m.realtimeInput as { video?: { mimeType: string } })?.video
            ?.mimeType === "image/jpeg",
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      received.some((m) =>
        String((m.realtimeInput as { text?: string })?.text).includes(photoId),
      ),
    )
    .toBe(true);
  server.send(
    JSON.stringify({
      toolCall: {
        functionCalls: [
          {
            id: "call-meal",
            name: "log_meal",
            args: { summary: "Dinner from the photo", photo_ids: [photoId] },
          },
        ],
      },
    }),
  );
  await expect.poll(() => actions.length).toBe(2);
  expect(actions[1].seenPhotoIds).toEqual([photoId]);

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
  // Both saves from the call appear in Coach with Undo, labelled as voice.
  await expect(
    page.getByRole("region", { name: "Saved journal entry" }),
  ).toHaveCount(2);
  await expect(page.locator(".chat-task").first()).toHaveText(
    "From your voice check-in",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
