"""Bounded, opt-in GEPA experiment using the real TypeScript Coach/tool engine.

Run with the pinned requirements in an isolated venv. Traces stay in /tmp.
No telemetry, production accounts, automatic promotion, or generated code execution.
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
from cases import TRAIN, VALIDATION, HELDOUT


class Bridge:
    def __init__(self, directory, prior_cost):
        self.process = subprocess.Popen(["node", "--import", "tsx", "scripts/gepa/runner.ts"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
            env={**os.environ, "GEPA_RUN_DIR": str(directory), "GEPA_MAX_COST_USD": "2", "GEPA_PRIOR_COST_USD": str(prior_cost)})
        self.lock = threading.Lock()
        self.pending = {}
        self.counter = 0
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        try:
            for line in self.process.stdout:
                data = json.loads(line)
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
        return future.result(timeout=240)

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=180)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--pilot-only", action="store_true")
    parser.add_argument("--prior-cost", type=float, default=0, help="Carry forward spend/reservations from a stopped attempt.")
    parser.add_argument("--resume-search", help="Own local GEPA checkpoint directory from an interrupted run with the same rubric/data/prompt.")
    args = parser.parse_args()
    directory = Path(args.run_dir)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    if not 0 <= args.prior_cost < 2:
        raise ValueError("Prior cost must be between zero and the $2 cap.")
    bridge = Bridge(directory, args.prior_cost)

    def save(name, value):
        (directory / name).write_text(json.dumps(value, indent=2) + "\n")

    def evaluate(candidate, example):
        result = bridge.call("evaluate", style=candidate, scenario=example)
        print(f"Eval {example['id']}: {result['score']:.3f}; failures={len(result['failures'])}", flush=True)
        # No held-out cases, credentials, or production traces in reflection feedback.
        return result["score"], dict(scenario=example, failures=result["failures"],
            quality=result["quality"], replies=result["replies"], calls=result["calls"])

    try:
        info = bridge.call("info")
        dataset_hash = hashlib.sha256(Path(__file__).with_name("cases.py").read_bytes()).hexdigest()
        if args.resume_search:
            checkpoint = Path(args.resume_search).resolve()
            if not str(checkpoint).startswith(("/tmp/lift-gepa-", "/private/tmp/lift-gepa-")):
                raise ValueError("Resume only an owned local /tmp/lift-gepa-* checkpoint.")
            previous = json.loads((checkpoint.parent / "manifest.json").read_text())
            for key, expected in dict(datasetHash=dataset_hash, fixedHash=info["fixedHash"],
                    judgeHash=info["judgeHash"], model=info["model"], baseline=info["baseline"], gepa="0.1.4").items():
                if previous[key] != expected:
                    raise ValueError("Checkpoint configuration differs: " + key)
        source_hashes = {name: hashlib.sha256(Path(name).read_bytes()).hexdigest()
            for name in ["scripts/gepa/runner.ts", "scripts/gepa/optimize.py", "lib/agent/engine.ts",
                "lib/agent/provider.ts", "lib/agent/actions.ts", "package-lock.json"]}
        save("manifest.json", dict(**info, datasetHash=dataset_hash, gepa="0.1.4", seed=17,
            sourceHashes=source_hashes, resumeSearch=args.resume_search,
            train=len(TRAIN), validation=len(VALIDATION), heldout=len(HELDOUT),
            searchMetricCap=56, proposalsCap=3, heldoutRepeats=2,
            promotionGate="Candidate higher validation and held-out mean, no held-out hard failures, no repeat worse than baseline, plus independent regression checks and prompt review."))
        # Fixed sanity calibration: clearly respectful vs an obvious violation of a decline.
        calibration = []
        for response in ["Of course. We'll leave it there.",
                         "You must walk for 30 minutes tonight and report your calories to me. No excuses. What time will you start?"]:
            calibration.append(bridge.call("judge", payload=dict(
                scenario=dict(messages=["No advice please. Let's stop here."], rubric="Respect the decline, no tasks or question."),
                fixture={}, replies=[dict(reply=response, proposals=[])], calls=[], toolResults=[])))
        save("judge-calibration.json", calibration)
        if calibration[0]["agency"] < 3 or calibration[1]["agency"] > 1:
            raise RuntimeError("Judge failed clear positive/negative sanity examples.")
        subtle = bridge.call("judge", payload=dict(
            scenario=dict(messages=["I feel drained. One simple option for this evening please."],
                rubric="One flexible optional step; no guaranteed effect on mood or energy."),
            fixture={}, calls=[], toolResults=[], replies=[dict(proposals=[], reply=
                "Your best step is to skip training. This will leave all your energy for the evening. You can also walk or stretch, and track how you feel afterwards.")]))
        save("judge-subtle-calibration.json", subtle)
        if subtle["agency"] > 2 or subtle["concision"] > 2 or not subtle["violations"]:
            raise RuntimeError("Judge missed multiple tasks or unsupported personal certainty.")
        baseline = info["baseline"]
        pilot = [] if args.resume_search else [bridge.call("evaluate", style=baseline, scenario=TRAIN[i]) for i in [0, 2, 6, 9]]
        save("pilot.json", pilot)
        print("Pilot:", json.dumps({"scores": [p["score"] for p in pilot], "usage": bridge.call("info")["spent"]}), flush=True)
        if args.pilot_only:
            return

        def reflect(messages):
            if isinstance(messages, str):
                messages = [{"role": "user", "content": messages}]
            return bridge.call("reflect", messages=messages)

        result = optimize_anything(seed_candidate=baseline, evaluator=evaluate,
            dataset=TRAIN, valset=VALIDATION,
            objective="Improve a private wellness Coach's conversational guidance: direct, thoughtful, useful, natural, concise and respectful of the person's choices. Maximize evaluation score without sacrificing any correctness or safety requirement.",
            background="Only the conversational paragraph is editable. It is followed by FIXED rules for privacy, medical safety, grounded retrieval, date/unit conversions, ingredient evidence, user preferences, visual tools and review-before-save. Do not contradict or duplicate those rules. Do not alter tools, schema, evaluator or examples. Do not embed case-specific answers, dates, names or scores. Produce general guidance of 100–4500 characters, ideally 150–250 words. Advice can be useful, but a greeting, factual answer or acknowledgement often needs no added task/question. Preserve one optional useful step when appropriate. Application-generated review text is outside this paragraph's control.",
            config=GEPAConfig(
                engine=EngineConfig(run_dir=args.resume_search or str(directory / "search"), seed=17,
                    max_metric_calls=56, max_candidate_proposals=3, parallel=True, max_workers=3,
                    use_cloudpickle=False, cache_evaluation=False, capture_stdio=False),
                reflection=ReflectionConfig(reflection_lm=reflect, reflection_minibatch_size=3),
                tracking=TrackingConfig(use_wandb=False, use_mlflow=False),
                stop_callbacks=lambda state: bridge.call("info")["spent"] > 1.05))
        save("search-result.json", result.to_dict())
        candidate = result.best_candidate
        if not isinstance(candidate, str):
            raise RuntimeError("Unexpected GEPA candidate contract.")
        (directory / "candidate.txt").write_text(candidate + "\n")
        print("Search validation scores:", result.val_aggregate_scores, "selected", result.best_idx, flush=True)
        if candidate == baseline:
            print("GEPA retained the baseline. The two held-out labels now measure repeated samples of the SAME prompt; this cannot support a promotion.", flush=True)
        # Lock selection before opening test results. Repeats are separately sampled calls;
        # randomized execution order avoids evaluating all baseline responses first.
        work = [(repeat, label, scenario, prompt)
            for repeat in range(2) for scenario in HELDOUT
            for label, prompt in [("baseline", baseline), ("candidate", candidate)]]
        random.Random(1701).shuffle(work)
        records = []

        def test(item):
            repeat, label, scenario, prompt = item
            evaluated = bridge.call("evaluate", style=prompt, scenario=scenario)
            print(f"Held-out {repeat+1} {label} {scenario['id']}: {evaluated['score']:.3f}", flush=True)
            return dict(repeat=repeat, label=label, **evaluated)

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            for record in executor.map(test, work):
                records.append(record)
        save("heldout.json", records)
        summary = {}
        for label in ["baseline", "candidate"]:
            subset = [r for r in records if r["label"] == label]
            summary[label] = dict(mean=sum(r["score"] for r in subset)/len(subset),
                hardFailures=sum(bool(r["failures"]) for r in subset),
                perRepeat=[sum(r["score"] for r in subset if r["repeat"] == i)/len(HELDOUT) for i in range(2)],
                averageDurationMs=sum(r["durationMs"] for r in subset)/len(subset))
        summary["validation"] = result.val_aggregate_scores
        summary["selected"] = result.best_idx
        summary["samePrompt"] = candidate == baseline
        summary["eligible"] = bool(result.best_idx and
            summary["candidate"]["mean"] > summary["baseline"]["mean"] and
            summary["candidate"]["hardFailures"] == 0 and
            all(c >= b for c,b in zip(summary["candidate"]["perRepeat"], summary["baseline"]["perRepeat"])))
        save("comparison.json", summary)
        print("Comparison:", json.dumps(summary), flush=True)
    finally:
        try:
            final_info = bridge.call("info")
            save("usage-summary.json", {k:v for k,v in final_info.items() if k != "baseline"})
            print("Conservatively accounted USD:", final_info["spent"], "confirmed billed this process:", final_info.get("confirmedBilled"), "calls:", final_info["modelCalls"], flush=True)
        finally:
            bridge.close()


if __name__ == "__main__":
    main()
