"use client";
import { useEffect, useState } from "react";
import { privateFetch } from "./private-fetch";
import type { SavedVideoReview } from "./video/types";

// Polls the account's saved video reviews every five seconds while enabled,
// and again when the tab becomes visible or the device comes back online.
export function useVideoReviews(accountId: string, enabled: boolean) {
  const [reviews, setReviews] = useState<SavedVideoReview[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [bodyOverlayEnabled, setBodyOverlayEnabled] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const r = await privateFetch("/api/lifting-videos", {
          headers: { "X-Journal-Account": accountId },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
        if (!r.ok)
          throw Error(
            "Could not load saved video reviews. Reopen this window to retry.",
          );
        const data = await r.json();
        if (!abort.signal.aborted) {
          setReviews(data.videos);
          setBodyOverlayEnabled(data.bodyOverlayEnabled === true);
          setLastCheckedAt(Date.now());
          setConnectionIssue(false);
        }
      } catch {
        if (!abort.signal.aborted) setConnectionIssue(true);
      } finally {
        refreshing = false;
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      abort.abort();
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [accountId, enabled]);
  // Record a review the client already has, e.g. from an upload response.
  const received = () => {
    setLastCheckedAt(Date.now());
    setConnectionIssue(false);
  };
  return {
    reviews,
    setReviews,
    lastCheckedAt,
    connectionIssue,
    bodyOverlayEnabled,
    received,
  };
}

// Loads the full selected review, reloading when its summary changes and
// retrying five seconds after a failure.
export function useVideoReviewDetail(
  accountId: string,
  selected: string | null,
  summary: SavedVideoReview | undefined,
) {
  const [detail, setDetail] = useState<SavedVideoReview | null>(null);
  const [retry, setRetry] = useState(0);
  const [issue, setIssue] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const response = await privateFetch(`/api/lifting-videos/${selected}`, {
        headers: { "X-Journal-Account": accountId },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
      });
      if (!response.ok)
        throw Error("Could not open this review. Reopen it to retry.");
      const data = await response.json();
      if (!abort.signal.aborted) {
        setDetail(data);
        setIssue(false);
      }
    })().catch(() => {
      if (!abort.signal.aborted) {
        setIssue(true);
        retryTimer = setTimeout(() => setRetry((n) => n + 1), 5000);
      }
    });
    return () => {
      abort.abort();
      clearTimeout(retryTimer);
    };
  }, [
    selected,
    summary?.status,
    summary?.stage,
    summary?.hasMedia,
    summary?.progress?.updatedAt,
    accountId,
    retry,
  ]);
  return { detail, setDetail, issue };
}
