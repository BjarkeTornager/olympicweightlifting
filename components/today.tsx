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
import { Plus, Moon, Utensils, ArrowRight, ChevronRight } from "./ui/icons";
import { AreaIcon } from "./ui/area-icon";

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
          <p className="lead">Log, train, or check in.</p>
        </div>
      </div>
      <div className="today-capture">
        <Button onClick={() => go("coach/capture")}>
          <Plus size={20} weight="bold" /> Log something
        </Button>
        <span>A photo, a sentence, or your usual meal.</span>
      </div>
      <NextSession state={state} update={journal.update} go={go} />
      <section className="today-records" aria-label="Today's food and sleep">
        <button
          className="area-tile"
          data-area="food"
          onClick={() => go("food")}
        >
          <span className="area-tile-heading">
            <AreaIcon area="food" icon={Utensils} size="sm" />
            <span>Food</span>
            <ChevronRight size={16} aria-hidden="true" />
          </span>
          <strong>
            {meals.length ? (
              <>
                {Math.round(kcal).toLocaleString("en-GB")} <small>kcal</small>
              </>
            ) : (
              "Nothing recorded yet"
            )}
          </strong>
          <small>
            {meals.length
              ? `${meals.length} ${meals.length === 1 ? "meal" : "meals"} recorded${state.nutrition.completeDays?.includes(date) ? " · day complete" : ""}`
              : "Add what you remember"}
          </small>
        </button>
        <button
          className="area-tile"
          data-area="sleep"
          onClick={() =>
            go(sleep?.sleepHours == null ? "coach/sleep" : "health")
          }
        >
          <span className="area-tile-heading">
            <AreaIcon area="sleep" icon={Moon} size="sm" />
            <span>Sleep</span>
            <ChevronRight size={16} aria-hidden="true" />
          </span>
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
        <div className="today-week-heading">
          <h2>Your last seven days</h2>
          <Button variant="ghost" onClick={() => go("journal/week")}>
            Review my week <ArrowRight size={17} />
          </Button>
        </div>
        <dl className="today-week-stats">
          <div data-area="train">
            <dt>Sessions</dt>
            <dd>{week.strengthSessions + week.cardioSessions}</dd>
          </div>
          <div data-area="sleep">
            <dt>Nights</dt>
            <dd>
              {week.sleepNights}
              <small>/7</small>
            </dd>
          </div>
          <div data-area="food">
            <dt>Food days</dt>
            <dd>
              {week.foodLoggedDays}
              <small>/7</small>
            </dd>
          </div>
        </dl>
        <p className="fine-print">
          Missing entries stay unknown. Your review shows the records behind
          each comparison.
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
