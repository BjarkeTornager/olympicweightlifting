// An upload click authorizes automatic logging. A copied URL alone does not.
// Keep the handoff in memory, scoped to both account and image; no pixels stored.
const pending = new Set<string>();
export function authorizeActivityPhoto(accountId: string, imageId: string) {
  pending.add(`${accountId}:${imageId}`);
}
export function consumeActivityPhoto(accountId: string, imageId: string) {
  return pending.delete(`${accountId}:${imageId}`);
}
