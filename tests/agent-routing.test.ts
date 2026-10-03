import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COACH_MODELS,
  ROUTE_REASONS,
  policyFromJev,
  routeCoachTurn,
  rulesRoute,
  routingMode,
} from "../lib/agent/routing";
import { allowed } from "../lib/tracing/attributes";

const previous = {
  AGENT_ROUTING: process.env.AGENT_ROUTING,
  AGENT_PROVIDER: process.env.AGENT_PROVIDER,
  AGENT_MODEL: process.env.AGENT_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
};
test.after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

function openRouter() {
  process.env.AGENT_PROVIDER = "openrouter";
  process.env.AGENT_MODEL = COACH_MODELS.luna;
  process.env.OPENROUTER_API_KEY = "test-openrouter";
}

test("rules send routine logs to Luna and programme work to Terra", () => {
  assert.equal(
    rulesRoute({ message: "I slept 7 hours last night", photoCount: 0 }).tier,
    "luna",
  );
  assert.equal(
    rulesRoute({
      message: "Design next week's lifting programme",
      photoCount: 0,
    }).tier,
    "terra",
  );
  assert.equal(
    rulesRoute({
      message:
        "Jeg spiste suppe til frokost, og design også næste uges løfteprogram",
      photoCount: 0,
    }).tier,
    "terra",
  );
});

test("Jev high-stakes synthesis selects Astra and uncertainty stays on Terra", () => {
  const choice = (name: string, probability: number, confidence = 0.9) => ({
    type: "choice" as const,
    choice: name,
    confidence,
    probabilities: {
      log: name === "log" ? probability : 0.02,
      correct: name === "correct" ? probability : 0.02,
      explain: name === "explain" ? probability : 0.02,
      plan: name === "plan" ? probability : 0.02,
      mixed_or_unclear: name === "mixed_or_unclear" ? probability : 0.02,
    },
  });
  assert.equal(
    policyFromJev({
      model: "jev-1.13.0",
      answers: {
        work_kind: choice("plan", 0.9),
        difficulty: {
          type: "score",
          score: 2,
          confidence: 0.9,
          probabilities: { "0": 0.05, "1": 0.2, "2": 0.75 },
        },
        mutation_stakes: { type: "noul", noul: 0.92 },
      },
    }).tier,
    "astra",
  );
  assert.equal(
    policyFromJev({
      model: "jev-1.13.0",
      answers: {
        work_kind: choice("mixed_or_unclear", 0.88),
        difficulty: {
          type: "score",
          score: 0.2,
          confidence: 0.4,
          probabilities: { "0": 0.8, "1": 0.15, "2": 0.05 },
        },
        mutation_stakes: { type: "noul", noul: 0.1 },
      },
    }).tier,
    "terra",
  );
  assert.equal(
    policyFromJev({
      model: "jev-1.13.0",
      answers: {
        work_kind: choice("log", 0.94),
        difficulty: {
          type: "score",
          score: 0.1,
          confidence: 0.95,
          probabilities: { "0": 0.9, "1": 0.08, "2": 0.02 },
        },
        mutation_stakes: { type: "noul", noul: 0.04 },
      },
    }).tier,
    "luna",
  );
});

test("Jev failures fall back to rules and never send an arbitrary model id", async () => {
  openRouter();
  process.env.AGENT_ROUTING = "jev";
  process.env.TYPESAFE_API_KEY = "test-typesafe";
  const routed = await routeCoachTurn(
    {
      message: "Design a four-day snatch programme",
      photoCount: 0,
      activeWorkout: false,
    },
    async () => {
      throw Error("offline");
    },
  );
  assert.equal(routed.source, "fallback");
  assert.equal(routed.tier, "terra");
  assert.equal(routed.model, COACH_MODELS.terra);
  process.env.AGENT_ROUTING = "off";
  const off = await routeCoachTurn({
    message: "Design a four-day snatch programme",
    photoCount: 0,
    activeWorkout: false,
  });
  assert.equal(off.source, "off");
  assert.equal(off.model, COACH_MODELS.luna);
  assert.equal(routingMode(), "off");
});

