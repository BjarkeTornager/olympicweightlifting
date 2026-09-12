"""Prepare public evaluation clips outside the repo using the production decoder.

Usage: VIDEO_PYTHON_PATH=... FFMPEG_PATH=... FFPROBE_PATH=... python prepare.py /private/tmp/benchmark
Downloaded public source files must already be in ROOT/sources/{YouTube ID}.mp4.
This script never downloads media, calls a model, or connects to a database.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[3]
ROOT = Path(sys.argv[1]).resolve()
if ROOT == REPO or REPO in ROOT.parents:
    raise SystemExit("Evaluation media must be outside the repository")
manifest = json.loads((Path(__file__).with_name("cases.json")).read_text())
ffmpeg = os.environ.get("FFMPEG_PATH", "ffmpeg")
python = os.environ.get("VIDEO_PYTHON_PATH", sys.executable)
ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
for case in manifest["cases"]:
    work = ROOT / case["id"]
    work.mkdir(exist_ok=True, mode=0o700)
    filters = [f"trim=start={case['start']}:end={case['end']}", "setpts=PTS-STARTPTS"]
    if "crop" in case:
        x, y, w, h = case["crop"]
        filters.append(f"crop={w}:{h}:{x}:{y}")
    if "mask" in case:
        x, y, w, h = case["mask"]
        filters.append(f"drawbox=x={x}:y={y}:w={w}:h={h}:color=black:t=fill")
    subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-i", str(ROOT / "sources" / (case["source"] + ".mp4")),
                    "-map", "0:v:0", "-vf", ",".join(filters), "-an", "-sn", "-dn", "-map_metadata", "-1",
                    "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                    "-fps_mode", "passthrough", "-f", "mp4", "-y", str(work / "source")], check=True, timeout=120)
    spec = {"id": "00000000-0000-4000-8000-000000000001", "lift": "Identify from video", "date": manifest["date"],
            "load": "", "mode": "automatic", "start": 0, "end": 120}
    (work / "input.json").write_text(json.dumps(spec))
    # Only local decoder configuration reaches the media subprocess.
    safe_env = {k: os.environ[k] for k in ["PATH", "FFMPEG_PATH", "FFPROBE_PATH", "VIDEO_POSE_MODEL_PATH"] if k in os.environ}
    safe_env.update({"MPLCONFIGDIR": str(work), "PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "2"})
    subprocess.run([python, str(REPO / "scripts/video/analyse.py"), str(work)], env=safe_env, check=True, timeout=240,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    digest = hashlib.sha256((work / "media.mp4").read_bytes()).hexdigest()
    (work / "provenance.json").write_text(json.dumps({"case": case["id"], "source": case["source"], "start": case["start"],
                                                     "end": case["end"], "sha256": digest, "audioRemoved": True}, indent=2))
    result = json.loads((work / "result.json").read_text())["analysis"]
    frames = result.get("pose", {}).get("frames", [])
    print(json.dumps({"case": case["id"], "duration": result["duration"], "frames": result["frameCount"],
                      "poseSamples": len(frames), "poseWithPoints": sum(bool(f["points"]) for f in frames)}), flush=True)
