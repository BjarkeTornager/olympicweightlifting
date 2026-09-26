// End-to-end Coach evals. Offline tooling, never imported by the app.
import type { JournalState } from "../../lib/model";

export type Coach = "voice" | "text";
export type Turn = { role: "athlete" | "coach"; text: string };
export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  // What the action returned to the coach, for graders to compare against.
  result?: unknown;
  // Index of the athlete turn this call followed (0 = before any reply).
  afterTurn: number;
};

// One run of a scenario: the conversation, what the coach did, and the
// journal before and after.
export type Trial = {
  scenario: string;
  coach: Coach;
  transcript: Turn[];
  calls: ToolCall[];
  before: JournalState;
  after: JournalState;
  // Milliseconds from an athlete turn to the coach's first audio (voice).
  latencies: number[];
  endedAt?: number;
  error?: string;
};

export type Check = {
  name: string;
  // outcome: the saved journal; procedure: how the coach got there;
  // judge: a model-graded yes/no question about the conversation.
  kind: "outcome" | "procedure" | "judge";
  pass: boolean;
  detail?: string;
};

export type Scenario = {
  id: string;
  title: string;
  coach: Coach;
  // regression: behaviour that broke before and must stay fixed.
  // capability: behaviour the coach should reach; may fail today.
  type: "regression" | "capability";
  purpose?: "checkin" | "goals";
  seed?: (state: JournalState, today: string) => void;
  // Earlier conversations to remember, as [athlete, coach] pairs.
  memory?: [string, string][];
  // Scripted athlete turns, or a simulated athlete with a goal.
  athlete: string[] | { goal: string; maxTurns: number };
  checks: (trial: Trial, today: string) => Check[];
  judge?: string[];
};

export const check = (
  name: string,
  kind: Check["kind"],
  pass: boolean,
  detail?: string,
): Check => ({ name, kind, pass, ...(pass || !detail ? {} : { detail }) });

export const called = (t: Trial, name: string) =>
  t.calls.filter((c) => c.name === name && c.ok);

export const coachText = (t: Trial) =>
  t.transcript
    .filter((l) => l.role === "coach")
    .map((l) => l.text)
    .join("\n");

// Sets saved for a date, as [weight, reps, made] per set, in order.
export function setsOn(state: JournalState, date: string, exercise?: string) {
  return state.sessions
    .filter((s) => s.date === date)
    .flatMap((s) => s.exercises)
    .filter((e) => !exercise || e.exerciseId === exercise)
    .flatMap((e) =>
      e.sets
        .filter((x) => x.logged || x.result)
        .map((x) => [Number(x.weight), Number(x.reps), x.result !== "miss"]),
    );
}
