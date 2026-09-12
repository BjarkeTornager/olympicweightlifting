"""Deploy from the repository root: modal deploy scripts/video/sam3/modal_app.py.

CPU gateway authenticates BEFORE GPU dispatch. Models are pinned. Video files
exist only in the GPU call's temporary directory; the volume holds weights only.
"""
from pathlib import Path
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
    .add_local_file(Path(__file__).with_name("engine.py"), "/opt/lift/engine.py")
    .env({"HF_HOME": "/models", "HF_HUB_DISABLE_TELEMETRY": "1", "PYTHONPATH": "/opt/lift"})
)
weights = modal.Volume.from_name("lift-journal-sam31-weights", create_if_missing=True)


@app.cls(image=image, gpu="L40S", cpu=4, memory=32768,
         min_containers=0, max_containers=1, scaledown_window=30, timeout=180,
         volumes={"/models": weights}, secrets=[modal.Secret.from_name("lift-journal-sam31-hf")])
class Segmenter:
    @modal.enter()
    def load(self):
        import os
        from huggingface_hub import hf_hub_download
        from sam3.model_builder import build_sam3_multiplex_video_predictor
        from engine import CHECKPOINT_REVISION
        checkpoint = hf_hub_download("facebook/sam3.1", "sam3.1_multiplex.pt",
                                     revision=CHECKPOINT_REVISION, token=os.environ["HF_TOKEN"])
        weights.commit()
        self.predictor = build_sam3_multiplex_video_predictor(
            checkpoint_path=checkpoint, max_num_objects=8,
            use_fa3=False, use_rope_real=False, compile=False, async_loading_frames=False,
        )

    @modal.method()
    def segment(self, media: bytes, manifest: dict):
        from engine import analyse
        return analyse(self.predictor, media, manifest)


@app.function(image=common.add_local_file(Path(__file__).with_name("engine.py"), "/opt/lift/engine.py")
              .add_local_file(Path(__file__).with_name("gateway.py"), "/opt/lift/gateway.py")
              .env({"PYTHONPATH": "/opt/lift"}),
              secrets=[modal.Secret.from_name("lift-journal-sam31-api")],
              min_containers=0, max_containers=2, timeout=180)
@modal.asgi_app()
def api():
    from gateway import create_app
    return create_app(Segmenter().segment.remote.aio)


@app.local_entrypoint()
def smoke(video: str, manifest: str, output: str):
    """Explicit public-fixture test; invoking this uses the paid GPU."""
    import json
    result = Segmenter().segment.remote(Path(video).read_bytes(), json.loads(Path(manifest).read_text()))
    Path(output).write_text(json.dumps(result, allow_nan=False))
    print(json.dumps({"model":result["model"],"status":result["status"],"frames":len(result["frames"])}))
