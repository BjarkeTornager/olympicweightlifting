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
         min_containers=0, max_containers=1, scaledown_window=30, timeout=180,
         volumes={"/models": weights}, secrets=[modal.Secret.from_name("lift-journal-sam31-hf")])
class Segmenter:
    @modal.enter()
    def load(self):
        from engine import load_predictor
        self.predictor = load_predictor()
        weights.commit()

    @modal.method()
    def segment(self, media: bytes, manifest: dict):
        from engine import analyse
        return analyse(self.predictor, media, manifest)


@app.function(image=common.env({"PYTHONPATH": "/opt/lift"})
              .add_local_file(Path(__file__).with_name("engine.py"), "/opt/lift/engine.py")
              .add_local_file(Path(__file__).with_name("gateway.py"), "/opt/lift/gateway.py"),
              secrets=[modal.Secret.from_name("lift-journal-sam31-api")],
              min_containers=0, max_containers=2, timeout=180)
@modal.asgi_app()
def api():
    from gateway import create_app
    return create_app(Segmenter().segment.remote.aio)


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
        result = analyse(self.predictor, media, manifest)
        torch.cuda.synchronize()
        return {"segmentation": result, "metrics": {
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
