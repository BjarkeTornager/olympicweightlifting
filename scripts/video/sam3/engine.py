"""SAM 3.1 region evidence. Never interpret a mask centroid as a bar hub.

All frames are decoded from the sanitized MP4 into a temporary JPEG directory.
Frame-index outputs are mapped back to actual PTS, never an assumed FPS.
"""
import bisect
import hashlib
import json
import math
import statistics
from itertools import combinations
from pathlib import Path
import subprocess
import tempfile

REVISION = "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7"
CHECKPOINT_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
MAX_BYTES = 25 * 1024 * 1024


def load_predictor():
    """Shared by production and the isolated GPU check."""
    import os
    from huggingface_hub import hf_hub_download
    from sam3.model_builder import build_sam3_multiplex_video_predictor
    checkpoint = hf_hub_download("facebook/sam3.1", "sam3.1_multiplex.pt",
                                 revision=CHECKPOINT_REVISION, token=os.environ["HF_TOKEN"])
    predictor = build_sam3_multiplex_video_predictor(
        checkpoint_path=checkpoint, max_num_objects=8,
        use_fa3=False, use_rope_real=False, compile=False, async_loading_frames=False,
    )
    adapt_multiplex_state(predictor)
    return predictor


def adapt_multiplex_state(predictor):
    """Pinned SAM base dispatch passes a flag its multiplex model cannot accept.

    Preserve the model's normal GPU state behavior when the flag is false.
    Reject a request to offload state rather than silently claim support for it.
    Remove this adapter when the pinned upstream signatures are compatible.
    """
    import inspect
    original = predictor.model.init_state
    if "offload_state_to_cpu" in inspect.signature(original).parameters:
        return

    def init_state(*args, offload_state_to_cpu=False, **kwargs):
        if offload_state_to_cpu:
            raise ValueError("SAM 3.1 multiplex does not support state offloading")
        return original(*args, **kwargs)

    predictor.model.init_state = init_state


def validate_manifest(value):
    if not isinstance(value, dict) or set(value) != {
        "version", "sha256", "width", "height", "duration", "sampleTimes", "anchors"
    }:
        raise ValueError("Invalid manifest")
    if value["version"] != 1 or not isinstance(value["sha256"], str) or len(value["sha256"]) != 64:
        raise ValueError("Invalid manifest")
    for name in ["width", "height"]:
        if type(value[name]) is not int or not 1 <= value[name] <= 960:
            raise ValueError("Invalid dimensions")
    if not finite(value["duration"]) or not .1 <= value["duration"] <= 120.2:
        raise ValueError("Invalid duration")
    times = value["sampleTimes"]
    if not isinstance(times, list) or not 1 <= len(times) <= 48:
        raise ValueError("Invalid samples")
    if any(not finite(t) or not 0 <= t <= value["duration"] + .05 for t in times):
        raise ValueError("Invalid sample time")
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError("Unordered samples")
    anchors = value["anchors"]
    if not isinstance(anchors, list) or len(anchors) > 48:
        raise ValueError("Invalid anchors")
    for frame in anchors:
        if not isinstance(frame, dict) or set(frame) != {"t", "points"} or frame["t"] not in times:
            raise ValueError("Invalid anchor frame")
        if not isinstance(frame["points"], list) or len(frame["points"]) > 4:
            raise ValueError("Invalid points")
        for point in frame["points"]:
            if set(point) != {"id", "x", "y"} or point["id"] not in [11, 12, 23, 24]:
                raise ValueError("Invalid point")
            if any(not finite(point[k]) or not 0 <= point[k] <= 1 for k in ["x", "y"]):
                raise ValueError("Invalid coordinate")
    return value


def finite(value):
    return type(value) in [int, float] and math.isfinite(value)


def sample_indices(times, requested):
    def nearest(t):
        i = bisect.bisect_left(times, t)
        return min([max(0, i - 1), min(i, len(times) - 1)], key=lambda j: abs(times[j] - t))
    exact = {nearest(t) for t in requested}
    if any(abs(times[nearest(t)] - t) > .002 for t in requested):
        raise ValueError("Evidence does not match decoded frames")
    # <= 12 FPS on short clips; <= 400 real frames for a two-minute upload.
    # Always retain the actual evidence frames, without interpolation.
    start, end = min(requested), max(requested)
    count = min(352, max(2, math.ceil((end-start) * 12)))
    return sorted(exact | {nearest(start+(end-start) * i / (count - 1)) for i in range(count)})


