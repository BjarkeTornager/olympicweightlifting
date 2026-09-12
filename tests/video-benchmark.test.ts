import { test } from "node:test";
import assert from "node:assert/strict";
import {
  committed,
  reserve,
  settle,
  type Charge,
} from "../scripts/video/benchmark/budget";

test("benchmark preserves unknown charges and cannot spend the same reservation twice", () => {
  const charges: Charge[] = [];
  reserve(charges, "timeout", 4, 10);
  assert.throws(() => settle(charges, "timeout", undefined), /unavailable/);
  assert.equal(committed(charges), 4);
  assert.throws(() => reserve(charges, "timeout", 4, 10), /already/);
  assert.throws(() => reserve(charges, "another", 6, 10), /budget/);
  reserve(charges, "known", 2, 10);
  settle(charges, "known", 0.15);
  assert.equal(committed(charges), 4.15);
});

test("benchmark rejects budget increases and invalid usage while recording excess billing", () => {
  const charges: Charge[] = [];
  assert.throws(() => reserve(charges, "x", 1, 11), /US\$10/);
  assert.throws(() => reserve(charges, "x", NaN, 10), /budget/);
  reserve(charges, "x", 1, 10);
  assert.throws(() => settle(charges, "x", -1), /unavailable/);
  assert.throws(() => settle(charges, "x", 1.2), /exceeded/);
  assert.equal(committed(charges), 1.2);
  assert.throws(() => settle(charges, "x", 0), /settlement/);
});
