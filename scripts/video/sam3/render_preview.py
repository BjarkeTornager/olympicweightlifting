"""Render observed SAM masks for manual QA; coverage is not accuracy.

python render_preview.py --video PUBLIC.mp4 --result RESULT.json --output CONTACT.png
Keep copyrighted benchmark footage and derived previews outside the repository.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def main():
    import cv2
    import numpy as np
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = json.loads(Path(args.result).read_text())
    segmentation = result["segmentation"]
    if hashlib.sha256(Path(args.video).read_bytes()).hexdigest() != segmentation["sourceSha256"]:
        raise ValueError("Result belongs to different media")
    frames = segmentation["frames"]
    if not frames:
        raise ValueError("No observed frames")
    raw = subprocess.run([os.environ.get("FFPROBE_PATH", "ffprobe"), "-v", "error",
                          "-select_streams", "v:0", "-show_frames", "-show_entries",
                          "frame=best_effort_timestamp_time", "-of", "json", args.video],
                         capture_output=True, check=True, timeout=45)
    pts = [float(f["best_effort_timestamp_time"]) for f in json.loads(raw.stdout)["frames"]]
    chosen = [frames[round(i*(len(frames)-1)/8)] for i in range(9)]
    indices = [min(range(len(pts)), key=lambda i: abs(pts[i]-f["t"])) for f in chosen]
    if any(abs(pts[i]-f["t"]) > .002 for i, f in zip(indices, chosen)):
        raise ValueError("Masks do not match actual video timestamps")
    capture = cv2.VideoCapture(args.video)
    images = {}
    try:
        for i in range(max(indices)+1):
            ok, frame = capture.read()
            if not ok:
                raise ValueError("Video decode failed")
            if i in indices:
                images[i] = frame
    finally:
        capture.release()
    tiles = []
    for index, item in zip(indices, chosen):
        frame = images[index].copy()
        height, width = frame.shape[:2]
        for obj in item["objects"]:
            color = (110, 212, 245) if obj["kind"] == "person" else (230, 218, 80)
            polygon = np.rint(np.asarray(obj["polygon"])*[width, height]).astype(np.int32)
            cv2.polylines(frame, [polygon], True, color, 3, cv2.LINE_AA)
        scale = min(480/width, 380/height)
        resized = cv2.resize(frame, (round(width*scale), round(height*scale)))
        tile = np.full((resized.shape[0]+45, 480, 3), 24, dtype=np.uint8)
        left = (480-resized.shape[1])//2
        tile[35:35+resized.shape[0], left:left+resized.shape[1]] = resized
        label = f"{item['t']:.3f}s | "+", ".join(o["kind"] for o in item["objects"])
        cv2.putText(tile, label, (12, 25), cv2.FONT_HERSHEY_SIMPLEX, .5, (240,240,240), 1, cv2.LINE_AA)
        tiles.append(tile)
    sheet = np.vstack([np.hstack(tiles[i:i+3]) for i in range(0,9,3)])
    cv2.imwrite(args.output, sheet)
    print(json.dumps({"frames": len(frames), "status": segmentation["status"],
                      "personFrames": sum(any(o["kind"] == "person" for o in f["objects"]) for f in frames),
                      "plateFrames": sum(any(o["kind"] == "plate" for o in f["objects"]) for f in frames),
                      "metrics": result.get("metrics", {})}))


if __name__ == "__main__":
    main()
