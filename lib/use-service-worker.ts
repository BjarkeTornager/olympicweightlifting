"use client";
import { useEffect, useState } from "react";

// Registers the offline service worker in production and reports when a new
// version is waiting. activate() swaps to it and reloads once it takes over.
export function useServiceWorkerUpdate() {
  const [updateReady, setUpdateReady] = useState(false),
    [worker, setWorker] = useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    const activated = () => setUpdateReady(false);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.addEventListener("controllerchange", activated);
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          setWorker(reg);
          if (reg.waiting && navigator.serviceWorker.controller)
            setUpdateReady(true);
          reg.addEventListener("updatefound", () =>
            reg.installing?.addEventListener("statechange", () => {
              if (reg.waiting && navigator.serviceWorker.controller)
                setUpdateReady(true);
            }),
          );
        })
        .catch(() => {});
    }
    return () => {
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          activated,
        );
    };
  }, []);
  const activate = () => {
    if (!worker?.waiting) {
      setUpdateReady(false);
      return;
    }
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
    worker?.waiting?.postMessage({ type: "ACTIVATE" });
  };
  return { updateReady, activate };
}

// Fetches the newest app version and switches to it now, for when an old
// cached app has been refused by the server.
export async function updateAppNow() {
  const reg =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration()
      : undefined;
  await reg?.update().catch(() => {});
  const waiting = reg?.waiting ?? reg?.installing;
  if (!waiting || !navigator.serviceWorker.controller) {
    location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => location.reload(),
    { once: true },
  );
  waiting.postMessage({ type: "ACTIVATE" });
  // Reload anyway if the switch does not happen promptly.
  setTimeout(() => location.reload(), 4000);
}