def mask_outline(mask):
    import cv2
    import numpy as np
    if hasattr(mask, "detach"):
        mask = mask.detach().cpu().numpy()
    mask = np.asarray(mask).squeeze()
    if mask.ndim != 2:
        raise ValueError("Unexpected mask")
    binary = (mask > 0).astype(np.uint8)
    h, w = binary.shape
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    if area < w*h*.0003 or area > w*h*.9:
        return None
    # Fragmented/occluded regions are not joined with invented connecting edges.
    if sum(cv2.contourArea(c) for c in contours) > area * 1.2:
        return None
    perimeter = cv2.arcLength(contour, True)
    for epsilon in [.002, .004, .008, .016]:
        polygon = cv2.approxPolyDP(contour, perimeter * epsilon, True).reshape(-1, 2)
        if len(polygon) <= 64:
            break
    if not 3 <= len(polygon) <= 64:
        return None
    return [[round(float(x)/w, 5), round(float(y)/h, 5)] for x, y in polygon]


def bounds(obj):
    xs, ys = zip(*obj["polygon"])
    return min(xs), min(ys), max(xs), max(ys)


def select_subjects(frames, anchors):
    """Use independently visible torso evidence; abstain on competing subjects.

    Plate selection uses movement only to rank regions. Those region centres
    are discarded, not emitted as metric or physical bar-point observations.
    """
    votes = {}
    for anchor in anchors:
        if len(anchor["points"]) < 3:
            continue
        frame = min(frames, key=lambda f: abs(f["t"]-anchor["t"]))
        if abs(frame["t"]-anchor["t"]) > .012:
            continue
        matches = []
        for obj in frame["objects"]:
            if obj["kind"] != "person":
                continue
            left, top, right, bottom = bounds(obj)
            if all(left <= p["x"] <= right and top <= p["y"] <= bottom for p in anchor["points"]):
                matches.append(obj["id"])
        if len(matches) == 1:
            votes[matches[0]] = votes.get(matches[0], 0) + 1
    ranked = sorted(votes, key=votes.get, reverse=True)
    person = ranked[0] if ranked and votes[ranked[0]] >= 2 else None
    if person and len(ranked) > 1 and votes[person] < votes[ranked[1]] * 2:
        person = None
    trajectories = {}
    if person:
        for frame in frames:
            athlete = next((o for o in frame["objects"] if o["id"] == person), None)
            if not athlete:
                continue
            left, top, right, bottom = bounds(athlete)
            for obj in frame["objects"]:
                if obj["kind"] != "plate":
                    continue
                x0, y0, x1, y1 = bounds(obj)
                x, y = (x0+x1)/2, (y0+y1)/2
                if left-.25 <= x <= right+.25 and top-.1 <= y <= bottom+.1:
                    trajectories.setdefault(obj["id"], []).append((frame["t"], x, y, (x1-x0)*(y1-y0),
                                                                         min(x0,y0,1-x1,1-y1) > .005,
                                                                         y-(top+bottom)/2))
    movement = {}
    for key, positions in trajectories.items():
        if len(positions) < 8:
            continue
        # Robust spread avoids selecting a region from a single jumping mask.
        xs, ys = [sorted(p[k] for p in positions) for k in [1,2]]
        lo, hi = len(xs)//10, len(xs)-1-len(xs)//10
        spread = math.hypot(xs[hi]-xs[lo], ys[hi]-ys[lo])
        relative = sorted(p[5] for p in positions)
        # A camera pan alone must not make stationary plates eligible.
        if spread >= .03 and relative[hi] - relative[lo] >= .04:
            movement[key] = spread
    ordered = sorted(movement, key=movement.get, reverse=True)
    plate = ordered[0] if ordered else None
    if plate and len(ordered) > 1 and movement[plate] < movement[ordered[1]] * 1.8:
        contenders = [key for key in ordered if movement[key] * 1.8 > movement[plate]]
        # Both bar ends normally move together. Similar movement is not itself
        # ambiguity: require correlated vertical motion, consistent perspective-scaled motion
        # and comparable size (including stacked plates on one end) before choosing the clearer end.
        if 2 <= len(contenders) <= 4 and all(coherent_pair(trajectories[a], trajectories[b])
                                                    for a,b in combinations(contenders, 2)):
            plate = max(contenders, key=lambda key: (
                sum(p[4] for p in trajectories[key]),
                statistics.median(p[3] for p in trajectories[key]),
            ))
        else:
            plate = None
    chosen = {person, plate} - {None}
    return [{"t": f["t"], "objects": [o for o in f["objects"] if o["id"] in chosen]} for f in frames]


