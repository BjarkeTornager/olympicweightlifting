// All account APIs still authorize on the server. This also locks stale UI
// immediately when an expired/revoked session or changed account is rejected.
export function privateRequestHeaders(input?: HeadersInit) {
  const headers = new Headers(input);
  headers.set("X-Coach-Journal-Version", "1");
  headers.set("X-Coach-Logging-Version", "1");
  headers.set("X-Training-Programs-Version", "2");
  headers.set("X-Lifting-Coach-Version", "1");
  headers.set("X-Food-Tags-Version", "1");
  headers.set("X-Activity-Photos-Version", "1");
  headers.set("X-Sleep-Import-Version", "1");
  return headers;
}
export function checkPrivateResponse(status: number) {
  if (status === 401 && typeof window !== "undefined")
    window.dispatchEvent(new Event("lift-session-invalid"));
}
export async function privateFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const headers = privateRequestHeaders(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  checkPrivateResponse(response.status);
  return response;
}
