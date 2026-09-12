"""Isolated SAM 3D Body feasibility probe. No public endpoint or production wiring.

Uses the existing read-only Hugging Face secret; only explicitly selected image
bytes and an existing person mask are sent to Modal. Output is OBSERVED geometry,
never an ideal-form correction. Run against a public/synthetic benchmark first.
"""
from pathlib import Path
import json
import shlex
import modal

REPO = "facebook/sam-3d-body-dinov3"
CODE_REVISION = "b5c765a0d89d789985e186d396315e7590887b94"
MODEL_REVISION = "11aaa346c7204874a1cbafe3d39a979080b2c55a"
DINO_REVISION = "6876159a11b4df116f30f667f8c9888617df0751"
# Upstream's torch.hub call fetches DINO's moving main branch at inference time.
# Use a checked, local patch and bake the exact source into the CPU-built image.
PIN_BACKBONE = '''from pathlib import Path
p = Path("/opt/sam3d/sam_3d_body/models/backbones/dinov3.py")
s = p.read_text()
for before, after in [('"facebookresearch/dinov3"', '"/opt/dinov3"'), ('source="github"', 'source="local"')]:
    assert s.count(before) == 1, "Upstream backbone changed; inspect before patching"
    s = s.replace(before, after)
p.write_text(s)
'''
app = modal.App("lift-journal-sam3d-probe")
common = modal.Image.debian_slim(python_version="3.12").pip_install("huggingface-hub==0.34.4")
image = (
    common.apt_install("git", "libglib2.0-0", "libgl1")
    .pip_install("torch==2.10.0", "torchvision==0.25.0", index_url="https://download.pytorch.org/whl/cu128")
    .pip_install("numpy==1.26.4", "opencv-python-headless==4.11.0.86", "pytorch-lightning==2.5.6",
                 "yacs==0.1.8", "scikit-image==0.25.2", "einops==0.8.1", "timm==1.0.22",
                 "roma==1.5.4", "hydra-core==1.3.2", "loguru==0.7.3", "dill==0.4.0",
                 "pandas==2.3.3", "rich==14.2.0", "joblib==1.5.2", "fvcore==0.1.5.post20221221",
                 "iopath==0.1.10", "tensorboard==2.20.0", "optree==0.17.0")
    .run_commands("git init /opt/sam3d && cd /opt/sam3d && git remote add origin https://github.com/facebookresearch/sam-3d-body.git "
                  f"&& git fetch --depth 1 origin {CODE_REVISION} && git checkout FETCH_HEAD")
    .env({"PYTHONPATH": "/opt/sam3d", "HF_HOME": "/models", "HF_HUB_DISABLE_TELEMETRY": "1", "WANDB_MODE": "disabled"})
    .pip_install("braceexpand==0.1.7")
    # Catch missing runtime imports during the CPU build, before GPU allocation.
    .run_commands("python -c 'import sam_3d_body'")
    .run_commands("git init /opt/dinov3 && cd /opt/dinov3 && git remote add origin https://github.com/facebookresearch/dinov3.git "
                  f"&& git fetch --depth 1 origin {DINO_REVISION} && git checkout FETCH_HEAD")
    .run_commands("python -c " + shlex.quote("exec(" + repr(PIN_BACKBONE) + ")"))
)
weights = modal.Volume.from_name("lift-journal-sam31-weights")
secret = modal.Secret.from_name("lift-journal-sam31-hf")


@app.function(image=common, secrets=[secret], timeout=30)
def access():
    import os
    from huggingface_hub import get_hf_file_metadata, hf_hub_url
    from huggingface_hub.errors import HfHubHTTPError
    try:
        info = get_hf_file_metadata(hf_hub_url(REPO, "model.ckpt", revision=MODEL_REVISION), token=os.environ["HF_TOKEN"], timeout=12)
        return {"access": True, "revision": info.commit_hash, "bytes": info.size}
    except HfHubHTTPError as error:
        return {"access": False, "status": error.response.status_code if error.response is not None else None}


@app.function(image=image, gpu="L40S", cpu=4, memory=32768, min_containers=0,
              max_containers=1, scaledown_window=2, timeout=600,
              volumes={"/models": weights}, secrets=[secret])
