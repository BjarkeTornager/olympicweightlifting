"""Dense evidence around detected lift phases, using saved normalized media."""
import json
import os
import sys
import cv2
from analyse import probe, make_sheets
from pose import PoseTracker

root = sys.argv[1]
with open(os.path.join(root, "input.json")) as f:
    spec = json.load(f)
path = os.path.join(root, "media.mp4")
times = [float(f["best_effort_timestamp_time"]) for f in probe(path, True)["frames"]]
start, end = spec["start"], spec["end"]
available = [i for i, t in enumerate(times) if start <= t <= end + .001]
if len(available) < 2:
    raise ValueError("No complete evidence window")
picks = set()


def pick(time):
    if len(picks) < 48:
        picks.add(min(available, key=lambda i: abs(times[i] - time)))


# Keep complete-attempt context and exact phase centres, then add 12 fps
# neighbourhoods. These are observed decoded frames, never interpolated images.
for time in spec["phases"]:
    pick(time)
for i in range(12):
    pick(start + (end - start) * i / 11)
for offset in [-1/12, 1/12, -2/12, 2/12, -3/12, 3/12]:
    for time in spec["phases"]:
        pick(time + offset)
for i in range(48):
    pick(start + (end - start) * i / 47)
picks = sorted(picks)
while len(picks) < 48:
    picks.append(picks[-1])
picks.sort()
cap = cv2.VideoCapture(path)
samples = {}
tracker = PoseTracker(interval=.099)
for i, t in enumerate(times):
    ok, frame = cap.read()
    if not ok:
        raise ValueError("Could not decode evidence")
    if i in picks:
        samples[t] = frame.copy()
        h, w = frame.shape[:2]
    if start <= t <= end:
        # Follow continuity between evidence frames, and also evaluate the exact
        # frames used by the recommendations instead of reusing older landmarks.
        tracker.add(frame, t, force=i in picks)
    if i >= picks[-1]:
        break
cap.release()
tracker.close()
frames = make_sheets(samples, times, picks, w, h)
with open(os.path.join(root, "result.json"), "w") as f:
    # Only the inspected frame positions are needed by the evidence overlay.
    pose = tracker.result()
    pose['frames'] = [f for f in pose['frames'] if any(abs(f['t']-times[i]) < .00001 for i in picks)]
    json.dump({"sampleTimes": [times[i] for i in picks], "frames": frames, "pose": pose}, f, allow_nan=False)
