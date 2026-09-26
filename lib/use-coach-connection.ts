"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { privateFetch } from "./private-fetch";
import type { Turn } from "./coach-turns";

export type CoachConnection = {
  enabled: boolean;
  provider: string | null;
  protocol?: string;
};

// Connects to Coach for this account and loads saved turns. Until a
// connection succeeds it retries every 15 seconds and when the tab returns
// or the device comes back online.
export function useCoachConnection(
  accountId: string | undefined,
  onTurns: (turns: Turn[]) => void,
) {
  const [connection, setConnection] = useState<CoachConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const ready = useRef(false);
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "X-Journal-Account": accountId ?? "",
    }),
    [accountId],
  );
  const received = useRef(onTurns);
  useEffect(() => {
    received.current = onTurns;
  });
  const refresh = useCallback(async () => {
    if (!accountId || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const r = await privateFetch("/api/agent", {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      });
      const data = await r.json();
      if (!r.ok) throw Error("Coach couldn’t connect. Please try again.");
      controller.signal.throwIfAborted();
      ready.current = Boolean(data.enabled);
      setConnection({
        enabled: data.enabled,
        provider: data.provider,
        protocol: data.protocol,
      });
      received.current(data.turns);
    } catch {
      if (!controller.signal.aborted) {
        ready.current = false;
        setError("Coach couldn’t connect. Your draft is still here.");
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [accountId, headers]);
  useEffect(() => {
    const retry = () => {
      if (!ready.current && document.visibilityState === "visible")
        void refresh();
    };
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(retry, 15000);
    window.addEventListener("online", retry);
    window.addEventListener("pageshow", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      request.current?.abort();
      request.current = null;
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener("online", retry);
      window.removeEventListener("pageshow", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [refresh]);
  // Reconnect only if the last attempt failed; a live connection is kept.
  const reconnect = () => {
    if (!ready.current) void refresh();
  };
  return { connection, loading, error, headers, reconnect, refresh };
}
