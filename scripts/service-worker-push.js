// Deliberately generic: no food, sleep, account or workout details on a lock screen.
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("A moment for your journal", {
      body: "Anything you’d like to add today? A photo or a sentence is enough.",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: "daily-catch-up",
      renotify: false,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL("/#coach/capture", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find(
        (client) =>
          new URL(client.url).origin === self.location.origin &&
          ["/", "/offline.html"].includes(new URL(client.url).pathname),
      );
      if (existing) {
        // Keep the existing Coach draft/run alive instead of reloading the tab.
        existing.postMessage({ type: "OPEN_CAPTURE" });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
