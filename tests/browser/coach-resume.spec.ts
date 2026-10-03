import { test, expect, browserUser } from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import type { SavedVisual } from "../../lib/coach-visuals";
import {
  streamingFixture,
  emit,
  recordCancels,
  startReply,
  type StreamWindow,
} from "./coach-stream";

// With COACH_TURN_EVENTS on, each stored event comes with its SSE id, and a
// reply whose connection drops reads on with GET /api/agent/run?after=<id>.
// The streams are synthetic (coach-stream.ts); no server reply is involved.

const step = "Checking your sleep and recovery";
const visual: SavedVisual = {
  id: "b419d58a-9408-46a1-81b6-21b42a147599",
  content: {
    kind: "table",
    title: "Your week at a glance",
    columns: ["Day", "Sleep"],
    rows: [["Friday", "7 hours"]],
  },
};

const state = (page: Page) =>
  page.evaluate(() => {
    const { coachRequests, coachResumes } = window as unknown as StreamWindow;
    return { runId: coachRequests.at(-1)?.body.runId, coachResumes };
  });
const reply = (page: Page) => page.locator(".assistant-response").last();

// Opens Coach and sends a message. Records reads of the saved turn, which
// the website makes when a reply fails; `saved` is the turn they find.
async function ask(page: Page, context: BrowserContext, saved?: object) {
  await streamingFixture(page);
  const reads: string[] = [];
  await context.route("**/api/agent?turnId=*", (r) => {
    const id = new URL(r.request().url()).searchParams.get("turnId")!;
    reads.push(id);
    return r.fulfill({ json: { turn: saved ? { ...saved, id } : null } });
  });
  await context.route("**/api/agent", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        protocol: "ag-ui",
        provider: "Test provider",
        turns: [],
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page.getByLabel("Message your coach").fill("How did I sleep?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await state(page)).runId).toBeTruthy();
  return { runId: (await state(page)).runId!, reads };
}

const finish = async (page: Page, runId: string, text: string, id?: number) => {
  await emit(
    page,
    [
      {
        type: "RUN_FINISHED",
        threadId: "coach",
        runId,
        result: { reply: text, proposals: [] },
      },
    ],
    id,
  );
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
};

test("a reply whose connection drops reads on from its last event, without repeating any", async ({
  page,
  context,
}) => {
  const { runId, reads } = await ask(page, context);
  await emit(
    page,
    [
      { type: "STEP_FINISHED", stepName: step },
      { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
      {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "answer",
        delta: "You slept ",
      },
    ],
    1,
  );
  await expect(reply(page)).toHaveText("You slept");
  // Half of the next event arrives, then the connection drops.
  await page.evaluate(() => {
    const s = window as unknown as StreamWindow;
    s.coachText(
      'id: 4\ndata: {"type":"TEXT_MESSAGE_CONTENT","messageId":"answer","delta":"seven',
    );
    s.dropCoachStream();
  });
  await expect
    .poll(async () => (await state(page)).coachResumes)
    .toEqual([`?turnId=${runId}&after=3`]);
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  // The server sends what came after the last whole event it had read.
  await emit(
    page,
    [
      {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "answer",
        delta: "seven hours a night.",
      },
      { type: "TEXT_MESSAGE_END", messageId: "answer" },
    ],
    4,
  );
  await expect(reply(page)).toHaveText("You slept seven hours a night.");
  await finish(page, runId, "You slept seven hours a night.", 6);
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(
    0,
  );
  await expect(reply(page)).toHaveText("You slept seven hours a night.");
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
  expect(reads).toEqual([]);
  expect((await state(page)).coachResumes).toHaveLength(1);
});

test("a reply run again after a crash drops what it showed and carries on (coach.reset)", async ({
  page,
  context,
}) => {
  const { runId, reads } = await ask(page, context);
  const messageId = `${runId}-0`;
  await emit(
    page,
    [
      { type: "STEP_FINISHED", stepName: step },
      { type: "STEP_STARTED", stepName: "Preparing your response" },
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "A first attempt" },
      { type: "CUSTOM", name: "coach.visual", value: visual },
    ],
    1,
  );
  await expect(reply(page)).toHaveText("A first attempt");
  await expect(page.locator(".coach-visual")).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).dropCoachStream(),
  );
  await expect
    .poll(async () => (await state(page)).coachResumes)
    .toEqual([`?turnId=${runId}&after=5`]);
  // The server ran the turn again: its events come after a coach.reset,
  // with the same step and message ids as the cut-off attempt.
  await page.evaluate(() =>
    (window as unknown as StreamWindow).coachEvents({
      type: "CUSTOM",
      name: "coach.reset",
      value: { attempt: 2 },
    }),
  );
  await expect(page.locator(".assistant-response")).toHaveCount(0);
  await expect(page.locator(".coach-visual")).toHaveCount(0);
  await emit(
    page,
    [
      { type: "STEP_STARTED", stepName: "Preparing your response" },
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "A second attempt" },
    ],
    6,
  );
  await expect(reply(page)).toHaveText("A second attempt");
  await emit(
    page,
    [
      { type: "TEXT_MESSAGE_END", messageId },
      { type: "STEP_FINISHED", stepName: "Preparing your response" },
    ],
    9,
  );
  await finish(page, runId, "A second attempt, finished.", 11);
  await expect(reply(page)).toHaveText("A second attempt, finished.");
  await expect(page.getByText("A first attempt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
  expect(reads).toEqual([]);
});

test("with the switch off, a dropped reply fails as before and reads the saved turn", async ({
  page,
  context,
}) => {
  const { runId, reads } = await ask(page, context);
  // No SSE ids: the server isn't storing the reply's events.
  await emit(page, [
    { type: "STEP_FINISHED", stepName: step },
    { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "Partial" },
  ]);
  await expect(reply(page)).toHaveText("Partial");
  await page.evaluate(() =>
    (window as unknown as StreamWindow).dropCoachStream(),
  );
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Coach lost its connection. Reconnect to check the saved result, or retry the same message safely.",
    ),
  ).toBeVisible();
  expect(reads).toEqual([runId]);
  expect((await state(page)).coachResumes).toEqual([]);
});

