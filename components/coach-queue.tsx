"use client";
import { ChevronDown, X } from "@/components/ui/icons";
import { videoFeedbackLabel } from "@/lib/lifting-video";
import { Button } from "./ui/button";
import { MAX_QUEUED_MESSAGES, type QueuedMessage } from "@/lib/coach-queue";

export {
  MAX_QUEUED_MESSAGES,
  QUEUE_FULL_MESSAGE,
  queuedMessage,
  type QueuedMessage,
} from "@/lib/coach-queue";

const messageLabel = (job: QueuedMessage) =>
  videoFeedbackLabel(job.question, job.photoIds.length) ?? job.question;

export function CoachQueue({
  queue,
  failedMessage,
  disabled,
  onRetry,
  onSkip,
  onRemove,
}: {
  queue: QueuedMessage[];
  failedMessage: QueuedMessage | null;
  disabled: boolean;
  onRetry: () => void;
  onSkip: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="coach-queue" aria-label="Message queue">
      <details open={failedMessage ? true : undefined}>
        <summary>
          <span role="status">
            {failedMessage ? "Queue paused" : `${queue.length} queued`}
          </span>
          <span>
            View messages <ChevronDown size={14} />
          </span>
        </summary>
        <p>
          <span>
            {failedMessage
              ? "Retry the interrupted message or skip it to continue."
              : queue.length >= MAX_QUEUED_MESSAGES
                ? "Your queue is full. Remove a message or let Coach catch up."
                : "Coach will reply in order. Keep this tab open; you can explore the site."}
          </span>
        </p>
        {failedMessage && (
          <div className="coach-queue-failed">
            <p>{messageLabel(failedMessage)}</p>
            <div>
              <Button variant="secondary" disabled={disabled} onClick={onRetry}>
                Retry message
              </Button>
              <Button variant="ghost" disabled={disabled} onClick={onSkip}>
                Skip and continue
              </Button>
            </div>
          </div>
        )}
        {queue.length > 0 && (
          <ol>
            {queue.map((job, index) => (
              <li key={job.id}>
                <span>
                  <strong>{index + 1}.</strong> {messageLabel(job)}
                  {job.photoIds.length > 0 && (
                    <small>
                      {" "}
                      · {job.photoIds.length} attached{" "}
                      {job.photoIds.length === 1 ? "image" : "images"}
                    </small>
                  )}
                </span>
                <Button
                  variant="ghost"
                  aria-label={`Remove queued message ${index + 1}`}
                  onClick={() => onRemove(job.id)}
                >
                  <X size={16} />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
