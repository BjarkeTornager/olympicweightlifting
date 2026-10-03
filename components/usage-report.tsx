"use client";
import { useEffect, useState } from "react";
import { privateFetch } from "@/lib/private-fetch";
import type { UsageReport as Report } from "@/lib/usage-report";

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "–";
// Cents for a dollar or more; small amounts keep four decimals.
const dollars = (n: number) =>
  n === 0 ? "$0" : `$${n.toFixed(n < 1 ? 4 : 2)}`;

// Owner only: totals and averages across accounts, never anyone's records.
// AI cost is shown per account, under the start of its id.
export function UsageReport({ accountId }: { accountId: string }) {
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void privateFetch("/api/owner/usage", {
      headers: { "X-Journal-Account": accountId },
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        setReport(await r.json());
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Could not load usage. Try again.");
      });
    return () => abort.abort();
  }, [accountId]);
  return (
    <section className="panel usage-panel" aria-labelledby="usage-title">
      <div className="eyebrow">Owner only</div>
      <h2 id="usage-title">Usage</h2>
      <p>
        Counts and averages across everyone, without anything they recorded or
        said. The main measure is full days: sleep, food and movement all
        recorded.
      </p>
      {error && <p role="alert">{error}</p>}
      {!report && !error && <p>Loading…</p>}
      {report && (
        <>
          <p>
            <strong>{report.people.total}</strong> people ·{" "}
            <strong>{report.people.active7}</strong> active in the last 7 days ·{" "}
            <strong>{report.people.active28}</strong> in the last 28
          </p>
          <h3>Recorded days per active person</h3>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Recorded days per week"
          >
            <table className="training-table">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th>Active</th>
                  <th>Full days</th>
                  <th>Any record</th>
                </tr>
              </thead>
              <tbody>
                {report.weeks.map((w, i) => (
                  <tr key={w.start}>
                    <th>
                      {shortDate(w.start)}
                      {i === 0 ? " (so far)" : ""}
                    </th>
                    <td>{w.active}</td>
                    <td>{w.fullDays}</td>
                    <td>{w.anyDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Still recording in week 4</h3>
          {report.retention.length ? (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Week 4 retention"
            >
              <table className="training-table">
                <thead>
                  <tr>
                    <th>Joined week of</th>
                    <th>Joined</th>
                    <th>Week 4</th>
                  </tr>
                </thead>
                <tbody>
                  {report.retention.map((r) => (
                    <tr key={r.week}>
                      <th>{shortDate(r.week)}</th>
                      <td>{r.joined}</td>
                      <td>
                        {r.week4 === null
                          ? "Not yet"
                          : `${r.week4} (${percent(r.week4, r.joined)})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Nobody joined in the last twelve weeks.</p>
          )}
          <h3>Features in the last 28 days</h3>
          {report.features.length ? (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Feature use"
            >
              <table className="training-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>People</th>
                    <th>Uses</th>
                    <th>Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {report.features.map((f) => (
                    <tr key={f.feature}>
                      <th>
                        <code>{f.feature}</code>
                      </th>
                      <td>{f.people}</td>
                      <td>{f.uses}</td>
                      <td>{shortDate(f.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Feature use appears here from the day this release went live.</p>
          )}
          <h3>AI cost</h3>
          <p>
            What each account&apos;s AI calls cost today and this month (UTC):
            model calls and dish pictures as the provider reported them, routing
            and web searches at list price, and voice calls estimated from their
            minutes
            {report.aiCost.total.estimated
              ? ` (${dollars(report.aiCost.total.estimated)} this month)`
              : ""}
            . Accounts are shown by the start of their id.
          </p>
          {report.aiCost.accounts.length ? (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="AI cost per account"
            >
              <table className="training-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Today</th>
                    <th>This month</th>
                    <th>Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {report.aiCost.accounts.map((a) => (
                    <tr key={a.account}>
                      <th>
                        <code>{a.account}</code>
                        {a.you ? " (you)" : ""}
                      </th>
                      <td>{dollars(a.today)}</td>
                      <td>{dollars(a.month)}</td>
                      <td>{a.calls}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Everyone</th>
                    <td>{dollars(report.aiCost.total.today)}</td>
                    <td>{dollars(report.aiCost.total.month)}</td>
                    <td>{report.aiCost.total.calls}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p>No AI calls recorded this month yet.</p>
          )}
        </>
      )}
    </section>
  );
}
