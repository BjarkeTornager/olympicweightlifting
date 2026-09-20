import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COACH_MODELS,
  policyFromJev,
  routeCoachTurn,
  rulesRoute,
  routingMode,
} from "../lib/agent/routing";

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
});