test("a successful Jev decision is used once as a server-owned tier", async () => {
  openRouter();
  process.env.AGENT_ROUTING = "jev";
  process.env.TYPESAFE_API_KEY = "test-typesafe";
  let calls = 0;
  const routed = await routeCoachTurn(
    {
      message: "I ate eggs",
      photoCount: 0,
      activeWorkout: false,
    },
    async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "jev-1.13.0");
      assert.equal(body.state.latest_message, "I ate eggs");
      assert.equal("journal" in body.state, false);
      return Response.json({
        model: "jev-1.13.0",
        answers: {
          work_kind: {
            type: "choice",
            choice: "log",
            confidence: 0.96,
            probabilities: {
              log: 0.9,
              correct: 0.02,
              explain: 0.04,
              plan: 0.02,
              mixed_or_unclear: 0.02,
            },
          },
          difficulty: {
            type: "score",
            score: 0.1,
            confidence: 0.94,
            probabilities: { "0": 0.92, "1": 0.06, "2": 0.02 },
          },
          mutation_stakes: { type: "noul", noul: 0.03 },
        },
      });
    },
  );
  assert.equal(calls, 1);
  assert.equal(routed.source, "jev");
  assert.equal(routed.model, COACH_MODELS.luna);
  assert.equal(routed.reason, "log");
});

test("every route reason can be traced, and nothing else", () => {
  for (const reason of ROUTE_REASONS)
    assert.deepEqual(
      allowed({ "lift.route_reason": reason }),
      { kept: { "lift.route_reason": reason }, dropped: 0 },
      reason,
    );
  for (const value of ["Lookup", "lookup; drop", "How much water?", 1])
    assert.deepEqual(allowed({ "lift.route_reason": value }), {
      kept: {},
      dropped: 1,
    });
});

// Jev's recorded answers (3 October 2026 probe) for messages Coach receives.
function recorded(
  choice: string,
  kinds: [
    log: number,
    correct: number,
    explain: number,
    plan: number,
    mixed: number,
  ],
  score: number,
  difficulty: [number, number, number],
  noul: number,
) {
  const [log, correct, explain, plan, mixed_or_unclear] = kinds;
  return {
    model: "jev-1.13.0",
    answers: {
      work_kind: {
        type: "choice",
        choice,
        confidence: 0.5,
        probabilities: { log, correct, explain, plan, mixed_or_unclear },
      },
      difficulty: {
        type: "score",
        score,
        confidence: 0.9,
        probabilities: {
          "0": difficulty[0],
          "1": difficulty[1],
          "2": difficulty[2],
        },
      },
      mutation_stakes: { type: "noul", noul },
    },
  };
}

test("lookups Jev splits between log and explain go to Luna; other uncertainty stays on Terra", () => {
  const cases: [string, ReturnType<typeof recorded>, string, string][] = [
    // Plain questions about the athlete's own records.
    [
      "How much water have I had today?",
      recorded(
        "explain",
        [0.42, 0, 0.56, 0, 0.02],
        0.02,
        [0.98, 0.02, 0],
        0.34,
      ),
      "luna",
      "lookup",
    ],
    [
      "How did I sleep last night?",
      recorded("log", [0.56, 0, 0.43, 0, 0.01], 0.07, [0.93, 0.07, 0], 0.39),
      "luna",
      "lookup",
    ],
    [
      "Hvad var min hvilepuls i nat?",
      recorded(
        "explain",
        [0.42, 0, 0.57, 0, 0.01],
        0.01,
        [0.99, 0.01, 0],
        0.34,
      ),
      "luna",
      "lookup",
    ],
    [
      "When did I last do back squats?",
      recorded("log", [0.67, 0, 0.32, 0, 0.01], 0.04, [0.96, 0.04, 0], 0.3),
      "luna",
      "lookup",
    ],
    [
      "How much did I weigh on Monday?",
      recorded(
        "explain",
        [0.41, 0.01, 0.51, 0, 0.07],
        0.01,
        [0.99, 0.01, 0],
        0.32,
      ),
      "luna",
      "lookup",
    ],
    [
      "What did I lift on clean and jerk last week?",
      recorded("log", [0.82, 0.01, 0.16, 0, 0.01], 0.02, [0.98, 0.02, 0], 0.38),
      "luna",
      "lookup",
    ],
    // A report with a judgment question in it.
    [
      "Slept 5 hours. Should I skip training today?",
      recorded("log", [0.51, 0, 0.42, 0, 0.07], 0.77, [0.23, 0.77, 0], 0.38),
      "terra",
      "uncertain",
    ],
    // Follow-ups that need the conversation.
    [
      "and yesterday?",
      recorded("log", [0.43, 0.01, 0.28, 0, 0.28], 0.19, [0.81, 0.19, 0], 0.42),
      "terra",
      "uncertain",
    ],
    [
      "why?",
      recorded("explain", [0, 0, 0.7, 0, 0.3], 0.27, [0.74, 0.26, 0], 0.47),
      "terra",
      "uncertain",
    ],
    // Accepted: Jev sees only the latest message, so a short follow-up with
    // its mass on log and explain goes to Luna (both recorded runs), and Luna
    // relies on the conversation history for what it refers to.
    [
      "Og min puls?",
      recorded(
        "explain",
        [0.28, 0, 0.67, 0, 0.04],
        0.07,
        [0.93, 0.07, 0],
        0.34,
      ),
      "luna",
      "lookup",
    ],
    // Acceptances, confirmations, thanks and mixed requests.
    [
      "Okay, det lyder godt",
      recorded(
        "mixed_or_unclear",
        [0, 0, 0.01, 0, 0.99],
        0.1,
        [0.9, 0.1, 0],
        0.41,
      ),
      "terra",
      "uncertain",
    ],
    [
      "Thanks, that is all",
      recorded(
        "mixed_or_unclear",
        [0, 0, 0.01, 0, 0.99],
        0.02,
        [0.98, 0.02, 0],
        0.39,
      ),
      "terra",
      "uncertain",
    ],
    [
      "go ahead and save it",
      recorded(
        "mixed_or_unclear",
        [0.09, 0.04, 0.01, 0.01, 0.85],
        0.05,
        [0.96, 0.04, 0],
        0.34,
      ),
      "terra",
      "uncertain",
    ],
    [
      "Log 2 eggs and toast, and tell me whether I should deload this week",
      recorded(
        "mixed_or_unclear",
        [0.09, 0, 0, 0, 0.91],
        0.92,
        [0.08, 0.92, 0],
        0.51,
      ),
      "terra",
      "uncertain",
    ],
    // An uncertain plan edit.
    [
      "Move Thursday's session to Friday and make it lighter",
      recorded("plan", [0, 0.39, 0, 0.6, 0.01], 0.95, [0.05, 0.95, 0], 0.42),
      "terra",
      "uncertain",
    ],
    // Unchanged: confident logs and explanations.
    [
      "My knee hurts after squats. Should I still train today?",
      recorded("explain", [0.06, 0, 0.94, 0, 0], 0.84, [0.16, 0.84, 0], 0.34),
      "luna",
      "explain",
    ],
  ];
  for (const [message, answer, tier, reason] of cases)
    assert.deepEqual(policyFromJev(answer), { tier, reason }, message);
});