def reconstruct(samples: list[tuple[bytes, bytes]], revision: str):
    import hashlib
    import os
    import time
    import cv2
    import numpy as np
    import torch
    from huggingface_hub import snapshot_download
    from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body
    if revision != MODEL_REVISION or not 1 <= len(samples) <= 4:
        raise ValueError("Invalid bounded probe input")
    decoded = []
    for photo, mask_png in samples:
        if not 0 < len(photo) <= 5_000_000 or not 0 < len(mask_png) <= 5_000_000:
            raise ValueError("Each image and mask must be at most 5 MB")
        frame = cv2.imdecode(np.frombuffer(photo, np.uint8), cv2.IMREAD_COLOR)
        mask = cv2.imdecode(np.frombuffer(mask_png, np.uint8), cv2.IMREAD_GRAYSCALE)
        if frame is None or mask is None or frame.shape[:2] != mask.shape or max(mask.shape) > 1280:
            raise ValueError("Image and person mask must match and be at most 1280 pixels")
        ys, xs = np.where(mask > 127)
        if len(xs) < mask.size * 0.02:
            raise ValueError("A selected lifter mask is required")
        decoded.append((frame, mask, xs, ys, hashlib.sha256(photo).hexdigest(), hashlib.sha256(mask_png).hexdigest()))
    # Download only the checkpoint/config/rig needed. The persistent volume never
    # receives uploaded media, predictions or personal meshes.
    path = snapshot_download(REPO, revision=revision, token=os.environ["HF_TOKEN"],
                             allow_patterns=["model.ckpt", "model_config.yaml", "assets/mhr_model.pt"])
    weights.commit()
    started = time.monotonic()
    model, cfg = load_sam_3d_body(str(Path(path)/"model.ckpt"), mhr_path=str(Path(path)/"assets/mhr_model.pt"))
    estimator = SAM3DBodyEstimator(model, cfg)
    torch.cuda.synchronize()
    load_seconds = time.monotonic() - started
    results = []
    for frame, mask, xs, ys, photo_hash, mask_hash in decoded:
        started = time.monotonic()
        torch.cuda.reset_peak_memory_stats()
        with torch.inference_mode():
            outputs = estimator.process_one_image(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
                bboxes=np.array([[xs.min(), ys.min(), xs.max()+1, ys.max()+1]], dtype=np.float32),
                masks=(mask > 127).astype(np.uint8)[None], inference_type="body")
        torch.cuda.synchronize()
        inference_seconds = time.monotonic() - started
        if len(outputs) != 1:
            raise ValueError("Exactly one selected lifter is required")
        result = outputs[0]
        geometry = {key: np.asarray(result[key]).tolist() for key in
                    ["pred_vertices", "pred_keypoints_3d", "pred_keypoints_2d", "pred_cam_t", "focal_length",
                     "body_pose_params", "shape_params", "scale_params", "mhr_model_params"]}
        geometry["faces"] = estimator.faces.tolist()
        # Refuse non-finite results before producing any renderable output.
        json.dumps(geometry, allow_nan=False)
        results.append({"version": 1, "kind": "observed_body_only", "model": REPO, "revision": revision,
            "codeRevision": CODE_REVISION, "backboneRevision": DINO_REVISION,
            "width": frame.shape[1], "height": frame.shape[0], "sourceSha256": photo_hash, "maskSha256": mask_hash,
            "geometry": geometry, "modelLoadSeconds": round(load_seconds, 3),
            "inferenceSeconds": round(inference_seconds, 3),
            "peakAllocatedGpuGiB": round(torch.cuda.max_memory_allocated()/1024**3, 3)})
    return results


@app.local_entrypoint()
def main(photo: str = "", mask: str = "", output: str = "", batch: str = ""):
    """Use one photo/mask/output, or a JSON list of up to four such path objects."""
    status = access.remote()
    print(json.dumps(status))
    if not status["access"] or not (photo or batch):
        return
    if batch and (photo or mask or output):
        raise ValueError("Choose either a batch or a single frame")
    if not batch and (not mask or not output):
        raise ValueError("Specify a person mask and local output path")
    jobs = json.loads(Path(batch).read_text()) if batch else [{"photo": photo, "mask": mask, "output": output}]
    if not isinstance(jobs, list) or not 1 <= len(jobs) <= 4:
        raise ValueError("A probe accepts one to four explicitly selected frames")
    samples = [(Path(job["photo"]).read_bytes(), Path(job["mask"]).read_bytes()) for job in jobs]
    call = reconstruct.spawn(samples, status["revision"])
    try:
        results = call.get(timeout=660)
        if len(results) != len(jobs):
            raise ValueError("Incomplete probe results")
        for job, result in zip(jobs, results):
            Path(job["output"]).write_text(json.dumps(result, allow_nan=False))
            print(json.dumps({"kind": result["kind"], "vertices": len(result["geometry"]["pred_vertices"]),
                              "modelLoadSeconds": result["modelLoadSeconds"], "inferenceSeconds": result["inferenceSeconds"],
                              "peakAllocatedGpuGiB": result["peakAllocatedGpuGiB"]}))
    except (TimeoutError, KeyboardInterrupt):
        call.cancel(terminate_containers=True)
        raise