test("a reply the server can't resume falls back to the saved turn", async ({
  page,
  context,
}) => {
  const { runId, reads } = await ask(page, context, {
    question: "How did I sleep?",
    reply: "You slept seven hours a night.",
    proposals: [],
    status: "done",
  });
  await page.evaluate(() => {
    (window as unknown as StreamWindow).resumeStatus = 404;
  });
  await emit(
    page,
    [
      { type: "STEP_FINISHED", stepName: step },
      { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "You slept" },
    ],
    1,
  );
  await page.evaluate(() =>
    (window as unknown as StreamWindow).dropCoachStream(),
  );
  await expect(reply(page)).toHaveText("You slept seven hours a night.");
  expect((await state(page)).coachResumes).toEqual([
    `?turnId=${runId}&after=3`,
  ]);
  expect(reads).toEqual([runId]);
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
});

// A reply that has begun, then loses its connection with its third event
// read.
const dropAfterThree = async (page: Page) => {
  await emit(
    page,
    [
      ...startReply,
      { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "You slept" },
    ],
    1,
  );
  await expect(reply(page)).toHaveText("You slept");
  await page.evaluate(() =>
    (window as unknown as StreamWindow).dropCoachStream(),
  );
};
const stopped =
  "Response stopped. Reconnect to check whether an entry was saved. Retrying the same message will not save it twice.";

test("Stop while a dropped reply waits to reconnect ends it at once and still cancels the run", async ({
  page,
  context,
}) => {
  const cancels = await recordCancels(context);
  const { runId, reads } = await ask(page, context);
  await dropAfterThree(page);
  // Within the second the website waits before reconnecting.
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByText(stopped)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  // The cancel is what stops a run whose server didn't hear the close.
  await expect
    .poll(() => cancels)
    .toEqual([{ id: runId, account: browserUser.id }]);
  // Past the wait, nothing reconnected.
  await page.waitForTimeout(1500);
  expect((await state(page)).coachResumes).toEqual([]);
  expect(cancels).toHaveLength(1);
  expect(reads).toEqual([runId]);
});

test("Stop while reading a resumed reply ends it and makes no further reconnect", async ({
  page,
  context,
}) => {
  const cancels = await recordCancels(context);
  const { runId, reads } = await ask(page, context);
  await dropAfterThree(page);
  await expect
    .poll(async () => (await state(page)).coachResumes)
    .toEqual([`?turnId=${runId}&after=3`]);
  await emit(
    page,
    [{ type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: " seven" }],
    4,
  );
  await expect(reply(page)).toHaveText("You slept seven");
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByText(stopped)).toBeVisible();
  await expect
    .poll(() => cancels)
    .toEqual([{ id: runId, account: browserUser.id }]);
  // The resumed stream was closed by the Stop, not read on from again.
  await page.waitForTimeout(1500);
  expect((await state(page)).coachResumes).toHaveLength(1);
  expect(reads).toEqual([runId]);
});

test("a release in progress is waited out three times, then the reply falls back to the saved turn", async ({
  page,
  context,
}) => {
  const { runId, reads } = await ask(page, context);
  await page.evaluate(() => {
    (window as unknown as StreamWindow).resumeStatus = 503;
  });
  const dropped = Date.now();
  await dropAfterThree(page);
  const resumes = async () => (await state(page)).coachResumes;
  await expect.poll(resumes).toHaveLength(1);
  // Still trying: the saved turn isn't read yet.
  expect(reads).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  // After 1, 2 and 4 seconds, each from where the reply was.
  await expect
    .poll(resumes, { timeout: 10000 })
    .toEqual(Array(3).fill(`?turnId=${runId}&after=3`));
  expect(Date.now() - dropped).toBeGreaterThanOrEqual(6000);
  await expect(
    page.getByText(
      "Coach lost its connection. Reconnect to check the saved result, or retry the same message safely.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  expect(reads).toEqual([runId]);
  expect(await resumes()).toHaveLength(3);
});

test("a resumed reply that ends without its last event, as a stopped or timed-out turn's does, reads the saved turn", async ({
  page,
  context,
}) => {
  const { runId, reads } = await ask(page, context, {
    question: "How did I sleep?",
    proposals: [],
    status: "failed",
  });
  await dropAfterThree(page);
  await expect
    .poll(async () => (await state(page)).coachResumes)
    .toEqual([`?turnId=${runId}&after=3`]);
  await emit(page, [{ type: "TEXT_MESSAGE_END", messageId: "answer" }], 4);
  // The server ends the stream: the turn ended without a last event.
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect(
    page.getByText(
      "The connection ended before Coach finished. Reconnect to check the saved result, or retry the same message safely.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  expect(reads).toEqual([runId]);
  // A clean end isn't a dropped connection: no second reconnect.
  await page.waitForTimeout(1500);
  expect((await state(page)).coachResumes).toHaveLength(1);
});
