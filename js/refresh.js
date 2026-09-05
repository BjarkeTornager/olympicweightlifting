function waitForActivation(registration) {
  return new Promise((resolve, reject) => {
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) { reject(new Error("No update is available yet.")); return; }
    const timeout = setTimeout(() => finish(new Error("The update is taking too long.")), 20000);
    function finish(error) {
      clearTimeout(timeout);
      worker.removeEventListener("statechange", check);
      navigator.serviceWorker.removeEventListener("controllerchange", check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (worker.state === "redundant") finish(new Error("The update could not be installed."));
      else if (worker.state === "activated" && navigator.serviceWorker.controller === worker) finish();
    }
    worker.addEventListener("statechange", check);
    navigator.serviceWorker.addEventListener("controllerchange", check);
    check();
  });
}

async function refreshJournal() {
  const status = document.querySelector("#refresh-status");
  const retry = document.querySelector("#refresh-retry");
  retry.hidden = true;
  document.querySelector("#refresh-title").textContent = "Refreshing your journal…";
  status.textContent = "Getting the latest programs. Your saved workouts and PRs stay on this device.";
  try {
    if (!navigator.onLine) throw new Error("Connect to the internet to get the update.");
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        scope: "./", updateViaCache: "none",
      });
      await registration.update();
      await waitForActivation(registration);
    }
    const destination = new URL("./", window.location.href);
    destination.searchParams.set("updated", Date.now());
    destination.hash = window.location.hash || "#workout";
    window.location.replace(destination.href);
  } catch {
    document.querySelector("#refresh-title").textContent = "The refresh couldn't finish";
    status.textContent = "The update couldn't be downloaded. Your saved workouts are still on this device. Check your connection and try again.";
    retry.hidden = false;
  }
}

document.querySelector("#refresh-retry").addEventListener("click", refreshJournal);
refreshJournal();
