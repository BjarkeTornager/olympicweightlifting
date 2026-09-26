"use client";
import { useState } from "react";
import { today } from "@/lib/domain";
import { formatSleepDuration } from "@/lib/health";
import { weeklyReview } from "@/lib/weekly-review";
import type { JournalController } from "./journal";
import { TrackingStatus } from "./tracking-status";
import { NextSession } from "./next-session";
import { CheckinDialog, DailyOverview } from "./health";
import { Button } from "./ui/button";
import { Plus, ChevronRight, Mic } from "./ui/icons";
import { useVoiceEnabled } from "@/lib/use-voice-checkin";
import { BarbellIcon, BowlIcon, SleepIcon } from "./ui/journal-icons";

export function Today({
  journal,
  go,
  onAsk,
}: {
  journal: JournalController;
  go: (route: string) => void;
  onAsk: (question: string) => void;
}) {
  const state = journal.state!,
    date = today();
  const [checkinOpen, setCheckinOpen] = useState(false);
  const voiceEnabled = useVoiceEnabled(journal.identity?.id);
  const meals = state.nutrition.meals.filter((m) => m.date === date);
  const sleep = state.health.checkins.find((c) => c.date === date);
  const week = weeklyReview(state, date).current;
  const kcal = meals.reduce(
    (total, meal) =>
      total +
      meal.items.reduce((sum, item) => sum + Number(item.calories || 0), 0),
    0,
  );
  return (
    <div className="today-page">
      <div className="page-heading compact">
        <div>
          <h1>Today</h1>
        </div>
      </div>
      <div className="today-capture">
        <Button onClick={() => go("coach/capture")}>
          <Plus size={20} weight="bold" /> Log something
        </Button>
        {voiceEnabled && (
          <Button variant="secondary" onClick={() => go("coach/voice")}>
            <Mic size={20} /> Check in by voice
          </Button>
        )}
      </div>
      <NextSession state={state} update={journal.update} go={go} />
      <section
        className="today-records list-card"
        aria-label="Today's food and sleep"
      >
        <button className="list-row today-record" onClick={() => go("food")}>
          <BowlIcon size={22} />
          <span>
            <strong>Food</strong>
            <small>
              {meals.length
                ? `${meals.length} ${meals.length === 1 ? "meal" : "meals"} recorded${state.nutrition.completeDays?.includes(date) ? ", day complete" : ""}`
                : "Add what you remember"}
            </small>
          </span>
          <span className="today-record-value">
            {meals.length ? (
              <>
                {Math.round(kcal).toLocaleString("en-GB")} <small>kcal</small>
              </>
            ) : (
              <small>Nothing recorded yet</small>
            )}
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
        <button
          className="list-row today-record"
          onClick={() =>
            go(sleep?.sleepHours == null ? "coach/sleep" : "health")
          }
        >
          <SleepIcon size={22} />
          <span>
            <strong>Sleep</strong>
            <small>
              {sleep?.sleepImport
                ? "From Apple Health"
                : sleep?.sleepHours != null
                  ? "Your reported sleep"
                  : "Connect Apple Health or log sleep"}
            </small>
          </span>
          <span className="today-record-value">
            {sleep?.sleepHours == null ? (
              <small>Not recorded</small>
            ) : (
              formatSleepDuration(sleep.sleepHours)
            )}
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </section>
      <TrackingStatus accountId={journal.identity.id} go={go} />
      <section className="today-week" aria-label="This week at a glance">
        <div className="today-week-heading">
          <h2>Your last seven days</h2>
          <Button variant="ghost" onClick={() => go("journal/week")}>
            Review my week
          </Button>
        </div>
        <ol className="week-strip">
          {week.days.map((d) => {
            const day = new Date(`${d.date}T12:00:00`);
            const trained = d.strength.length + d.cardio.length > 0;
            const slept = d.checkin?.sleepHours ?? null;
            const ate = d.meals.length > 0;
            return (
              <li key={d.date} data-today={d.date === date || undefined}>
                <span className="week-strip-day" aria-hidden="true">
                  {day.toLocaleDateString("en-GB", { weekday: "narrow" })}
                </span>
                <span
                  className="week-strip-mark"
                  data-on={trained || undefined}
                  aria-hidden="true"
                >
                  <BarbellIcon size={18} active={trained} />
                </span>
                <span className="week-strip-sleep" aria-hidden="true">
                  {slept == null ? "–" : slept.toFixed(1)}
                </span>
                <span
                  className="week-strip-food"
                  data-on={ate || undefined}
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {day.toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                  : {trained ? "trained" : "no training recorded"},{" "}
                  {slept == null
                    ? "sleep not recorded"
                    : `${formatSleepDuration(slept)} sleep`}
                  , {ate ? "food logged" : "no food logged"}.
                </span>
              </li>
            );
          })}
        </ol>
        <p className="week-strip-key" aria-hidden="true">
          <span>
            <BarbellIcon size={14} active /> trained
          </span>
          <span>7.4 = hours slept</span>
          <span>
            <i className="week-strip-food" data-on /> food logged
          </span>
        </p>
      </section>
      <details className="today-extra">
        <summary>More from your journal</summary>
        <DailyOverview
          journal={journal}
          busy={false}
          go={go}
          onCheckin={() => setCheckinOpen(true)}
          onAsk={onAsk}
          onMemories={(plans) => go(plans ? "coach/plans" : "coach/memories")}
        />
      </details>
      <CheckinDialog
        journal={journal}
        date={checkinOpen ? date : null}
        onClose={() => setCheckinOpen(false)}
      />
    </div>
  );
}
