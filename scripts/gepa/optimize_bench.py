"""GEPA on one Coach tool description, scored on the hard Coach benchmark.

Runs the real TypeScript engine through bench-runner.ts on disposable test
accounts. GEPA sees train feedback and selects on validation; held-out
scenarios run after the choice is locked. Nothing is promoted or deployed.
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


def examples(ids):
    return [dict(scenario=s, language=lang) for s in ids for lang in ("en", "da")]


OBJECTIVE = ("Improve the description of a fitness journal coach's direct-logging tool so the model saves exactly what "
    "the athlete reports or asks to correct (right values, dates, units, no duplicate or dropped sets, nothing saved for "
    "previews, hypotheticals, third parties or questions), answers separate questions in the same reply, and uses as few "
    "model rounds as possible: every round is another full model call.")
BACKGROUND = ("This is the description of the log_entry tool; its JSON parameters, the other tools and a long system prompt "
    "are fixed. The prompt already covers health, privacy, untrusted content and 'one change per reply'; do not repeat "
    "those. The model receives a message with everything recorded today, with ids, which counts as read: today's check-in, "
    "activities, meals and sessions need no extra read before a save, but changing an existing meal needs food_journal, "
    "workout changes need current_workout, and other dates need their journal read. Keep every tool name, action kind and "
    "argument name exactly as the current description uses them; do not invent any. Keep it general: never mention "
    "specific test messages, numbers, foods or exercises from the examples. At most the current length (hard limit 1.25x); "
    "shorter is better when nothing is lost. Output only the description text.")


class Bridge:
    def __init__(self, directory, max_usd, tool):
        self.process = subprocess.Popen(["node", "--import", "tsx", "scripts/gepa/bench-runner.ts"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
            env={**os.environ, "GEPA_RUN_DIR": str(directory), "GEPA_MAX_COST_USD": str(max_usd), "GEPA_TOOL": tool})
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
    parser.add_argument("--max-usd", type=float, default=4)
    parser.add_argument("--tool", default="log_entry")
    args = parser.parse_args()
    directory = Path(args.run_dir).resolve()
    if not directory.name.startswith("lift-gepa-") or str(directory).startswith(os.getcwd()):
        raise ValueError("Use a new lift-gepa-* directory outside the repository.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    if not 0 < args.max_usd <= 10:
        raise ValueError("The cap is at most $10.")
    bridge = Bridge(directory, args.max_usd, args.tool)

    def save(name, value):
        (directory / name).write_text(json.dumps(value, indent=2) + "\n")

    def evaluate_one(label, candidate, example):
        result = bridge.call("evaluate", candidate=candidate, example=example)
        print(f"{label} {example['scenario']}-{example['language']}: {result['score']:.2f} rounds={result['rounds']}"
              + ("" if result["passed"] else f" FAIL {[f for t in result['turns'] for f in t['failures']][:2]}"), flush=True)
        return dict(label=label, **result)

    try:
        info = bridge.call("info")
        baseline = info["baseline"]
        splits = info["splits"]
        save("manifest.json", dict({k: v for k, v in info.items() if k != "baseline"}, gepa="0.1.4", seed=17,
            sources={name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in [
                "scripts/gepa/bench-runner.ts", "scripts/gepa/optimize_bench.py", "scripts/coach-bench/scenarios.ts",
                "scripts/coach-bench/runner.ts", "lib/agent/tools.ts", "lib/agent/knowledge.ts", "lib/agent/engine.ts"]}))
        (directory / "baseline.txt").write_text(baseline + "\n")

        def evaluator(candidate, example):
            result = evaluate_one("search", candidate, example)
            return result["score"], dict(scenario=example, passed=result["passed"], rounds=result["rounds"],
                turns=result["turns"])

        def reflect(messages):
            if isinstance(messages, str):
                messages = [{"role": "user", "content": messages}]
            return bridge.call("reflect", messages=messages)

        result = optimize_anything(seed_candidate=baseline, evaluator=evaluator,
            dataset=examples(splits["train"]), valset=examples(splits["validation"]),
            objective=OBJECTIVE, background=BACKGROUND,
            config=GEPAConfig(
                engine=EngineConfig(run_dir=str(directory / "search"), seed=17, max_metric_calls=120,
                    max_candidate_proposals=6, parallel=True, max_workers=3, use_cloudpickle=False,
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

        # Held-out, after the choice is locked: both texts, twice, shuffled.
        work = [(repeat, label, e) for repeat in range(2) for e in examples(splits["heldout"])
                for label in ("baseline", "candidate")]
        random.Random(1701).shuffle(work)

        def run(item):
            repeat, label, example = item
            return dict(repeat=repeat, **evaluate_one(f"heldout-{label}", baseline if label == "baseline" else candidate, example))

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            records = list(executor.map(run, work))
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
            print("Spent (USD, conservative):", final["spent"], flush=True)
        finally:
            bridge.close()


if __name__ == "__main__":
    main()
