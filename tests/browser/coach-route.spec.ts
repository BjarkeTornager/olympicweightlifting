import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import type { CoachResponse, SavedVisual } from "../../lib/coach-visuals";
import {
  emit,
  startReply,
  streamingFixture,
  type StreamWindow,
} from "./coach-stream";

const route: SavedVisual = {
  id: "aa19d58a-9408-46a1-81b6-21b42a147599",
  content: {
    kind: "route_map",
    title: "Lakes run",
    caption: "Suggested public roads, not a logged run.",
    activity: "run",
    distanceKm: 5.2,
    durationSeconds: 1872,
    stops: [
      { lat: 55.6747, lng: 12.5681, label: "Dronning Louises Bro" },
      { lat: 55.6884, lng: 12.5762, label: "Sortedams Sø" },
    ],
    path: [
      [55.6747, 12.5681],
      [55.679, 12.57],
      [55.6884, 12.5762],
    ],
  },
};

test("Coach shows an interactive OpenStreetMap for a planned run", async ({
  page,
  context,
}, info) => {
  await streamingFixture(page);
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
  await page.goto("/#coach");
  const composer = page.getByLabel("Message your coach");
  await composer.fill("Plan a 5 km run around the lakes");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Checking your sleep and recovery", { exact: true }),
  ).toBeVisible();
  const request = await page.evaluate(
    () => (window as unknown as StreamWindow).coachRequests[0],
  );
  await emit(page, startReply);
  await emit(page, [
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "answer",
      delta: "Here is a suggested lakes run.",
    },
    { type: "CUSTOM", name: "coach.visual", value: route },
    { type: "TEXT_MESSAGE_END", messageId: "answer" },
    {
      type: "RUN_FINISHED",
      runId: request.body.runId,
      threadId: "coach",
      result: {
        reply: "Here is a suggested lakes run.",
        proposals: [],
        visuals: [route],
      } satisfies CoachResponse,
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as StreamWindow).closeCoachStream(),
  );
  await expect(page.getByRole("heading", { name: "Lakes run" })).toBeVisible();
  await expect(page.getByText("5.2 km run")).toBeVisible();
  await expect(page.getByText("Dronning Louises Bro")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".leaflet-control-zoom-in")).toBeVisible();
  await expect(page.getByText("OpenStreetMap")).toBeVisible();
  await page.locator(".leaflet-control-zoom-in").click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".leaflet-container")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(report.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("coach-route-map.png"),
    fullPage: true,
  });
});
