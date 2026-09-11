import { test, expect } from "@playwright/test";
test("video listing, details, playback and mutations reject unsigned and foreign-origin requests", async ({
  request,
  baseURL,
}) => {
  const id = "00000000-0000-4000-8000-000000000000";
  for (const path of [
    "/api/lifting-videos",
    `/api/lifting-videos/${id}`,
    `/api/lifting-videos/${id}/media`,
  ]) {
    const response = await request.get(path, {
      headers: {
        "X-Journal-Account": "untrusted-account",
        Range: "bytes=0-50",
      },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  }
  for (const [path, method] of [
    ["/api/lifting-videos", "POST"],
    [`/api/lifting-videos/${id}`, "DELETE"],
    [`/api/lifting-videos/${id}/retry`, "POST"],
  ]) {
    const response = await request.fetch(path, {
      method,
      headers: { Origin: baseURL!, "X-Journal-Account": "untrusted-account" },
    });
    expect(response.status()).toBe(401);
    const cross = await request.fetch(path, {
      method,
      headers: {
        Origin: "https://untrusted.example",
        "X-Journal-Account": "untrusted-account",
      },
    });
    expect(cross.status()).toBe(403);
  }
});
