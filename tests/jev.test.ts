import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtures, validateFixtures } from "../scripts/jev/fixtures";
import {
  Budget,
  evaluateJev,
  MODEL,
  parseResponse,
  predictionsFrom,
  requestFor,
  summarize,
  type ResponseData,
  type ResultRow,
} from "../scripts/jev/core";

const fixture = fixtures[0];
function response(): ResponseData {
  const questions = requestFor(fixture).questions;
  return {
    model: MODEL,
    answers: Object.fromEntries(
      Object.entries(questions).map(([id, q]) => [
        id,
        q.type === "noul"
          ? { type: "noul" as const, noul: 0.9 }
          : {
              type: "choice" as const,
              choice: "report",
              confidence: 0.3,
              probabilities: Object.fromEntries(
                Object.keys(q.criteria).map((k) => [
                  k,
                  k === "report" ? 0.88 : 0.02,
                ]),
              ),
            },
      ]),
    ),
    usage: { input_tokens: 1000, output_tokens: 100 },
  };
}

test("synthetic fixtures preserve families across splits and exclude labels from API payloads", () => {
  validateFixtures(fixtures);
  assert.equal(fixtures.filter((f) => f.suite === "intent").length, 100);
  assert.equal(fixtures.filter((f) => f.suite === "reply").length, 32);
  assert.equal(new Set(fixtures.map((f) => f.family)).size, 58);
  for (const f of fixtures) {
    const request = requestFor(f);
    assert.deepEqual(Object.keys(request).sort(), [
      "model",
      "questions",
      "state",
    ]);
    assert.equal("expected" in request.state, false);
    assert.deepEqual(
      Object.keys(request.questions).sort(),
      Object.keys(f.expected).sort(),
    );
  }
  assert.throws(
    () =>
      validateFixtures([
        ...fixtures,
        { ...fixture, id: "leak", split: "heldout" },
      ]),
    /Split leakage/,
  );
});

test("Jev response validation rejects invalid probabilities, missing answers, wrong models and arbitrary options", () => {
  const q = requestFor(fixture).questions;
  assert.equal(parseResponse(response(), q).model, MODEL);
  for (const mutate of [
    (r: ResponseData) => {
      delete r.answers.preview_requested;
    },
    (r: ResponseData) => {
      r.answers.preview_requested = { type: "noul", noul: 1.5 };
    },
    (r: ResponseData) => {
      if (r.answers.intent.type === "choice")
        r.answers.intent.choice = "execute_sql";
    },
    (r: ResponseData) => {
      if (r.answers.intent.type === "choice")
        r.answers.intent.probabilities.report = 0.3;
    },
    (r: ResponseData) => {
      if (r.answers.intent.type === "choice") r.answers.intent.choice = "plan";
    },
    (r: ResponseData) => {
      r.usage.input_tokens = NaN;
    },
  ]) {
    const r = response();
    mutate(r);
    assert.throws(() => parseResponse(r, q));
  }
  assert.throws(() => parseResponse({ ...response(), model: "jev-latest" }, q));
  const predictions = predictionsFrom(response());
  assert.equal(predictions.intent.probability, 0.88);
  assert.equal(predictions.intent.confidence, 0.3);
});

test("two-decimal probability rounding is accepted without renormalizing or accepting invalid mass", () => {
  const questions = requestFor(fixture).questions;
  for (const main of [0.87, 0.89]) {
    const raw = response();
    if (raw.answers.intent.type !== "choice") throw Error("Expected choice");
    raw.answers.intent.probabilities.report = main;
    const parsed = parseResponse(raw, questions);
    assert.equal(predictionsFrom(parsed).intent.probability, main);
  }
  for (const main of [0.78, 0.8799]) {
    const raw = response();
    if (raw.answers.intent.type !== "choice") throw Error("Expected choice");
    raw.answers.intent.probabilities.report = main;
    assert.throws(() => parseResponse(raw, questions), /distribution/);
  }
});

