import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("push shows a generic notification and its click opens quick capture on this origin", async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const notifications: {
    title: string;
    options: { body: string; tag: string };
  }[] = [];
  let opened = "",
    message: unknown,
    focused = 0,
    closed = 0,
    pending: Promise<unknown> = Promise.resolve();
  const context = vm.createContext({
    URL,
    self: {
      location: { origin: "https://journal.example.test" },
      addEventListener: (type: string, fn: (typeof handlers)[string]) => {
        handlers[type] = fn;
      },
      registration: {
        showNotification: async (
          title: string,
          options: (typeof notifications)[number]["options"],
        ) => {
          notifications.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => [
          {
            url: "https://journal.example.test/#food",
            postMessage: (value: unknown) => {
              message = value;
            },
            focus: async () => {
              focused++;
            },
          },
        ],
        openWindow: async (url: string) => {
          opened = url;
        },
      },
    },
  });
  vm.runInContext(
    readFileSync("scripts/service-worker-push.js", "utf8"),
    context,
  );
  const waitUntil = (p: Promise<unknown>) => {
    pending = p;
  };
  handlers.push({
    waitUntil,
    data: {
      json: () => ({
        title: "Private health details",
        url: "https://evil.test",
      }),
    },
  });
  await pending;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "A moment for your journal");
  assert.equal(notifications[0].options.tag, "daily-catch-up");
  handlers.notificationclick({
    waitUntil,
    notification: {
      close: () => {
        closed++;
      },
    },
  });
  await pending;
  assert.equal(
    JSON.stringify(message),
    JSON.stringify({ type: "OPEN_CAPTURE" }),
  );
  assert.equal(
    opened,
    "",
    "An existing draft must not be lost to a full navigation",
  );
  assert.equal(focused, 1);
  assert.equal(closed, 1);
});
