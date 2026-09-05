// Loaded separately so even a previously cached app can receive update notices.
if ("serviceWorker" in navigator) {
  let controlled = Boolean(navigator.serviceWorker.controller);
  let checking = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled) {
      const notice = document.querySelector("#app-update");
      if (notice) notice.hidden = false;
    }
    controlled = true;
  });

  document.querySelector("#app-update-link")?.addEventListener("click", (event) => {
    // Keep the current view; refreshing is explicit so workouts aren't interrupted.
    event.currentTarget.hash = window.location.hash || "#dashboard";
  });

  async function checkForUpdate() {
    if (checking || !navigator.onLine) return;
    checking = true;
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        scope: "./", updateViaCache: "none",
      });
      await registration.update();
    } catch (error) {
      // Keep the existing offline journal available when an update cannot connect.
      console.warn("Journal update check unavailable", error);
    } finally {
      checking = false;
    }
  }

  window.addEventListener("load", checkForUpdate);
  window.addEventListener("online", checkForUpdate);
  window.addEventListener("pageshow", (event) => { if (event.persisted) checkForUpdate(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
}
