"""Deploy from the repository root: modal deploy scripts/video/sam3/modal_app.py::app.

CPU gateway authenticates BEFORE GPU dispatch. Models are pinned. Video files
exist only in the GPU call's temporary directory; the volume holds weights only.
"""
from pathlib import Path
import json
import time
import modal

SAM_REVISION = "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7"
app = modal.App("lift-journal-sam31")
common = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi==0.135.1")
image = (
    common.apt_install("git", "ffmpeg", "libglib2.0-0", "libgl1")
    .pip_install("torch==2.10.0", "torchvision==0.25.0", index_url="https://download.pytorch.org/whl/cu128")
    .pip_install("numpy==1.26.4", "opencv-python-headless==4.11.0.86", "einops==0.8.1",
                 "decord==0.6.0", "pycocotools==2.0.11", "psutil==7.2.2", "setuptools<81",
                 f"git+https://github.com/facebookresearch/sam3.git@{SAM_REVISION}")
    .env({"HF_HOME": "/models", "HF_HUB_DISABLE_TELEMETRY": "1", "PYTHONPATH": "/opt/lift"})
    .add_local_file(Path(__file__).with_name("engine.py"), "/opt/lift/engine.py")
)
weights = modal.Volume.from_name("lift-journal-sam31-weights", create_if_missing=True)


@app.cls(image=image, gpu="L40S", cpu=4, memory=32768,
         min_containers=0, max_containers=1, scaledown_window=30, timeout=180, startup_timeout=300,
         volumes={"/models": weights}, secrets=[modal.Secret.from_name("lift-journal-sam31-hf")])
class Segmenter:
    @modal.enter()
    def load(self):
        from engine import load_predictor
        self.predictor = load_predictor()
        weights.commit()

    @modal.method()
    def segment(self, media: bytes, manifest: dict, expires: float):
        from engine import analyse
        if time.time() >= expires:
            raise TimeoutError("Segmentation queue expired")
        return analyse(self.predictor, media, manifest)


@app.function(image=common.env({"PYTHONPATH": "/opt/lift"})
              .add_local_file(Path(__file__).with_name("engine.py"), "/opt/lift/engine.py")
              .add_local_file(Path(__file__).with_name("gateway.py"), "/opt/lift/gateway.py"),
              secrets=[modal.Secret.from_name("lift-journal-sam31-api")],
              min_containers=0, max_containers=2, timeout=60)
@modal.asgi_app()
def api():
    from gateway import create_app
    return create_app(Segmenter().segment.spawn.aio, modal.FunctionCall.from_id)


# Test the identical image/loader without exposing an HTTP service or requiring
# the production API credential. Only the explicitly selected app is started.
smoke_app = modal.App("lift-journal-sam31-smoke")


@smoke_app.cls(image=image, gpu="L40S", cpu=4, memory=32768,
         min_containers=0, max_containers=1, scaledown_window=2, timeout=180,
         startup_timeout=300, volumes={"/models": weights},
         secrets=[modal.Secret.from_name("lift-journal-sam31-hf")])
class Probe:
    @modal.enter()
    def load(self):
        from engine import load_predictor
        started = time.monotonic()
        self.predictor = load_predictor()
        weights.commit()
        self.load_seconds = time.monotonic() - started

    @modal.method()
    def run(self, media: bytes, manifest: dict):
        import torch
        from engine import analyse
        torch.cuda.reset_peak_memory_stats()
        started = time.monotonic()
        diagnostics = {}
        result = analyse(self.predictor, media, manifest, diagnostics)
        torch.cuda.synchronize()
        return {"segmentation": result, "diagnostics": diagnostics, "metrics": {
            "gpu": torch.cuda.get_device_name(), "torch": str(torch.__version__),
            "loadSeconds": round(self.load_seconds, 3),
            "inferenceSeconds": round(time.monotonic() - started, 3),
            "peakAllocatedGiB": round(torch.cuda.max_memory_allocated()/1024**3, 3),
            "peakReservedGiB": round(torch.cuda.max_memory_reserved()/1024**3, 3),
        }}


@smoke_app.local_entrypoint()
def smoke(video: str, manifest: str, output: str):
    started = time.monotonic()
    call = Probe().run.spawn(Path(video).read_bytes(), json.loads(Path(manifest).read_text()))
    try:
        result = call.get(timeout=600)
    except (TimeoutError, KeyboardInterrupt):
        call.cancel(terminate_containers=True)
        raise
    result["metrics"]["roundTripSeconds"] = round(time.monotonic() - started, 3)
    Path(output).write_text(json.dumps(result, allow_nan=False))
    frames = result["segmentation"]["frames"]
    print(json.dumps({"status": result["segmentation"]["status"], "frames": len(frames),
                      "personFrames": sum(any(o["kind"] == "person" for o in f["objects"]) for f in frames),
                      "plateFrames": sum(any(o["kind"] == "plate" for o in f["objects"]) for f in frames),
                      **result["metrics"]}))


@smoke_app.local_entrypoint()
def queued_smoke(video: str, manifest: str, output: str):
    """Exercise the HTTP submit/poll contract locally against a real remote GPU.

    Requires FastAPI/httpx in the local test environment. No public endpoint or
    production API secret is created. Receipts and this random token stay local.
    """
    import secrets
    import sys
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    sys.path.insert(0, str(Path(__file__).parent))
    from gateway import create_app
    token = secrets.token_urlsafe(48)
    received = {}
    calls = []

    async def spawn(media, geometry, expires):
        call = await Probe().run.spawn.aio(media, geometry)
        calls.append(call)
        return call

    def lookup(call_id):
        call = modal.FunctionCall.from_id(call_id)
        async def get(timeout):
            result = await call.get.aio(timeout=timeout)
            received.update(result)
            return result["segmentation"]
        return SimpleNamespace(get=SimpleNamespace(aio=get), cancel=call.cancel)

    client = TestClient(create_app(spawn, lookup, token))
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "video/mp4",
               "X-SAM3-Manifest": Path(manifest).read_text(),
               "X-SAM3-Request": "12345678-abcd-1234-abcd-123456789012",
               "X-SAM3-Budget-Ms": "300000"}
    started = time.monotonic()
    complete = False
    try:
        accepted = client.post("/segment", headers=headers, content=Path(video).read_bytes())
        submit_seconds = time.monotonic() - started
        if accepted.status_code != 202:
            raise RuntimeError("GPU submission failed")
        headers["X-SAM3-Job"] = accepted.json()["job"]
        polls, longest = 0, 0
        while time.monotonic() - started < 300:
            request_started = time.monotonic()
            response = client.get("/segment", headers=headers)
            longest = max(longest, time.monotonic() - request_started)
            polls += 1
            if response.status_code == 200:
                complete = True
                break
            if response.status_code != 202:
                raise RuntimeError("GPU polling failed")
            time.sleep(2)
        if not complete:
            raise TimeoutError("GPU queue deadline exceeded")
        received["metrics"].update(roundTripSeconds=round(time.monotonic()-started,3),
                                   submitSeconds=round(submit_seconds,3), polls=polls,
                                   longestPollSeconds=round(longest,3))
        Path(output).write_text(json.dumps(received, allow_nan=False))
        frames = received["segmentation"]["frames"]
        print(json.dumps({"status": received["segmentation"]["status"], "frames":len(frames),
                          "plateFrames":sum(any(o["kind"] == "plate" for o in f["objects"]) for f in frames),
                          **received["metrics"]}))
    finally:
        if not complete:
            for call in calls:
                call.cancel()
