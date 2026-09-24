import { test } from "node:test";
import assert from "node:assert/strict";
import { errorCategory, logFailure } from "../lib/error-log";
import { ProviderError } from "../lib/agent/provider";
import { GET as health } from "../app/api/health/route";

test("failures are categorised without their messages", () => {
  assert.equal(
    errorCategory(new ProviderError("x", 402)),
    "provider_budget_exhausted",
  );
  assert.equal(
    errorCategory(new ProviderError("x", 429)),
    "provider_rate_limited",
  );
  assert.equal(
    errorCategory(new ProviderError("x", 503)),
    "provider_unavailable",
  );
  assert.equal(errorCategory(new ProviderError("x", 400)), "provider_400");
  assert.equal(errorCategory(new DOMException("t", "TimeoutError")), "timeout");
  const disk = Object.assign(new Error("could not extend file"), {
    code: "53100",
  });
  assert.equal(errorCategory(disk), "database_53100");
  const refused = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
  assert.equal(errorCategory(refused), "network_econnrefused");
  assert.equal(errorCategory(new TypeError("fetch failed")), "network");
  assert.equal(
    errorCategory(new RangeError("private meal name")),
    "RangeError",
  );
  assert.equal(errorCategory("string thrown"), "unknown");
});

test("a logged failure carries an incident ID and no error message", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: string) => lines.push(line);
  try {
    const incident = logFailure(
      "journal_save_failed",
      new Error("Salmon dinner"),
      {
        video: "abc",
      },
    );
    assert.match(incident, /^[0-9a-f]{8}$/);
    const entry = JSON.parse(lines[0]);
    assert.deepEqual(entry, {
      event: "journal_save_failed",
      category: "Error",
      incident,
      video: "abc",
    });
    assert.doesNotMatch(lines[0], /Salmon/);
  } finally {
    console.error = original;
  }
});

test("health reports the deployed commit when Railway provides one", async () => {
  const saved = process.env.RAILWAY_GIT_COMMIT_SHA;
  try {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    assert.equal((await (await health()).json()).commit, null);
    process.env.RAILWAY_GIT_COMMIT_SHA = "3dd528651ea2b3c4";
    assert.equal((await (await health()).json()).commit, "3dd5286");
  } finally {
    if (saved === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
    else process.env.RAILWAY_GIT_COMMIT_SHA = saved;
  }
});
