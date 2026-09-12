"""Compare the production seeded plate tracker with OpenCV CSRT on public clips.

Both receive the same manually selected plate. Coverage is NOT accuracy. Saves
replay overlays and point arrays for visual annotation; no physical speed claims.
Usage: FFMPEG_PATH=... FFPROBE_PATH=... python tracking.py /private/tmp/benchmark
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import cv2

cv2.setNumThreads(2)
ROOT = Path(sys.argv[1]).resolve()
REPO = Path(__file__).resolve().parents[3]
if ROOT == REPO or REPO in ROOT.parents:
    raise SystemExit("Keep media outside the repository")
SEEDS = {"clip-01": (.37, .802, .086), "clip-02": (.291, .678, .23), "clip-03": (.803, .757, .25)}
summary = []
for case, (x, y, diameter) in SEEDS.items():
    work = ROOT / "tracking" / case
    work.mkdir(parents=True, exist_ok=True)
    source = ROOT / case / "media.mp4"
    shutil.copyfile(source, work / "source")
    a = json.loads((ROOT / case / "result.json").read_text())["analysis"]
    settings = {"start": 0, "end": a["duration"], "lift": "Identify from video", "load": "", "date": "2026-09-12",
                "calibration": {"x": x, "y": y, "diameterPixelsRatio": diameter,
                                "diameterCm": 45, "sideView": True, "realTime": False}}
    # The production interface needs physical calibration. Its values are placeholders
    # for this pixel-only tracking test and must never appear as measurements in reports.
    (work / "input.json").write_text(json.dumps(settings))
    env = {k: os.environ[k] for k in ["PATH", "FFMPEG_PATH", "FFPROBE_PATH"] if k in os.environ}
    subprocess.run([sys.executable, str(REPO / "scripts/video/analyse.py"), str(work)], env=env, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    baseline = json.loads((work / "result.json").read_text())["analysis"]["tracking"]
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    ok, first = cap.read()
    if not ok:
        raise RuntimeError("Could not read clip")
    h, w = first.shape[:2]
    radius = round(diameter * w * .55)
    box = (round(x*w)-radius, round(y*h)-radius, radius*2+1, radius*2+1)
    tracker = cv2.TrackerCSRT_create()
    tracker.init(first, box)
    csrt = [{"t": 0, "x": x, "y": y}]
    i = 0
    writer = cv2.VideoWriter(str(work / "comparison.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    frame, alive = first, True
    while True:
        t = i / fps
        if i:
            alive, box = tracker.update(frame) if alive else (False, box)
            if alive:
                bx, by, bw, bh = box
                csrt.append({"t": t, "x": (bx+bw/2)/w, "y": (by+bh/2)/h})
        base = min(baseline["points"], key=lambda p: abs(p["t"]-t), default=None)
        if base and abs(base["t"]-t) < .025:
            cv2.circle(frame, (round(base["x"]*w), round(base["y"]*h)), 9, (0,200,255), 2)
        if alive:
            p = csrt[-1]
            cv2.drawMarker(frame, (round(p["x"]*w),round(p["y"]*h)), (60,220,60), cv2.MARKER_CROSS, 20, 2)
        cv2.putText(frame, "Yellow: current | Green: CSRT | unverified pixel tracks", (8,25), cv2.FONT_HERSHEY_SIMPLEX, .48, (255,255,255), 1)
        writer.write(frame)
        i += 1
        ok, frame = cap.read()
        if not ok:
            break
    cap.release()
    writer.release()
    # Retain only normalized coordinates, not the placeholder physical measurements.
    data = {"case": case, "seed": {"x": x, "y": y, "diameterRatio": diameter},
            "current": baseline["points"], "csrt": csrt, "frameCount": i,
            "currentCoverage": len(baseline["points"])/i, "csrtCoverage": len(csrt)/i,
            "accuracy": "not yet scored against independent point annotations"}
    (work / "tracks.json").write_text(json.dumps(data))
    (work / "result.json").unlink()
    row = {k:v for k,v in data.items() if k not in ["current", "csrt"]}
    summary.append(row)
    print(json.dumps(row), flush=True)
(ROOT / "tracking" / "summary.json").write_text(json.dumps(summary, indent=2))
