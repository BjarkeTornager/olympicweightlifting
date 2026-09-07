import { z } from "zod";
import type { JournalState } from "./model";
import { formatSleepDuration, offsetDate } from "./health";
import { cardioTitle } from "./cardio";

// Optional at the profile boundary: older journals retain their exact shape.
export const coachingSchema = z
  .object({
    initiative: z.enum(["gentle", "on-request"]),
    focus: z.string().trim().max(300),
  })
  .strict();

export type CoachSuggestion = {
  id: string;
  title: string;
  observation: string;
  invitation: string;
  prompt: string;
};

// A small, explainable opening observation. No model request, score, target or
// journal mutation happens on opening. Missing records never imply inactivity.
export function coachSuggestion(
  state: JournalState,
  date: string,
): CoachSuggestion {
  const checkin = state.health.checkins.find((c) => c.date === date);
  const recovery = [
    checkin?.energy != null && checkin.energy <= 2
      ? `energy at ${checkin.energy}/5`
      : "",
    checkin?.soreness != null && checkin.soreness >= 4
      ? `muscle soreness at ${checkin.soreness}/5`
      : "",
  ].filter(Boolean);
  if (recovery.length)
    return {
      id: "recovery",
      title: "There’s room to adjust today.",
      observation: `You logged ${recovery.join(" and ")} today.`,
      invitation:
        "We can think through an easier day or adapt your plans to how you feel now.",
      prompt: "What would you suggest for today, given how I'm feeling?",
    };

  const sleep = state.health.checkins.filter(
    (c) => c.sleepHours != null && c.date <= date,
  );
  const recent = sleep.filter((c) => c.date >= offsetDate(date, -2));
  const baseline = sleep.filter(
    (c) => c.date >= offsetDate(date, -9) && c.date < offsetDate(date, -2),
  );
  const average = (values: typeof sleep) =>
    values.reduce((sum, c) => sum + c.sleepHours!, 0) / values.length;
  if (
    recent.length === 3 &&
    baseline.length >= 4 &&
    average(baseline) - average(recent) >= 1
  )
    return {
      id: "sleep-change",
      title: "Your recent nights look different.",
      observation: `Your last three nights (${offsetDate(date, -2)}–${date}) average ${formatSleepDuration(average(recent))}, compared with ${formatSleepDuration(average(baseline))} across ${baseline.length} logged nights in the preceding week.`,
      invitation:
        "If you’ve felt the difference, we could choose one small change that fits your evenings.",
      prompt:
        "My recent sleep looks different. What would be one useful thing to try?",
    };

  const activity = [
    ...state.sessions.map((s) => ({ date: s.date, title: s.title })),
    ...state.cardio.sessions.map((s) => ({
      date: s.date,
      title: cardioTitle(s),
    })),
  ]
    .filter((s) => s.date >= offsetDate(date, -2) && s.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (activity)
    return {
      id: "training-follow-up",
      title: "Let’s build on your last session.",
      observation: `You recorded ${activity.title} ${activity.date === date ? "today" : `on ${activity.date}`}.`,
      invitation:
        "What felt good, and what would you change? That can help us shape your next session.",
      prompt:
        "Help me reflect on my latest recorded session and think about what comes next.",
    };

  const dinners = state.nutrition.meals.filter(
    (m) =>
      m.type === "dinner" && m.date >= offsetDate(date, -6) && m.date <= date,
  );
  if (dinners.length >= 2)
    return {
      id: "dinner-ideas",
      title: "Make the next dinner a little easier.",
      observation: `You have ${dinners.length} dinners in your journal from the last seven days.`,
      invitation:
        "We could pick something you enjoyed and use it as a starting point for another meal.",
      prompt:
        "Suggest one easy dinner based on meals I've logged in the last seven days.",
    };

  if (state.profile.coaching?.focus)
    return {
      id: "focus",
      title: "A small step toward what matters to you.",
      observation: `Your current focus: ${state.profile.coaching.focus}`,
      invitation: "Let’s find one realistic way to move that forward today.",
      prompt: "What's one realistic step toward my current focus?",
    };
  return {
    id: "get-to-know-you",
    title: "Let’s start with what matters to you",
    observation: "Training, food, sleep, or more energy for everyday life.",
    invitation: "Choose one thing we can work on together.",
    prompt: "Help me work out what I want from coaching.",
  };
}

export function coachingContext(state: JournalState, date: string) {
  const preferences = state.profile.coaching ?? {
    initiative: "gentle",
    focus: "",
  };
  const suggestion = coachSuggestion(state, date);
  return {
    preferences,
    // Keep user-supplied focus separate from instructions, and keep this small.
    startingPoint:
      preferences.initiative === "gentle"
        ? {
            observation: suggestion.observation,
            invitation: suggestion.invitation,
          }
        : null,
  };
}
