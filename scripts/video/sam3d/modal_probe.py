"""Isolated SAM 3D Body feasibility probe. No public endpoint or production wiring.

Uses the existing read-only Hugging Face secret; only explicitly selected image
bytes and an existing person mask are sent to Modal. Output is OBSERVED geometry,
never an ideal-form correction. Run against a public/synthetic benchmark first.
"""
from pathlib import Path
import json
import modal

REPO = "facebook/sam-3d-body-dinov3"
CODE_REVISION = "b5c765a0d89d789985e186d396315e7590887b94"
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
)
weights = modal.Volume.from_name("lift-journal-sam31-weights")
secret = modal.Secret.from_name("lift-journal-sam31-hf")


@app.function(image=common, secrets=[secret], timeout=30)
def access():
    import os
    from huggingface_hub import get_hf_file_metadata, hf_hub_url
    from huggingface_hub.errors import HfHubHTTPError
    try:
        info = get_hf_file_metadata(hf_hub_url(REPO, "model.ckpt"), token=os.environ["HF_TOKEN"], timeout=12)
        return {"access": True, "revision": info.commit_hash, "bytes": info.size}
    except HfHubHTTPError as error:
        return {"access": False, "status": error.response.status_code if error.response is not None else None}


@app.function(image=image, gpu="L40S", cpu=4, memory=32768, min_containers=0,
              max_containers=1, scaledown_window=2, timeout=600,
              volumes={"/models": weights}, secrets=[secret])
def reconstruct(photo: bytes, mask_png: bytes, revision: str):
    import os
    import re
    import time
    import cv2
    import numpy as np
    import torch
    from huggingface_hub import snapshot_download
    from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or not 0 < len(photo) <= 5_000_000 or not 0 < len(mask_png) <= 5_000_000:
        raise ValueError("Invalid bounded probe input")
    frame = cv2.imdecode(np.frombuffer(photo, np.uint8), cv2.IMREAD_COLOR)
    mask = cv2.imdecode(np.frombuffer(mask_png, np.uint8), cv2.IMREAD_GRAYSCALE)
    if frame is None or mask is None or frame.shape[:2] != mask.shape or max(mask.shape) > 1280:
        raise ValueError("Image and person mask must match and be at most 1280 pixels")
    ys, xs = np.where(mask > 127)
    if len(xs) < mask.size * 0.02:
        raise ValueError("A selected lifter mask is required")
    # Download only the checkpoint/config/rig needed. The persistent volume never
    # receives uploaded media, predictions or personal meshes.
    path = snapshot_download(REPO, revision=revision, token=os.environ["HF_TOKEN"],
                             allow_patterns=["model.ckpt", "model_config.yaml", "assets/mhr_model.pt"])
    weights.commit()
    started = time.monotonic()
    model, cfg = load_sam_3d_body(str(Path(path)/"model.ckpt"), mhr_path=str(Path(path)/"assets/mhr_model.pt"))
    estimator = SAM3DBodyEstimator(model, cfg)
    with torch.inference_mode():
        outputs = estimator.process_one_image(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
            bboxes=np.array([[xs.min(), ys.min(), xs.max()+1, ys.max()+1]], dtype=np.float32),
            masks=(mask > 127).astype(np.uint8)[None], inference_type="body")
    if len(outputs) != 1:
        raise ValueError("Exactly one selected lifter is required")
    result = outputs[0]
    geometry = {key: np.asarray(result[key]).tolist() for key in
                ["pred_vertices", "pred_keypoints_3d", "pred_keypoints_2d", "pred_cam_t", "focal_length",
                 "body_pose_params", "shape_params", "scale_params"]}
    geometry["faces"] = estimator.faces.tolist()
    # Refuse non-finite results before producing any renderable output.
    json.dumps(geometry, allow_nan=False)
    return {"version": 1, "kind": "observed_body_only", "model": REPO, "revision": revision,
            "codeRevision": CODE_REVISION, "width": frame.shape[1], "height": frame.shape[0],
            "geometry": geometry, "seconds": round(time.monotonic()-started, 3)}


@app.local_entrypoint()
def main(photo: str = "", mask: str = "", output: str = ""):
    status = access.remote()
    print(json.dumps(status))
    if not status["access"] or not photo:
        return
    if not mask or not output:
        raise ValueError("Specify a person mask and local output path")
    call = reconstruct.spawn(Path(photo).read_bytes(), Path(mask).read_bytes(), status["revision"])
    try:
        result = call.get(timeout=660)
        Path(output).write_text(json.dumps(result, allow_nan=False))
        print(json.dumps({"kind":result["kind"],"vertices":len(result["geometry"]["pred_vertices"]),"seconds":result["seconds"]}))
    except (TimeoutError, KeyboardInterrupt):
        call.cancel(terminate_containers=True)
        raise
