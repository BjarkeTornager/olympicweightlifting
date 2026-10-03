import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  capsWith,
  DEFAULT_CAPS,
  LIMIT_REPLIES,
  limitsMode,
  localPeriods,
  OWNER_CAPS,
  reachedLimits,
} from "../lib/usage-limits";

const iso = (d: Date) => d.toISOString();

test("A day and a month begin at the athlete's local midnight", () => {
  const copenhagen = (at: string) =>
    localPeriods("Europe/Copenhagen", new Date(at));
  // 23:59 and 00:00 on either side of a local midnight (summer time).
  assert.equal(
    iso(copenhagen("2026-10-03T21:59:00Z").day),
    "2026-10-02T22:00:00.000Z",
  );
  assert.equal(
    iso(copenhagen("2026-10-03T22:00:00Z").day),
    "2026-10-03T22:00:00.000Z",
  );
  assert.equal(
    iso(copenhagen("2026-10-03T12:00:00Z").month),
    "2026-09-30T22:00:00.000Z",
  );
  // The day the clocks go back began in summer time, the month too.
  assert.deepEqual(Object.values(copenhagen("2026-10-25T12:00:00Z")).map(iso), [
    "2026-10-24T22:00:00.000Z",
    "2026-09-30T22:00:00.000Z",
  ]);
  // The day the clocks go forward began in winter time.
  assert.equal(
    iso(copenhagen("2026-03-29T12:00:00Z").day),
    "2026-03-28T23:00:00.000Z",
  );
  // The day after, the month began in summer time and the day in winter time.
  assert.deepEqual(Object.values(copenhagen("2026-10-26T12:00:00Z")).map(iso), [
    "2026-10-25T23:00:00.000Z",
    "2026-09-30T22:00:00.000Z",
  ]);
  // Behind and far ahead of UTC, and on a half hour.
  assert.deepEqual(
    Object.values(
      localPeriods("America/Los_Angeles", new Date("2026-10-03T05:00:00Z")),
    ).map(iso),
    ["2026-10-02T07:00:00.000Z", "2026-10-01T07:00:00.000Z"],
  );
  assert.equal(
    iso(
      localPeriods("Pacific/Kiritimati", new Date("2026-10-03T12:00:00Z")).day,
    ),
    "2026-10-03T10:00:00.000Z",
  );
  assert.equal(
    iso(localPeriods("Asia/Kolkata", new Date("2026-10-03T12:00:00Z")).day),
    "2026-10-02T18:30:00.000Z",
  );
});

test("The owner has higher caps, and an account's own values replace either", () => {
  assert.deepEqual(capsWith(false, []), DEFAULT_CAPS);
  assert.deepEqual(capsWith(true, []), OWNER_CAPS);
  for (const key of Object.keys(DEFAULT_CAPS) as (keyof typeof OWNER_CAPS)[])
    assert.ok(OWNER_CAPS[key] > DEFAULT_CAPS[key], key);
  assert.deepEqual(
    capsWith(true, [
      { key: "spend-day-usd", value: 2 },
      { key: "coach-messages-day", value: 0 },
      // Unknown, or not a usable number: ignored.
      { key: "spend-year-usd", value: 1 },
      { key: "spend-month-usd", value: -1 },
      { key: "voice-minutes-day", value: Number.NaN },
    ]),
    {
      ...OWNER_CAPS,
      "spend-day-usd": 2,
      "coach-messages-day": 0,
    },
  );
});

test("A limit is reached at its cap, counting the messages before this one", () => {
  const usage = {
    "coach-messages-day": 149,
    "spend-day-usd": 0.99,
    "spend-month-usd": 15,
    "spend-turn-usd": 0.25,
    "voice-minutes-day": 59.5,
  };
  assert.deepEqual(
    reachedLimits(usage, DEFAULT_CAPS, [
      "coach-messages-day",
      "spend-day-usd",
      "spend-month-usd",
    ]),
    ["spend-month-usd"],
  );
  assert.deepEqual(
    reachedLimits({ ...usage, "coach-messages-day": 150 }, DEFAULT_CAPS, [
      "coach-messages-day",
      "spend-turn-usd",
      "voice-minutes-day",
    ]),
    ["coach-messages-day", "spend-turn-usd"],
  );
});

test("Limits only log unless they are set to enforce", () => {
  const saved = process.env.LIMITS_MODE;
  try {
    delete process.env.LIMITS_MODE;
    assert.equal(limitsMode(), "log");
    for (const value of ["", "log", "off", "Enforce", "true"]) {
      process.env.LIMITS_MODE = value;
      assert.equal(limitsMode(), "log", value);
    }
    process.env.LIMITS_MODE = " enforce ";
    assert.equal(limitsMode(), "enforce");
  } finally {
    if (saved === undefined) delete process.env.LIMITS_MODE;
    else process.env.LIMITS_MODE = saved;
  }
});

test("The athlete's limit texts point to manual logging and have no em dashes", () => {
  for (const [limit, text] of Object.entries(LIMIT_REPLIES)) {
    assert.doesNotMatch(text, /\u2014/, limit);
    if (limit !== "spend-turn-usd" && limit !== "voice-minutes-day")
      assert.match(text, /Logging in Train and Food still works\./, limit);
  }
  assert.match(LIMIT_REPLIES["coach-messages-day"], /resets at midnight/);
  assert.match(LIMIT_REPLIES["voice-minutes-day"], /resets at midnight/);
});

// Every file under a folder, for the checks below.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.tsx?$/.test(name)
        ? [path]
        : [];
  });
}

test("Only Coach messages and voice calls can meet a limit; Train, Food, Health and the outbox never do", () => {
  const using = (pattern: RegExp, dir: string) =>
    files(dir)
      .filter((path) => pattern.test(readFileSync(path, "utf8")))
      .sort();
  // The routes that start a Coach turn or a voice call are the only ones
  // that reach the limit checks.
  assert.deepEqual(using(/from "[^"]*usage-limits"|\brunTurn\b/, "app"), [
    "app/api/agent/route.ts",
    "app/api/agent/run/route.ts",
    "app/api/voice/session/route.ts",
  ]);
  assert.deepEqual(using(/from "[^"]*usage-limits"/, "lib"), [
    "lib/agent/engine.ts",
  ]);
  assert.deepEqual(using(/\brunTurn\(/, "lib"), ["lib/agent/engine.ts"]);
});
