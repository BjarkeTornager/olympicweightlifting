// Messages wait here in order; Coach runs one at a time.
export type QueuedMessage = {
  id: string;
  question: string;
  photoIds: string[];
  timezone: string;
  submittedAt: string;
};
export const MAX_QUEUED_MESSAGES = 20;
export const QUEUE_FULL_MESSAGE =
  "Your queue is full. Let Coach finish a message or remove a queued message.";

export function queuedMessage(
  id: string,
  question: string,
  photoIds: string[],
): QueuedMessage {
  return {
    id,
    question,
    photoIds,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    submittedAt: new Date().toISOString(),
  };
}
