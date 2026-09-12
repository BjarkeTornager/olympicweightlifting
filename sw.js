const CACHE_NAME = "lift-journal-shell-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/app.js",
  "./js/data.js",
  "./js/public-data.js",
  "./js/storage.js",
  "./js/progression.js",
  "./js/updates.js",
  "./js/refresh.js",
  "./refresh.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png"
];

function scopedUrl(relativePath) {
  return new URL(relativePath, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((path) => new Request(scopedUrl(path), { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("lift-journal-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    // Revalidate the HTTP cache too: Safari can otherwise reuse an old script.
    const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
    if (response.ok) {
      // A full cache must never prevent an online page from loading.
      await cache.put(cacheKey, response.clone()).catch(() => {});
      return response;
    }
    return (await cache.match(cacheKey)) ?? response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin || !request.url.startsWith(self.registration.scope)) return;

  // Keep recovery-page requests separate from the journal's offline entry page.
  const isJournal = request.mode === "navigate" &&
    [scopedUrl("./"), scopedUrl("./index.html")].includes(requestUrl.origin + requestUrl.pathname);
  const cacheKey = isJournal ? scopedUrl("./index.html") : request;
  const response = networkFirst(request, cacheKey);
  event.respondWith(response);
  event.waitUntil(response.then(() => {}, () => {}));
});
