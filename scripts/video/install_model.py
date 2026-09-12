"""Build-time download only; no downloads during processing of user videos."""
import hashlib
import pathlib
import sys
import urllib.request

URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
with urllib.request.urlopen(URL, timeout=90) as response:
    data = response.read(8 * 1024 * 1024)
if hashlib.sha256(data).hexdigest() != SHA256:
    raise SystemExit("Pose model checksum mismatch")
target = pathlib.Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(data)
