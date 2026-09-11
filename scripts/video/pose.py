"""Local 2D landmarks for replay highlights, never biomechanical measurements."""
import ctypes
import math
import os
import sys


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


class PoseTracker:
    def __init__(self):
        self.frames = []
        self.model = None
        self.last = -1
        self.previous = None
        self.ambiguous = False
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

    def add(self, frame, time):
        if self.model is None or time - self.last < .049:
            return
        self.last = time
        import cv2
        try:
            result = self.model.detect_for_video(
                self.mp.Image(image_format=self.mp.ImageFormat.SRGB,
                              data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), round(time * 1000))
            if len(result.pose_landmarks) > 1:
                self.ambiguous = True
                self.reason = "Multiple people make body highlights ambiguous. Use the timestamped feedback."
            points = [] if self.ambiguous else visible_points(result.pose_landmarks)
            # Suppress a discontinuity rather than connecting different subjects.
            if self.previous and points:
                old = {p["id"]: p for p in self.previous}
                if any(math.hypot(p["x"] - old[p["id"]]["x"], p["y"] - old[p["id"]]["y"]) > .2
                       for p in points if p["id"] in old):
                    points = []
            self.previous = points
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
        return {"status": "tracked" if visible and visible == len(self.frames) else "partial" if visible else "unavailable",
                "reason": "Experimental 2D body highlights. Hidden or ambiguous landmarks are omitted." if visible else self.reason,
                "frames": self.frames if visible else []}
