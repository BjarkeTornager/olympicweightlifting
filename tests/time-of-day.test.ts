import { test } from "node:test";
import assert from "node:assert/strict";
import { localClock, partOfDay } from "../lib/agent/time-context";
import { requestTime } from "../lib/agent/knowledge";
import { voiceContext, voiceInstruction } from "../lib/voice-checkin";
import { emptyJournal } from "../lib/domain";

test("the part of the day follows the local clock", () => {
  assert.deepEqual(
    [
      "04:59",
      "05:00",
      "11:59",
      "12:00",
      "12:20",
      "17:59",
      "18:00",
      "22:59",
      "23:00",
    ].map((t) => partOfDay(t).name),
    [
      "night",
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
      "night",
    ],
  );
});

test("both coaches are told it's afternoon at 12:20, not left to guess", () => {
  // 10:20 UTC is 12:20 in Copenhagen in summer time.
  const clock = localClock("2026-09-27T10:20:00Z", "Europe/Copenhagen");
  assert.equal(clock.time, "12:20");
  const voice = voiceInstruction(
    voiceContext(emptyJournal(), clock.date),
    clock,
  );
  assert.match(
    voice,
    /12:20 on 2026-09-27 \(Europe\/Copenhagen\), the afternoon/,
  );
  assert.match(voice, /say "Good afternoon"/);
  assert.doesNotMatch(voice, /end-of-day/);
  const text = requestTime(clock.date, clock.timezone, clock.time);
  assert.match(
    text,
    /12:20 \(24-hour clock\), the afternoon; if you greet by time of day, say "Good afternoon"/,
  );
});