test("budget stops before dispatch and retains uncertain request costs without retries or secret leakage", async () => {
  let calls = 0;
  const tooSmall = new Budget(0.001);
  const transport: typeof fetch = async () => {
    calls++;
    return Response.json(response());
  };
  await assert.rejects(
    () => evaluateJev(fixture, "test-key", tooSmall, transport),
    /before dispatch/,
  );
  assert.equal(calls, 0);
  const budget = new Budget();
  await assert.rejects(
    () =>
      evaluateJev(fixture, "test-key", budget, async () => {
        calls++;
        throw Error("secret-token-and-request-data");
      }),
    /details withheld/,
  );
  assert.equal(calls, 1);
  assert.equal(budget.accountedUsd, budget.reservation);
  assert.equal(budget.usageEstimatedUsd, 0);
  await assert.rejects(
    () =>
      evaluateJev(
        fixture,
        "test-key",
        new Budget(),
        async () => new Response("secret-token", { status: 401 }),
      ),
    /^Error: Jev returned HTTP 401/,
  );
});

test("live transport pins destination, blocks redirects and accounts valid token usage", async () => {
  const budget = new Budget();
  const result = await evaluateJev(
    fixture,
    "test-key",
    budget,
    async (url, options) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.method, "POST");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, MODEL);
      assert.equal("expected" in body, false);
      return Response.json(response());
    },
  );
  assert.equal(result.usage.input_tokens, 1000);
  assert.ok(Math.abs(budget.accountedUsd - 0.000042) < 1e-12);
  assert.equal(budget.usageEstimatedUsd, 0.000042);
  assert.equal(budget.requests, 1);
});

test("malformed or oversized responses retain reservations and cannot become successful results", async () => {
  for (const transport of [
    async () => Response.json({ ...response(), usage: {} }),
    async () => new Response("x".repeat(128001)),
    async () => new Response("not json"),
  ]) {
    const budget = new Budget();
    await assert.rejects(() =>
      evaluateJev(fixture, "test-key", budget, transport),
    );
    assert.equal(budget.usageEstimatedUsd, 0);
    assert.equal(budget.accountedUsd, budget.reservation);
  }
});

test("metrics distinguish abstention, dangerous false positives, class errors and probability calibration", () => {
  const rows: ResultRow[] = [
    {
      id: "a",
      family: "a",
      split: "heldout",
      language: "en",
      suite: "intent",
      latencyMs: 10,
      expected: {
        intent: "question",
        personal_event_reported: false,
        whole_workout_finished: false,
      },
      predictions: {
        intent: { label: "report", probability: 0.7 },
        personal_event_reported: { label: true, probability: 0.9 },
        whole_workout_finished: { label: true, probability: 0.6 },
      },
    },
    {
      id: "b",
      family: "b",
      split: "heldout",
      language: "da",
      suite: "intent",
      latencyMs: 30,
      expected: {
        intent: "mixed_or_unclear",
        personal_event_reported: true,
        whole_workout_finished: true,
      },
      predictions: {
        intent: { label: "mixed_or_unclear", probability: 0.99 },
        personal_event_reported: { label: true, probability: 0.95 },
        whole_workout_finished: { label: true, probability: 0.95 },
      },
    },
  ];
  const s = summarize(rows);
  assert.equal(s.accuracy, 0.5);
  assert.equal(s.exactCaseAccuracy, 0.5);
  assert.equal(s.fields.personal_event_reported.classes.true.precision, 0.5);
  assert.equal(s.fields.personal_event_reported.classes.true.recall, 1);
  assert.equal(s.coverage, 0.5);
  assert.equal(s.acceptedAccuracy, 2 / 3);
  assert.equal(s.confidentFalseEvent.count, 1);
  assert.equal(s.confidentFalseFinish.count, 0);
  assert.equal(s.fields.whole_workout_finished.falsePositive, 1);
  assert.ok(
    Math.abs(s.fields.personal_event_reported.brier! - 0.40625) < 1e-12,
  );
  assert.equal(s.latencyMs.p95, 30);
  assert.equal(s.failures.length, 3);
  assert.equal(summarize([]).accuracy, null);
});
