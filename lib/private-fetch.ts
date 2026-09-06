// All account APIs still authorize on the server. This also locks stale UI
// immediately when an expired/revoked session or changed account is rejected.
export async function privateFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const response = await fetch(input, { ...init, cache: "no-store" });
  if (response.status === 401 && typeof window !== "undefined")
    window.dispatchEvent(new Event("lift-session-invalid"));
  return response;
}
