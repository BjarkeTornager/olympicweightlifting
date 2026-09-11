import { test, expect, browserUser } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { streamingFixture, type StreamWindow } from "./coach-stream";

test("video feedback submits without a question, retries partial saves and preserves unrelated draft text and photos", async ({
  page,
  context,
}, info) => {
  const uploads = new Map<
    string,
    { image: string; metadata: Record<string, unknown> }
  >();
  const attempts: string[] = [];
  let failOnce = true,
    messages = 0;
  await context.route("**/api/images", async (r) => {
    if (r.request().method() !== "POST")
      return r.fulfill({
        json: { images: [...uploads.values()].map((p) => p.metadata) },
      });
    expect(r.request().headers()["x-journal-account"]).toBe(browserUser.id);
    const raw = r.request().postDataJSON();
    expect(raw.purpose).toBe("lifting-video-frames");
    expect(raw.autoTag).toBe(false);
    expect(raw.label).toContain("Clean");
    attempts.push(raw.id);
    if (uploads.size === 1 && failOnce) {
      failOnce = false;
      return r.fulfill({
        status: 503,
        json: { error: "Synthetic interrupted upload." },
      });
    }
    const metadata = {
      id: raw.id,
      label: raw.label,
      date: raw.date,
      createdAt: new Date().toISOString(),
      category: "activity",
      bytes: 12345,
      version: 0,
      classification: {
        source: "manual",
        status: "ready",
        confidence: "high",
        tags: ["weightlifting", "video-frames"],
      },
    };
    uploads.set(raw.id, { image: raw.image, metadata });
    return r.fulfill({ json: metadata });
  });
  await context.route("**/api/images/*", (r) => {
    const url = new URL(r.request().url()),
      saved = uploads.get(url.pathname.split("/").at(-1)!);
    if (!saved)
      return r.fulfill({ status: 404, json: { error: "No fixture" } });
    return url.searchParams.has("metadata")
      ? r.fulfill({ json: saved.metadata })
      : r.fulfill({
          contentType: "image/jpeg",
          body: Buffer.from(saved.image, "base64"),
        });
  });
  await context.route("**/api/agent", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({
        json: { enabled: true, provider: "Test provider", turns: [] },
      });
    messages++;
    const input = r.request().postDataJSON();
    expect(input.message).not.toContain("Keep my existing note.");
    expect(input.message).toContain("Give me feedback on my clean");
    expect(input.message).toContain(
      "What went well, Main improvement, Next attempt",
    );
    expect(input.message).toContain("Reported load: 60 kg");
    expect(input.photoIds).toEqual([...uploads.keys()]);
    return r.fulfill({
      json: {
        reply:
          "The synthetic clip contains a moving shape, not a lifter. No technique can be assessed.",
        proposals: [],
        visuals: [],
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const draftPhotoId = "22222222-2222-4222-8222-222222222222";
  const draftImage = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#558899" },
  })
    .png()
    .toBuffer();
  await context.route(`**/api/images/${draftPhotoId}*`, (r) =>
    r.request().url().includes("metadata")
      ? r.fulfill({
          json: {
            id: draftPhotoId,
            category: "food",
            label: "Unsent meal",
            date: "2026-09-11",
            createdAt: "2026-09-11T09:00:00Z",
            bytes: draftImage.length,
            version: 0,
            classification: {
              source: "manual",
              status: "ready",
              confidence: "high",
              tags: ["food"],
            },
          },
        })
      : r.fulfill({ contentType: "image/png", body: draftImage }),
  );
  await page.goto(`/#coach/photo/${draftPhotoId}`);
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toBeVisible();
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page.getByLabel("Message your coach").fill("Keep my existing note.");
  await page.goto("/#workout/coaching");
  await page
    .getByRole("button", { name: "Review lifting video", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog
    .getByRole("button", { name: "Use on-device frame review" })
    .click();
  await dialog
    .getByLabel("Choose lifting video")
    .setInputFiles(path.resolve("tests/fixtures/lifting-motion.mp4"));
  await expect(dialog.getByLabel("Clip end seconds")).toHaveValue("2");
  await dialog.getByLabel("Lift in video").selectOption("Clean");
  await dialog.getByLabel("Video load").fill("60 kg");
  await expect(dialog.getByLabel("Video question")).toHaveCount(0);
  await page.evaluate(() => {
    const visibility: boolean[] = [];
    Object.assign(window, { sampledVideoVisibility: visibility });
    document.addEventListener(
      "seeking",
      (event) => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        const player = event.target.getBoundingClientRect();
        const modal = event.target
          .closest("[role=dialog]")!
          .getBoundingClientRect();
        visibility.push(
          player.height > 0 &&
            player.top >= Math.max(0, modal.top) &&
            player.bottom <= Math.min(window.innerHeight, modal.bottom),
        );
      },
      true,
    );
  });
  await dialog.getByRole("button", { name: "Preview selected frames" }).click();
  await expect(dialog.getByAltText(/^Preview sheet/)).toHaveCount(4, {
    timeout: 30000,
  });
  expect(uploads.size).toBe(0);
  expect(messages).toBe(0);
  // A scrolled-out player stalls seeks on Linux WebKit. Preparation must keep
  // the actual decoder visible, including when the Preview button is below it.
  const visibility = await page.evaluate(
    () => Reflect.get(window, "sampledVideoVisibility") as boolean[],
  );
  expect(visibility.length).toBeGreaterThan(20);
  expect(visibility.every(Boolean)).toBe(true);
  // Different sheets must contain different actual decoded frames, not repeated screenshots.
  const sources = await dialog
    .getByAltText(/^Preview sheet/)
    .evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).src),
    );
  expect(
    new Set(sources.map((s) => createHash("sha256").update(s).digest("hex")))
      .size,
  ).toBe(4);
  const firstPixel = await sharp(
    Buffer.from(sources[0].split(",")[1], "base64"),
  )
    .extract({ left: 320, top: 400, width: 1, height: 1 })
    .raw()
    .toBuffer();
  const lastPixel = await sharp(Buffer.from(sources[3].split(",")[1], "base64"))
    .extract({ left: 960, top: 1680, width: 1, height: 1 })
    .raw()
    .toBuffer();
  expect(lastPixel[0] - firstPixel[0]).toBeGreaterThan(100);
  await dialog.getByRole("button", { name: "Enlarge frame sheet 1" }).click();
  const enlarged = page.getByRole("dialog", { name: "Selected video frames" });
  await expect(enlarged.getByRole("img")).toBeVisible();
  await enlarged.getByRole("button", { name: "Close", exact: true }).click();
  await expect(enlarged).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("video-review-mobile.png"),
    fullPage: true,
  });
  expect(
    (await new AxeBuilder({ page }).include("[role=dialog]").analyze())
      .violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Get lift feedback" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic interrupted upload",
  );
  await dialog.getByRole("button", { name: "Get lift feedback" }).click();
  await expect(dialog).not.toBeVisible();
  expect(uploads.size).toBe(4);
  expect(attempts.length).toBe(5);
  expect(attempts[1]).toBe(attempts[2]);
  expect(attempts.filter((id) => id === attempts[0])).toHaveLength(1);
  await expect(page.getByLabel("Message your coach")).toHaveValue(
    "Keep my existing note.",
  );
  await expect(
    page.getByRole("img", { name: "Image ready to send" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".chat-user").filter({ hasText: "Clean · Video feedback" }),
  ).toBeVisible();
  await expect(
    page.getByText("Review the lift proactively", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/The synthetic clip contains a moving shape/),
  ).toBeVisible();
  expect(messages).toBe(1);
});

