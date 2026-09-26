// Runs one typed Coach conversation through the real engine and provider on a
// test account, recording every tool call the model makes.
import { runTurn } from "../../lib/agent/engine";
import { readJournal } from "../../lib/server";
import type { Scenario, ToolCall, Trial, Turn } from "./core";
import { simulateAthlete } from "./models";

export async function runText(
  scenario: Scenario,
  userId: string,
  timezone: string,
): Promise<Omit<Trial, "before" | "after">> {
  const transcript: Turn[] = [];
  const calls: ToolCall[] = [];
  let athleteTurns = 0;
  let error: string | undefined;
  const scripted = Array.isArray(scenario.athlete)
    ? [...scenario.athlete]
    : null;
  try {
    while (true) {
      const line = scripted
        ? scripted.shift()
        : athleteTurns < (scenario.athlete as { maxTurns: number }).maxTurns
          ? await simulateAthlete(
              (scenario.athlete as { goal: string }).goal,
              transcript,
            )
          : null;
      if (!line) break;
      athleteTurns++;
      transcript.push({ role: "athlete", text: line });
      const { revision } = await readJournal(userId);
      const response = await runTurn(
        userId,
        {
          id: crypto.randomUUID(),
          message: line,
          revision,
          timezone,
        },
        undefined,
        {
          directLogging: true,
          liftingBriefReview: true,
          onToolCall: (name, args, ok) =>
            calls.push({
              name,
              args: args as Record<string, unknown>,
              ok,
              afterTurn: athleteTurns,
            }),
        },
      );
      const saved = (response.proposals ?? [])
        .filter((p) => p.status === "saved")
        .map((p) => `[saved: ${p.title}]`);
      transcript.push({
        role: "coach",
        text: [response.reply, ...saved].filter(Boolean).join("\n"),
      });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return {
    scenario: scenario.id,
    coach: "text",
    transcript,
    calls,
    latencies: [],
    ...(error ? { error } : {}),
  };
}