test("a lookup-shaped split still goes to Terra on any sign of judgment or stakes", () => {
  const lookup = (
    score: number,
    difficulty: [number, number, number],
    noul: number,
    kinds: [number, number, number, number, number] = [0.42, 0, 0.56, 0, 0.02],
  ) => policyFromJev(recorded("explain", kinds, score, difficulty, noul)).tier;
  assert.equal(lookup(0.02, [0.98, 0.02, 0], 0.34), "luna");
  assert.equal(lookup(0.3, [0.7, 0.3, 0], 0.34), "terra");
  assert.equal(lookup(0.1, [0.9, 0.05, 0.05], 0.34), "terra");
  assert.equal(lookup(0.02, [0.98, 0.02, 0], 0.85), "terra");
  assert.equal(lookup(1.4, [0, 0.6, 0.4], 0.9), "terra");
  assert.equal(lookup(1.8, [0, 0.2, 0.8], 0.9), "terra");
  // Less than 0.9 of the mass on log and explain.
  assert.equal(
    lookup(0.02, [0.98, 0.02, 0], 0.34, [0.36, 0.06, 0.5, 0, 0.08]),
    "terra",
  );
  // A correction Jev isn't sure of is never a lookup.
  assert.equal(
    policyFromJev(
      recorded("correct", [0.3, 0.6, 0.1, 0, 0], 0.1, [0.9, 0.1, 0], 0.3),
    ).tier,
    "terra",
  );
});

test("recorded answers pin the lookup thresholds from both sides", () => {
  // 0.88 on log and explain, just below 0.9: stays on Terra, so the mass
  // threshold can't drop to 0.88. (Jev's other answer for this message put
  // 0.90 there and went to Luna.)
  assert.deepEqual(
    policyFromJev(
      recorded("log", [0.56, 0.08, 0.32, 0, 0.04], 0.02, [0.98, 0.02, 0], 0.33),
    ),
    { tier: "terra", reason: "uncertain" },
    "Har jeg allerede logget det her måltid?",
  );
  // A lookup at difficulty 0.15, the highest among the 214 recorded
  // decisions the rule matched: goes to Luna, so the 0.30 score threshold
  // can't drop to 0.15.
  assert.deepEqual(
    policyFromJev(
      recorded("explain", [0.45, 0, 0.54, 0, 0.01], 0.15, [0.85, 0.15, 0], 0.4),
    ),
    { tier: "luna", reason: "lookup" },
    "Hvordan sov jeg i nat?",
  );
});
