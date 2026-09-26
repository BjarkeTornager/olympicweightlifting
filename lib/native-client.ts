// The native iPhone app identifies itself as `X-Client: ios/<version>/<build>`.
// Unlike the website, an installed build cannot reload itself: a TestFlight
// build lives for 90 days and updates only when the athlete installs a newer
// one. A build therefore stays supported until MIN_IOS_BUILD is raised on
// purpose, and only then receives a 426 asking for an update.
export const MIN_IOS_BUILD = Math.max(
  1,
  Number.parseInt(process.env.MIN_IOS_BUILD ?? "1", 10) || 1,
);

export type NativeClient = { platform: "ios"; version: string; build: number };

export function nativeClient(request: Request): NativeClient | null {
  const match = request.headers
    .get("x-client")
    ?.match(/^ios\/(\d{1,4}(?:\.\d{1,4}){0,2})\/(\d{1,9})$/);
  return match
    ? { platform: "ios", version: match[1], build: Number(match[2]) }
    : null;
}

export const nativeSupported = (client: NativeClient) =>
  client.build >= MIN_IOS_BUILD;

export const nativeUpdateMessage =
  "Install the latest Lift Journal build from TestFlight to continue. Your journal is safe.";
