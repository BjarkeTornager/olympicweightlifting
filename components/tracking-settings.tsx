"use client";
import { useEffect, useState } from "react";
import type { JournalController } from "./journal";
import {
  defaultReminderPreferences,
  type ReminderPreferences,
} from "@/lib/reminders";
import { privateFetch } from "@/lib/private-fetch";
import { Button } from "./ui/button";

async function accountRequest(
  accountId: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await privateFetch(path, {
    method,
    headers: {
      "X-Journal-Account": accountId,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error ?? "Could not save. Please try again.");
  return result;
}
type ReminderStatus = {
  configured: boolean;
  publicKey: string | null;
  enabled: boolean;
  preferences: ReminderPreferences;
  lastStatus: string | null;
};
function ReminderSettings({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [preferences, setPreferences] = useState(defaultReminderPreferences);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
  );
  useEffect(() => {
    let alive = true;
    void accountRequest(accountId, "/api/reminders")
      .then((data: ReminderStatus) => {
        if (!alive) return;
        setStatus(data);
        setError("");
        setPreferences(
          data.enabled
            ? data.preferences
            : {
                ...data.preferences,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              },
        );
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [accountId, attempt]);
  const enable = async () => {
    if (!status?.publicKey || !supported || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    let created: PushSubscription | null = null;
    try {
      // Request permission inside the user's tap, before any network work.
      if ((await Notification.requestPermission()) !== "granted")
        throw Error(
          "Notifications are off. Allow them in your device settings, then try again.",
        );
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (!registration?.active)
        throw Error(
          "The app is still preparing notifications. Reload and try again.",
        );
      const key = Uint8Array.from(
        atob(status.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      );
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        created = subscription;
      }
      await accountRequest(accountId, "/api/reminders", "PUT", {
        preferences,
        subscription: subscription.toJSON(),
      });
      setStatus({ ...status, enabled: true, preferences });
      setNotice(
        `Reminder saved for ${preferences.time} in ${preferences.timezone}. This is the receiving device.`,
      );
    } catch (e) {
      if (created) await created.unsubscribe().catch(() => {});
      setError(
        e instanceof Error ? e.message : "Could not turn on notifications.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="tracking-section"
      aria-labelledby="daily-reminder-title"
    >
      <h3 id="daily-reminder-title">One gentle reminder</h3>
      <p>
        At most once a day, only when a selected record is missing.
        Notifications contain no health details.
      </p>
      {!supported && (
        <p className="notice">
          On iPhone, open this website in Safari, choose Share → Add to Home
          Screen, then open it from that icon to enable notifications.
        </p>
      )}
      {status && !status.configured && (
        <p className="notice">
          Reminders are not available on this server yet. Your preference stays
          off until setup is complete.
        </p>
      )}
      <div className="tracking-fields">
        <label>
          Reminder time
          <input
            type="time"
            value={preferences.time}
            onChange={(e) =>
              setPreferences({ ...preferences, time: e.target.value })
            }
          />
        </label>
        <label>
          Time zone
          <input
            value={preferences.timezone}
            onChange={(e) =>
              setPreferences({ ...preferences, timezone: e.target.value })
            }
            autoComplete="off"
          />
        </label>
      </div>
      <Button
        variant="ghost"
        onClick={() =>
          setPreferences({
            ...preferences,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })
        }
      >
        Use this device’s time zone
      </Button>
      <fieldset className="tracking-topics">
        <legend>Remind me about</legend>
        {(
          [
            ["food", "Food, if no meal is recorded"],
            ["sleep", "Sleep, if no duration is recorded"],
            ["workout", "An unfinished workout today"],
          ] as const
        ).map(([id, label]) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={preferences.topics.includes(id)}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  topics: e.target.checked
                    ? [...preferences.topics, id]
                    : preferences.topics.filter((t) => t !== id),
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="fine-print">
        Rest days need no training entry. The time zone stays as chosen when you
        travel. Enabling here moves delivery to this device.
      </p>
      <div className="button-row">
        <Button
          disabled={
            busy ||
            !status?.configured ||
            !supported ||
            !preferences.topics.length ||
            !preferences.time
          }
          onClick={() => void enable()}
        >
          {busy
            ? "Saving…"
            : status?.enabled
              ? "Save reminder on this device"
              : "Enable reminder on this device"}
        </Button>
        {status?.enabled && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await accountRequest(accountId, "/api/reminders", "DELETE");
                setStatus({ ...status, enabled: false });
                setNotice("Reminders turned off on all devices.");
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not turn off reminders. Please retry.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Turn off reminders
          </Button>
        )}
      </div>
      {status && (
        <p className="fine-print">
          {status.enabled ? "Reminder is on." : "Reminder is off."}
          {status.lastStatus === "failed"
            ? " The last delivery failed; we will try on the next day."
            : status.lastStatus === "expired"
              ? " Your browser subscription expired. Enable it again to reconnect."
              : ""}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {!status && (
            <Button
              variant="secondary"
              onClick={() => setAttempt((v) => v + 1)}
            >
              Retry reminder settings
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

type HealthStatus = {
  connected: boolean;
  lastSyncAt?: string | null;
  lastDate?: string | null;
  lastResult?: string | null;
};
function HealthConnection({ journal }: { journal: JournalController }) {
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [endpoint] = useState(() =>
    typeof location === "undefined"
      ? ""
      : `${location.origin}/api/integrations/apple-health/sleep`,
  );
  const [attempt, setAttempt] = useState(0);
  const accountId = journal.identity.id;
  useEffect(() => {
    let alive = true;
    void accountRequest(accountId, "/api/integrations/apple-health")
      .then((data: HealthStatus) => {
        if (alive) {
          setStatus(data);
          setStep((current) =>
            data.lastSyncAt ? 3 : data.connected && current === 1 ? 2 : current,
          );
          setError("");
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [accountId, attempt]);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError("Copy was unavailable. Select and copy the value manually.");
    }
  };
  return (
    <section
      className="tracking-section"
      aria-labelledby="health-connection-title"
    >
      <h3 id="health-connection-title">Sleep from Apple Health</h3>
      <p>
        Use an iPhone Shortcut to send measured sleep to this journal. No
        developer account needed. This first version imports sleep only.
      </p>
      <p className="fine-print">
        Follow the three steps below. Test while your phone is unlocked before
        adding an automation; a locked phone or delayed Watch sync can prevent
        an import.
      </p>
      <nav className="sleep-setup-steps" aria-label="Sleep setup steps">
        {[
          [1, "Connect"],
          [2, "Set up Shortcut"],
          [3, "Test & automate"],
        ].map(([number, label]) => (
          <Button
            key={number}
            variant={step === number ? "default" : "secondary"}
            aria-current={step === number ? "step" : undefined}
            onClick={() => setStep(Number(number))}
          >
            {number}. {label}
          </Button>
        ))}
      </nav>
      {status && (
        <div className="notice">
          <span>
            {!status.connected
              ? "Not connected."
              : status.lastSyncAt
                ? `Last successful check: ${new Date(status.lastSyncAt).toLocaleString()}${status.lastDate ? ` · sleep for ${status.lastDate}` : ""}`
                : "Key created. Waiting for your first successful import."}
            {status.lastResult === "failed" &&
              " The latest attempt failed. Open the Shortcut on your unlocked phone and retry."}
            {status.lastResult === "preserved" &&
              " Your manual entry or deletion was kept."}
          </span>
        </div>
      )}
      <div className="button-row" hidden={step !== 1}>
        <Button
          disabled={busy || !status}
          variant="secondary"
          onClick={async () => {
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const data = await accountRequest(
                accountId,
                "/api/integrations/apple-health",
                "POST",
              );
              setToken(data.token);
              setStatus({ connected: true });
              setStep(2);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not create a key.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {status?.connected ? "Replace import key" : "Create sleep import key"}
        </Button>
        {status?.connected && (
          <Button
            disabled={busy}
            variant="ghost"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await accountRequest(
                  accountId,
                  "/api/integrations/apple-health",
                  "DELETE",
                );
                setToken("");
                setStatus({ connected: false });
                setStep(1);
                setNotice(
                  "Disconnected. Previously imported sleep stays in your journal.",
                );
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not disconnect. Please retry.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect Apple Health
          </Button>
        )}
      </div>
      <p className="fine-print" hidden={step !== 1}>
        Creating a key allows its holder to import sleep into your account.
        Replacing or disconnecting it disables the old key immediately.
      </p>
      {token && step === 2 && (
        <div className="form-stack tracking-key">
          <label>
            Sleep import key — shown once
            <input type="password" readOnly value={token} autoComplete="off" />
          </label>
          <Button
            variant="secondary"
            onClick={() => void copy(token, "Import key")}
          >
            Copy import key
          </Button>
          <p className="fine-print">
            Keep this in your Shortcut. Do not share it or paste it into chat.
          </p>
        </div>
      )}
      <div className="tracking-instructions" hidden={step !== 2}>
        <h4>Set up the iPhone Shortcut</h4>
        {!status?.connected && <p>Create an import key in step 1 first.</p>}
        <p>
          Create a shortcut named “Send sleep to Lift Journal” in Apple’s
          Shortcuts app. The following values use the date you woke up.
        </p>
        <ol>
          <li>
            Use Current Date, Format Date (<code>yyyy-MM-dd</code>) for{" "}
            <code>date</code>. Use your IANA time zone, for example{" "}
            <code>Europe/Copenhagen</code>.
          </li>
          <li>
            Find Health Samples with Type = Sleep, Start Date after noon
            yesterday and End Date before noon today. Allow Shortcuts to read
            sleep. Run after your Watch has synced.
          </li>
          <li>
            Repeat with Each sample. Get its Start Date, End Date and Value.
            Format both dates as ISO 8601 including the time-zone offset. Map
            the value to <code>asleep</code>, <code>core</code>,{" "}
            <code>deep</code> or <code>rem</code>; skip Awake and In Bed. Labels
            may be localized. Add a Dictionary with <code>start</code>,{" "}
            <code>end</code> and <code>value</code> to a list called{" "}
            <code>samples</code>.
          </li>
          <li>
            Get Contents of URL using the endpoint below, Method POST. Add
            headers <code>Authorization: Bearer YOUR_KEY</code> and{" "}
            <code>Content-Type: application/json</code>. Set the JSON body to{" "}
            <code>date</code> (formatted date), <code>timezone</code> (your time
            zone), and <code>samples</code> (the list).
          </li>
        </ol>
        <label>
          Sleep import endpoint
          <input readOnly value={endpoint} />
        </label>
        <Button
          variant="secondary"
          onClick={() => void copy(endpoint, "Endpoint")}
        >
          Copy endpoint
        </Button>
        <p className="fine-print">
          Only the last 14 waking dates are accepted. Overnight sleep belongs to
          its waking date; the import window is noon to noon. Overlapping sleep
          stages are counted once. Manual corrections and deleted imports are
          kept on retry.
        </p>
        <p className="fine-print">
          The Shortcut needs testing on your iPhone. This connection does not
          read Apple Health directly from the browser or import workout sets.
        </p>
        <Button onClick={() => setStep(3)}>
          Shortcut ready — test connection
        </Button>
      </div>
      {step === 3 && (
        <div className="tracking-instructions">
          <h4>Test before automating</h4>
          <ol>
            <li>
              Open Apple Health and wait for your Watch to sync. Run the
              Shortcut while your iPhone is unlocked and allow it to read sleep.
            </li>
            <li>
              Add Show Result to the Shortcut to inspect its response. Then
              refresh below and compare the imported duration with Apple Health.
            </li>
            <li>
              After a successful check, create a morning personal automation in
              Shortcuts to run it. Keep a Home Screen shortcut so you can retry
              if needed.
            </li>
          </ol>
          <Button
            disabled={busy}
            onClick={() => {
              setAttempt((v) => v + 1);
              void journal.sync(true);
            }}
          >
            Refresh sync status
          </Button>
          <p role="status">
            {status?.lastSyncAt
              ? "A sleep import has reached your journal. Check the duration in Today before turning on your automation."
              : "Waiting for your first successful import. Creating a key alone does not start automatic syncing."}
          </p>
          {status?.lastSyncAt && (
            <Button
              variant="secondary"
              onClick={() => {
                location.hash = "today";
              }}
            >
              View sleep in Today
            </Button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function TrackingSettings({
  journal,
  initiallyOpen = false,
}: {
  journal: JournalController;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className="panel tracking-settings">
      <h2>Less to remember</h2>
      <p>Optional reminders and sleep imports, with you in control.</p>
      <Button
        variant="secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Close tracking settings" : "Reminders & Apple Health"}
      </Button>
      {open && (
        <>
          <HealthConnection journal={journal} />
          <ReminderSettings accountId={journal.identity.id} />
        </>
      )}
    </section>
  );
}
