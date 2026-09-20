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
import { Plus, Moon, Utensils, ArrowRight } from "./ui/icons";

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
  const meals = state.nutrition.meals.filter((m) => m.date === date);
  const sleep = state.health.checkins.find((c) => c.date === date);
  const week = weeklyReview(state, date).current;
  return (
    <div className="today-page">
      <div className="page-heading compact">
        <div>
          <h1>Today</h1>
          <p className="lead">Log, train, or check in.</p>
        </div>
      </div>
      <div className="today-capture">
        <Button onClick={() => go("coach/capture")}>
          <Plus size={20} /> Log something
        </Button>
        <span>A photo, a sentence, or your usual meal.</span>
      </div>
      <NextSession state={state} update={journal.update} go={go} />
      <section className="today-records" aria-label="Today's food and sleep">
        <button onClick={() => go("food")}>
          <Utensils size={21} />
          <span>Food</span>
          <strong>
            {meals.length
              ? `${meals.length} ${meals.length === 1 ? "meal" : "meals"} recorded`
              : "Nothing recorded yet"}
          </strong>
          <small>
            {state.nutrition.completeDays?.includes(date)
              ? "Day marked complete"
              : "Add what you remember"}
          </small>
        </button>
        <button
          onClick={() =>
            go(sleep?.sleepHours == null ? "coach/sleep" : "health")
          }
        >
          <Moon size={21} />
          <span>Sleep</span>
          <strong>
            {sleep?.sleepHours == null
              ? "Not recorded"
              : formatSleepDuration(sleep.sleepHours)}
          </strong>
          <small>
            {sleep?.sleepImport
              ? "From Apple Health"
              : sleep?.sleepHours != null
                ? "Your reported sleep"
                : "Connect Apple Health or log sleep"}
          </small>
        </button>
      </section>
      <TrackingStatus accountId={journal.identity.id} go={go} />
      <section className="today-week" aria-label="This week at a glance">
        <div>
          <h2>Your last seven days</h2>
          <p>
            {week.strengthSessions + week.cardioSessions} recorded sessions ·{" "}
            {week.sleepNights}/7 nights · food on {week.foodLoggedDays}/7 days
          </p>
          <p className="fine-print">
            Missing entries stay unknown. Your review shows the records behind
            each comparison.
          </p>
        </div>
        <Button variant="ghost" onClick={() => go("journal/week")}>
          Review my week <ArrowRight size={17} />
        </Button>
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
