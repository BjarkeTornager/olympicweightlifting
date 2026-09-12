"""Local 2D landmarks for replay highlights, never biomechanical measurements."""
import ctypes
import math
import os
import sys
import statistics


def deny_network():
    """Deny all socket creation in the Linux media process, including SDK metrics.
    FFmpeg uses file/pipe only. No provider/auth secrets are passed to this process.
    This filter is inherited by native-library threads and child decoders.
    """
    if sys.platform != "linux":
        return
    lib = ctypes.CDLL("libseccomp.so.2")
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_attr_set.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint32]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError("Could not isolate video tracking.")
    try:
        for name in [b"socket", b"socketpair"]:
            number = lib.seccomp_syscall_resolve_name(name)
            if number < 0 or lib.seccomp_rule_add(context, 0x00050001, number, 0):
                raise RuntimeError("Could not isolate video tracking.")
        if lib.seccomp_attr_set(context, 4, 1) or lib.seccomp_load(context):  # TSYNC
            raise RuntimeError("Could not isolate video tracking.")
    finally:
        lib.seccomp_release(context)


def visible_points(poses):
    # With multiple people, do not guess who the lifter is or switch subjects.
    if len(poses) != 1:
        return []
    return [{"id": i, "x": round(p.x, 5), "y": round(p.y, 5)}
            for i, p in enumerate(poses[0])
            if i in [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
            and all(math.isfinite(v) for v in [p.x, p.y, p.visibility, p.presence])
            and 0 <= p.x <= 1 and 0 <= p.y <= 1
            and p.visibility >= .8 and p.presence >= .8]


class SubjectTracker:
    """Conservative foreground continuity, not face/person identification.

    A dominant, sufficiently large body can be selected with spectators present.
    After selection, match visible torso anchors and scale; never fall back to
    the largest remaining person when the selected subject disappears.
    """
    def __init__(self):
        self.previous = None
        self.last = None

    def select(self, poses, time):
        candidates = []
        for pose in poses:
            points = visible_points([pose])
            anchors = {p['id']: p for p in points if p['id'] in [11, 12, 23, 24]}
            if not ({11, 23} <= anchors.keys() or {12, 24} <= anchors.keys()):
                continue
            xs, ys = [p['x'] for p in points], [p['y'] for p in points]
            area = (max(xs)-min(xs)) * (max(ys)-min(ys))
            if area < .025 or max(ys)-min(ys) < .25:
                continue
            candidates.append({'points': points, 'anchors': anchors, 'area': area})
        if not candidates:
            return []
        if self.previous is None:
            candidates.sort(key=lambda c: c['area'], reverse=True)
            if len(candidates) > 1 and candidates[0]['area'] < candidates[1]['area'] * 1.8:
                return []
            chosen = candidates[0]
            cx = statistics.mean(p['x'] for p in chosen['anchors'].values())
            if not .15 <= cx <= .85:
                return []
        else:
            dt = time - self.last
            if dt <= 0 or dt > .5:
                return []
            matches = []
            for candidate in candidates:
                common = candidate['anchors'].keys() & self.previous['anchors'].keys()
                if len(common) < 2 or not .5 <= candidate['area']/self.previous['area'] <= 2:
                    continue
                distance = statistics.median(math.hypot(candidate['anchors'][i]['x']-self.previous['anchors'][i]['x'],
                                                         candidate['anchors'][i]['y']-self.previous['anchors'][i]['y']) for i in common)
                if distance <= min(.18, .04 + dt * .8):
                    matches.append((distance, candidate))
            matches.sort(key=lambda m: m[0])
            if not matches or (len(matches) > 1 and matches[1][0] - matches[0][0] < .04):
                return []
            chosen = matches[0][1]
        self.previous, self.last = chosen, time
        return chosen['points']


class PoseTracker:
    def __init__(self, interval=.049):
        self.frames = []
        self.model = None
        self.last = -1
        self.interval = interval
        self.subject = SubjectTracker()
        self.reason = "Body highlights are unavailable for this clip."
        path = os.environ.get("VIDEO_POSE_MODEL_PATH", "")
        if not path or not os.path.isfile(path):
            return
        try:
            deny_network()
            import mediapipe as mp
            self.mp = mp
            options = mp.tasks.vision.PoseLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=path, delegate=mp.tasks.BaseOptions.Delegate.CPU),
                running_mode=mp.tasks.vision.RunningMode.VIDEO,
                num_poses=2, min_pose_detection_confidence=.65,
                min_pose_presence_confidence=.65, min_tracking_confidence=.7)
            self.model = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        except Exception:
            # Pose is optional. A missing library or unsupported platform must not
            # discard a valid upload or block timestamped coaching.
            self.reason = "Body tracking could not run; timestamped feedback remains available."

    def add(self, frame, time, force=False):
        if self.model is None or time <= self.last or (not force and time - self.last < self.interval):
            return
        self.last = time
        import cv2
        try:
            result = self.model.detect_for_video(
                self.mp.Image(image_format=self.mp.ImageFormat.SRGB,
                              data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), round(time * 1000))
            points = self.subject.select(result.pose_landmarks, time)
            if not points:
                self.reason = "The foreground lifter could not be followed reliably. Inspect the evidence frames without body markers."
            self.frames.append({"t": round(time, 6), "points": points})
        except Exception:
            self.close()
            self.reason = "Body tracking stopped. Highlights are hidden where evidence is missing."

    def close(self):
        if self.model is not None:
            self.model.close()
            self.model = None

    def result(self):
        visible = sum(bool(f["points"]) for f in self.frames)
        return {"version": 2, "status": "tracked" if visible and visible == len(self.frames) else "partial" if visible else "unavailable",
                "reason": "Experimental 2D body highlights. Hidden or ambiguous landmarks are omitted." if visible else self.reason,
                "frames": self.frames if visible else []}
