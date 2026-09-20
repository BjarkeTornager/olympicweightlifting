"use client";
import { useEffect, useState } from "react";
import { privateFetch } from "@/lib/private-fetch";
import type { TrackingNotice } from "@/lib/tracking-status";
import { Button } from "./ui/button";
type Status = {
  notices: TrackingNotice[];
  sleep: {
    connected: boolean;
    lastSyncAt?: string | null;
    lastDate?: string | null;
  };
};
export function TrackingStatus({
  accountId,
  go,
}: {
  accountId: string;
  go: (route: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    privateFetch("/api/tracking/status", {
      headers: { "X-Journal-Account": accountId },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data: Status) => {
        if (!controller.signal.aborted) {
          setStatus(data);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [accountId, attempt]);
  if (error)
    return (
      <p className="fine-print">
        Connection status unavailable.{" "}
        <button onClick={() => setAttempt((n) => n + 1)}>Retry status</button>
      </p>
    );
  if (!status) return null;
  return (
    <div className="tracking-status">
      {status.notices.map((notice) => (
        <div className="notice" role="status" key={notice.code}>
          <span>{notice.message}</span>
          <Button variant="ghost" onClick={() => go(notice.route)}>
            Open
          </Button>
        </div>
      ))}
      <button className="text-link" onClick={() => go("data/sleep")}>
        {status.sleep.connected
          ? status.sleep.lastDate
            ? `Apple Health · last imported ${status.sleep.lastDate}`
            : "Apple Health · waiting for the first import"
          : "Connect sleep from Apple Health"}
      </button>
    </div>
  );
}
