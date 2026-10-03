import { test } from "node:test";
import assert from "node:assert/strict";
import { aiCostReport, usageReport, weekStart } from "../lib/usage-report";

const now = new Date("2026-10-02T12:00:00Z"); // a Friday

test("Weeks start on Monday", () => {
  assert.equal(weekStart("2026-10-02"), "2026-09-28");
  assert.equal(weekStart("2026-09-28"), "2026-09-28");
  assert.equal(weekStart("2026-10-04"), "2026-09-28");
});

test("The usage report counts full days, retention and features without identities", () => {
  const people = [
    { id: "a", joined: "2026-08-03" },
    { id: "b", joined: "2026-08-05" },
    { id: "c", joined: "2026-09-29" },
  ];
  const recorded = new Map([
    [
      "a",
      {
        // Monday and Tuesday this week are full; Wednesday has sleep only.
        sleep: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-08-25"],
        food: ["2026-09-28", "2026-09-29"],
        movement: ["2026-09-28", "2026-09-29"],
        other: [],
      },
    ],
    ["b", { sleep: [], food: [], movement: [], other: ["2026-09-21"] }],
  ]);
  const report = usageReport(
    people,
    recorded,
    [
      { userId: "a", feature: "coach.message", day: "2026-10-01", count: 3 },
      { userId: "c", feature: "coach.message", day: "2026-10-02", count: 1 },
      {
        userId: "c",
        feature: "voice.call.google",
        day: "2026-10-02",
        count: 1,
      },
      // Older than 28 days: active then, but not in the feature list.
      { userId: "b", feature: "app.log_drink", day: "2026-08-01", count: 9 },
    ],
    now,
  );
  assert.deepEqual(report.people, { total: 3, active7: 2, active28: 3 });
  assert.deepEqual(report.weeks[0], {
    start: "2026-09-28",
    active: 2,
    fullDays: 1, // a: 2 full days, c: none
    anyDays: 1.5, // a: 3 days, c: none recorded
  });
  assert.deepEqual(report.weeks[1], {
    start: "2026-09-21",
    active: 1,
    fullDays: 0,
    anyDays: 1,
  });
  assert.equal(report.weeks.length, 8);
  // a recorded on 25 August, day 22 after joining; b didn't.
  assert.deepEqual(
    report.retention.find((r) => r.week === "2026-08-03"),
    { week: "2026-08-03", joined: 2, week4: 1 },
  );
  assert.deepEqual(
    report.retention.find((r) => r.week === "2026-09-28"),
    { week: "2026-09-28", joined: 1, week4: null },
  );
  assert.deepEqual(report.features, [
    { feature: "coach.message", people: 2, uses: 4, last: "2026-10-02" },
    { feature: "voice.call.google", people: 1, uses: 1, last: "2026-10-02" },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /"(a|b|c)"/);
});

test("AI cost is totalled per account for today and this month, under a short id", () => {
  const owner = "0wner000-1111-2222-3333-444444444444",
    athlete = "athlete0-5555-6666-7777-888888888888";
  const cost = aiCostReport(
    [
      {
        userId: owner,
        day: "2026-10-02",
        costUsd: 0.4,
        calls: 6,
        estimatedUsd: 0,
      },
      {
        userId: owner,
        day: "2026-10-01",
        costUsd: 0.1,
        calls: 2,
        estimatedUsd: 0.1,
      },
      {
        userId: athlete,
        day: "2026-10-02",
        costUsd: 0.25,
        calls: 3,
        estimatedUsd: 0.2,
      },
      // Last month: not counted.
      {
        userId: athlete,
        day: "2026-09-30",
        costUsd: 2.5,
        calls: 40,
        estimatedUsd: 0,
      },
    ],
    now,
    owner,
  );
  assert.deepEqual(cost, {
    day: "2026-10-02",
    month: "2026-10",
    accounts: [
      {
        account: "0wner000",
        you: true,
        today: 0.4,
        month: 0.5,
        calls: 8,
        estimated: 0.1,
      },
      {
        account: "athlete0",
        you: false,
        today: 0.25,
        month: 0.25,
        calls: 3,
        estimated: 0.2,
      },
    ],
    total: { today: 0.65, month: 0.75, calls: 11, estimated: 0.3 },
  });
  assert.doesNotMatch(JSON.stringify(cost), /5555|1111/);
  // With no ledger rows the report still has an empty AI cost section.
  assert.deepEqual(usageReport([], new Map(), [], now).aiCost.accounts, []);
});