test("lifting learning and nutrition are discoverable, responsive and do not send messages on navigation", async ({
  page,
  context,
}) => {
  let posts = 0;
  context.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await page.goto("/#workout/coaching");
  await page.getByText("Fuel for lifting", { exact: true }).click();
  const source = page.getByRole("link", {
    name: "Protein and resistance exercise",
  });
  await expect(source).toHaveAttribute(
    "href",
    "https://pubmed.ncbi.nlm.nih.gov/28642676/",
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Plan food around training" }).click();
  await expect(page.getByLabel("Message your coach")).toHaveValue(
    /Help me fuel my Olympic weightlifting training/,
  );
  expect(posts).toBe(0);
  await page.goto("/#workout/coaching");
  await page.getByRole("button", { name: "Get technique feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog
    .getByRole("button", { name: "Use on-device frame review" })
    .click();
  await dialog.getByLabel("Choose lifting video").setInputFiles({
    name: "invalid.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("not a video"),
  });
  await expect(dialog.getByRole("alert")).toContainText("could not be opened");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Message your coach")).toHaveValue(
    /Help me fuel my Olympic weightlifting training/,
  );
  expect(posts).toBe(0);
  await page.goto("/#coach/lifting/technique");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Video question")).toHaveCount(0);
  expect(posts).toBe(0);
});

test("video feedback joins a running Coach queue without taking over the next draft", async ({
  page,
  context,
}) => {
  await streamingFixture(page);
  await context.route("**/api/agent", (r) =>
    r.fulfill({ json: { enabled: true, protocol: "ag-ui", turns: [] } }),
  );
  const images = new Map<string, string>();
  await context.route("**/api/images", (r) => {
    if (r.request().method() !== "POST")
      return r.fulfill({ json: { images: [] } });
    const raw = r.request().postDataJSON();
    images.set(raw.id, raw.image);
    return r.fulfill({
      json: {
        id: raw.id,
        label: raw.label,
        date: raw.date,
        createdAt: new Date().toISOString(),
        category: "activity",
        bytes: 12345,
        version: 0,
      },
    });
  });
  await context.route("**/api/images/*", (r) => {
    const image = images.get(
      new URL(r.request().url()).pathname.split("/").at(-1)!,
    );
    return image
      ? r.fulfill({
          contentType: "image/jpeg",
          body: Buffer.from(image, "base64"),
        })
      : r.fulfill({ status: 404 });
  });
  const requests = () =>
    page.evaluate(() => (window as unknown as StreamWindow).coachRequests);
  const finish = (reply: string) =>
    page.evaluate((reply) => {
      const state = window as unknown as StreamWindow;
      state.coachEvents({
        type: "STEP_FINISHED",
        stepName: "Checking your sleep and recovery",
      });
      state.coachEvents({
        type: "RUN_FINISHED",
        threadId: "coach",
        runId: state.coachRequests.at(-1)!.body.runId,
        result: { reply, proposals: [] },
      });
      state.closeCoachStream();
    }, reply);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#coach");
  await expect(page.getByText("Ready to help", { exact: true })).toBeVisible();
  await page.getByLabel("Message your coach").fill("Summarise my week");
  await page.getByLabel("Message your coach").press("Enter");
  await expect.poll(async () => (await requests()).length).toBe(1);
  await page.getByLabel("Message your coach").fill("Keep this for later.");
  await page.goto("/#coach/lifting/video");
  const dialog = page.getByRole("dialog", { name: "Review a lifting video" });
  await dialog
    .getByRole("button", { name: "Use on-device frame review" })
    .click();
  await dialog
    .getByLabel("Choose lifting video")
    .setInputFiles(path.resolve("tests/fixtures/lifting-motion.mp4"));
  await expect(dialog.getByLabel("Clip end seconds")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Preview selected frames" }).click();
  await expect(dialog.getByAltText(/^Preview sheet/)).toHaveCount(4, {
    timeout: 30000,
  });
  await dialog.getByRole("button", { name: "Get lift feedback" }).click();
  await expect(dialog).not.toBeVisible();
  const queue = page.getByRole("region", { name: "Message queue" });
  await expect(queue).toContainText("1 queued");
  expect((await requests()).length).toBe(1);
  await page.goto("/#workout");
  await finish("Your synthetic weekly summary is ready.");
  await expect.poll(async () => (await requests()).length).toBe(2);
  const review = (await requests())[1];
  expect(review.account).toBe(browserUser.id);
  expect(review.body.messages[0].content).toContain(
    "Give me feedback on my snatch",
  );
  expect(review.body.messages[0].content).not.toContain("Keep this for later.");
  expect(review.body.forwardedProps.photoIds).toEqual([...images.keys()]);
  await finish(
    "This synthetic clip has no lifter, so no technique correction is supported.",
  );
  await page.goto("/#coach");
  await expect(
    page.getByText(/This synthetic clip has no lifter/),
  ).toBeVisible();
  await expect(page.getByLabel("Message your coach")).toHaveValue(
    "Keep this for later.",
  );
  expect((await requests()).length).toBe(2);
});