def coherent_pair(first, second):
    other = {p[0]: p for p in second}
    pairs = [(p, other[p[0]]) for p in first if p[0] in other]
    if len(pairs) < 8:
        return False
    a, b = [p[2] for p,q in pairs], [q[2] for p,q in pairs]
    if min(statistics.pstdev(a), statistics.pstdev(b)) < .025:
        return False
    correlation = statistics.correlation(a, b)
    # Perspective makes the near end travel farther in pixels. Fit a scale
    # for association only; this is never exported as a physical measurement.
    slope = statistics.covariance(a, b) / statistics.variance(a)
    residual = statistics.pstdev([y-slope*x for x,y in zip(a,b)])
    area_ratio = statistics.median(p[3]/max(q[3], 1e-8) for p,q in pairs)
    return (correlation >= .95 and residual <= .035
            and .5 <= slope <= 2 and .2 <= area_ratio <= 5)


def infer_frames(predictor, directory, times, anchors, diagnostics=None):
    collected = [{"t": round(t, 6), "objects": []} for t in times]
    for kind, prompt in [("person", "person"), ("plate", "weight plate")]:
        session = predictor.handle_request({
            "type": "start_session", "resource_path": str(directory),
            "offload_video_to_cpu": True,
        })["session_id"]
        try:
            predictor.handle_request({"type": "add_prompt", "session_id": session,
                                      "frame_index": 0, "text": prompt})
            # Independent sessions are essential when switching concept prompts.
            for item in predictor.handle_stream_request({
                "type": "propagate_in_video", "session_id": session,
                "propagation_direction": "forward", "start_frame_index": 0,
            }):
                i, out = item["frame_index"], item["outputs"]
                if type(i) is not int or not 0 <= i < len(times):
                    raise ValueError("Unexpected frame index")
                ids, masks = out["out_obj_ids"], out["out_binary_masks"]
                if len(ids) != len(masks) or len(ids) > 8:
                    raise ValueError("Unexpected object count")
                for object_id, mask in zip(ids, masks):
                    polygon = mask_outline(mask)
                    if polygon is not None:
                        collected[i]["objects"].append({
                            "id": f"{kind}-{int(object_id)}", "kind": kind, "polygon": polygon,
                        })
        finally:
            predictor.handle_request({"type": "close_session", "session_id": session})
    if diagnostics is not None:
        diagnostics["candidates"] = collected
    return select_subjects(collected, anchors)


def analyse(predictor, media, manifest, diagnostics=None):
    import cv2
    manifest = validate_manifest(manifest)
    if not 1 <= len(media) <= MAX_BYTES or hashlib.sha256(media).hexdigest() != manifest["sha256"]:
        raise ValueError("Invalid media")
    with tempfile.TemporaryDirectory(prefix="sam3-lift-") as root:
        root = Path(root)
        source = root / "clip.mp4"
        source.write_bytes(media)
        source.chmod(0o600)
        result = subprocess.run([
            "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", "mov", "-select_streams", "v:0", "-show_frames",
            "-show_entries", "frame=best_effort_timestamp_time,width,height", "-of", "json", str(source),
        ], check=True, capture_output=True, timeout=45)
        if len(result.stdout) > 3_000_000:
            raise ValueError("Oversize frame data")
        raw = json.loads(result.stdout)["frames"]
        if not 12 <= len(raw) <= 14400:
            raise ValueError("Invalid frame count")
        times = [float(f["best_effort_timestamp_time"]) for f in raw]
        if any(not finite(t) or not 0 <= t <= 120.2 for t in times) or any(b <= a for a,b in zip(times,times[1:])):
            raise ValueError("Invalid timing")
        if abs(times[-1] - manifest["duration"]) > .002 or any(
            f["width"] != manifest["width"] or f["height"] != manifest["height"] for f in raw
        ):
            raise ValueError("Mismatched dimensions or duration")
        picks = sample_indices(times, manifest["sampleTimes"])
        directory = root / "frames"
        directory.mkdir(mode=0o700)
        cap = cv2.VideoCapture(str(source))
        try:
            chosen = set(picks)
            n = 0
            for i in range(len(times)):
                ok, frame = cap.read()
                if not ok:
                    raise ValueError("Decode failed")
                if i in chosen:
                    if not cv2.imwrite(str(directory / f"{n:05d}.jpg"), frame):
                        raise ValueError("Frame write failed")
                    n += 1
        finally:
            cap.release()
        frames = infer_frames(predictor, directory, [times[i] for i in picks], manifest["anchors"], diagnostics)
        count = sum(bool(f["objects"]) for f in frames)
        return {
            "version": 1, "model": "sam3.1", "revision": REVISION,
            "sourceSha256": manifest["sha256"],
            "status": "tracked" if count == len(frames) else "partial" if count else "unavailable",
            "reason": "Experimental object outlines at sampled frames; no joint or bar-speed measurements."
            if count else "The athlete and plates could not be selected confidently. Review the unmarked video.",
            "width": manifest["width"], "height": manifest["height"], "frames": frames,
        }
