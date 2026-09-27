"""GEPA on Coach's logging and tool-use rules, scored on saved journals.

Runs the real TypeScript engine through workflow-runner.ts on disposable test
accounts. Selection uses train/validation only; held-out scenarios are run
after the candidate is locked. Nothing is promoted or deployed from here.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import threading

from gepa.optimize_anything import optimize_anything, GEPAConfig, EngineConfig, ReflectionConfig, TrackingConfig

# Split by scenario, never by language, so a Danish copy of a training
# conversation can't leak into validation or held-out.
TRAIN = ["strength_correction", "checkin_preservation", "mixed_request", "missing_weight", "third_party"]
VALIDATION = ["strength_continuity", "preview_only", "declined_advice", "unknown_ingredients"]
HELDOUT = ["cardio_preservation", "missing_records", "untrusted_note", "bodyweight_report", "sleep_report", "walk_report"]


def examples(ids):
    return [dict(scenario=s, language=lang) for s in ids for lang in ("en", "da")]


OBJECTIVE = ("Improve the logging and tool-use rules of a fitness and nutrition journal coach so that it saves exactly "
    "what the athlete reports or asks to correct (right values and date, no duplicate or dropped sets, no lost fields, "
    "nothing saved for previews, third parties or plain questions), answers every separate question in the same reply, "
    "and needs as few model rounds as possible: every round is another full model call over a long prompt.")
BACKGROUND = ("The rules are one part of a longer system prompt; each line is one paragraph. Fixed rules elsewhere, which "
    "you cannot change and must not contradict or repeat, cover health and safety, privacy, untrusted content, evidence, "
    "and: 'You may make ONE change per reply, only when the latest user message requests it or reports an actual personal "
    "journal event.' The model already receives a message with everything recorded today, with ids, current as of the "
    "request, so today's records need no extra read unless it is about to change one. Keep every tool name, action kind "
    "and argument convention exactly as the current rules use them; do not invent tools. Keep rules general: never mention "
    "specific test messages, numbers, exercises or languages from the examples. At most the current length (a hard limit "
    "is 1.25x); shorter is better when nothing is lost. Output only the rules, one paragraph per line.")


class Bridge:
    def __init__(self, directory, max_usd):
        self.process = subprocess.Popen(["node", "--import", "tsx", "scripts/gepa/workflow-runner.ts"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
            env={**os.environ, "GEPA_RUN_DIR": str(directory), "GEPA_MAX_COST_USD": str(max_usd)})
        self.lock = threading.Lock()
        self.pending = {}
        self.counter = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.process.stdout:
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict) or "id" not in data:
                    continue
                with self.lock:
                    future = self.pending.pop(data["id"])
                if "error" in data:
                    future.set_exception(RuntimeError(data["error"]))
                else:
                    future.set_result(data["result"])
        finally:
            with self.lock:
                for future in self.pending.values():
                    future.set_exception(RuntimeError("Evaluation bridge exited unexpectedly."))
                self.pending.clear()

    def call(self, op, **payload):
        future = concurrent.futures.Future()
        with self.lock:
            self.counter += 1
            self.pending[self.counter] = future
            self.process.stdin.write(json.dumps(dict(id=self.counter, op=op, **payload)) + "\n")
            self.process.stdin.flush()
        return future.result(timeout=600)

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=300)


def summary(records):
    return dict(episodes=len(records), mean=sum(r["score"] for r in records) / len(records),
        passed=sum(r["passed"] for r in records), rounds=sum(r["rounds"] for r in records) / len(records),
        costUsd=sum(r["costUsd"] for r in records),
        failing=sorted({f"{r['scenario']}-{r['language']}" for r in records if not r["passed"]}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--max-usd", type=float, default=10)
    parser.add_argument("--baseline-only", action="store_true")
    # Measurement only (no search): score the current rules on held-out too,
    # several times, e.g. before and after a prompt or engine change.
    parser.add_argument("--include-heldout", action="store_true")
    parser.add_argument("--repeats", type=int, default=1)
    args = parser.parse_args()
    directory = Path(args.run_dir).resolve()
    if not directory.name.startswith("lift-gepa-") or str(directory).startswith(os.getcwd()):
        raise ValueError("Use a new lift-gepa-* directory outside the repository.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    if not 0 < args.max_usd <= 10:
        raise ValueError("The cap is at most $10.")
    if (args.include_heldout or args.repeats != 1) and not args.baseline_only:
        raise ValueError("--include-heldout and --repeats are for --baseline-only measurement runs.")
    if not 1 <= args.repeats <= 5:
        raise ValueError("Use 1 to 5 repeats.")
    bridge = Bridge(directory, args.max_usd)

    def save(name, value):
        (directory / name).write_text(json.dumps(value, indent=2) + "\n")

    def run_all(work, workers=3):
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            return list(executor.map(lambda item: item[0](*item[1:]), work))

    def evaluate_one(label, candidate, example):
        result = bridge.call("evaluate", candidate=candidate, example=example)
        print(f"{label} {example['scenario']}-{example['language']}: {result['score']:.2f} rounds={result['rounds']}"
              + ("" if result["passed"] else f" FAIL {[f for t in result['turns'] for f in t['failures']]}"), flush=True)
        return dict(label=label, **result)

    try:
        info = bridge.call("info")
        baseline = info["baseline"]
        save("manifest.json", dict({k: v for k, v in info.items() if k != "baseline"}, gepa="0.1.4", seed=17,
            train=TRAIN, validation=VALIDATION, heldout=HELDOUT,
            sources={name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in [
                "scripts/gepa/workflow-runner.ts", "scripts/gepa/optimize_workflow.py", "scripts/jev/workflow-fixtures.ts",
                "lib/agent/engine.ts", "lib/agent/knowledge.ts", "lib/agent/provider.ts"]}))
        (directory / "baseline.txt").write_text(baseline + "\n")

        # 1. Where the current rules stand, on the scenarios GEPA may see.
        measured = TRAIN + VALIDATION + (HELDOUT if args.include_heldout else [])
        base = run_all([(evaluate_one, "baseline", baseline, e)
                        for _ in range(args.repeats) for e in examples(measured)])
        save("baseline.json", base)
        print("Baseline:", json.dumps(summary(base)), "spent", bridge.call("info")["spent"], flush=True)
        if args.baseline_only:
            return

        # 2. Search, with feedback from train only and selection on validation.
        def evaluator(candidate, example):
            result = evaluate_one("search", candidate, example)
            return result["score"], dict(scenario=example, passed=result["passed"], rounds=result["rounds"],
                turns=[{k: t[k] for k in ("message", "reply", "saved", "tools", "rounds", "failures")} for t in result["turns"]])

        def reflect(messages):
            if isinstance(messages, str):
                messages = [{"role": "user", "content": messages}]
            return bridge.call("reflect", messages=messages)

        result = optimize_anything(seed_candidate=baseline, evaluator=evaluator,
            dataset=examples(TRAIN), valset=examples(VALIDATION), objective=OBJECTIVE, background=BACKGROUND,
            config=GEPAConfig(
                engine=EngineConfig(run_dir=str(directory / "search"), seed=17, max_metric_calls=150,
                    max_candidate_proposals=8, parallel=True, max_workers=3, use_cloudpickle=False,
                    cache_evaluation=False, capture_stdio=False),
                reflection=ReflectionConfig(reflection_lm=reflect, reflection_minibatch_size=3),
                tracking=TrackingConfig(use_wandb=False, use_mlflow=False),
                stop_callbacks=lambda state: bridge.call("info")["spent"] > args.max_usd * 0.65))
        save("search-result.json", result.to_dict())
        candidate = result.best_candidate
        if not isinstance(candidate, str):
            raise RuntimeError("Unexpected GEPA candidate contract.")
        (directory / "candidate.txt").write_text(candidate + "\n")
        print("Validation scores:", result.val_aggregate_scores, "selected", result.best_idx, flush=True)
        if candidate == baseline:
            print("GEPA kept the current rules; the held-out run only measures their variability.", flush=True)

        # 3. Held-out, after the choice is locked: both texts, twice, shuffled.
        work = [(repeat, label, e) for repeat in range(2) for e in examples(HELDOUT)
                for label in ("baseline", "candidate")]
        random.Random(1701).shuffle(work)
        records = run_all([(lambda r, l, e: dict(repeat=r, **evaluate_one(f"heldout-{l}", baseline if l == "baseline" else candidate, e)), r, l, e)
                           for r, l, e in work])
        save("heldout.json", records)
        comparison = {label: summary([r for r in records if r["label"] == f"heldout-{label}"]) for label in ("baseline", "candidate")}
        comparison.update(samePrompt=candidate == baseline, validation=result.val_aggregate_scores, selected=result.best_idx,
            candidateChars=len(candidate), baselineChars=len(baseline))
        comparison["eligibleForReview"] = bool(result.best_idx and not comparison["samePrompt"]
            and comparison["candidate"]["passed"] >= comparison["baseline"]["passed"]
            and comparison["candidate"]["mean"] > comparison["baseline"]["mean"])
        save("comparison.json", comparison)
        print("Comparison:", json.dumps(comparison), flush=True)
    finally:
        try:
            final = bridge.call("info")
            save("usage.json", {k: v for k, v in final.items() if k != "baseline"})
            print("Spent (USD, conservative):", final["spent"], "model calls:", final["modelCalls"],
                  "Jev calls:", final["jevCalls"], flush=True)
        finally:
            bridge.close()


if __name__ == "__main__":
    main()
