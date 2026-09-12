"""Authenticated, queued production body reconstruction. No always-on GPU."""
from pathlib import Path
import json
import sys
import time
import modal
sys.path.insert(0, str(Path(__file__).parent))
from modal_probe import image as tested_image, weights, secret

ROOT = Path(__file__).parent
app = modal.App('lift-journal-sam3d')
image = (tested_image.apt_install('ffmpeg')
         .env({'PYTHONPATH': '/opt/lift:/opt/sam3d'})
         .add_local_file(ROOT/'body_engine.py', '/opt/lift/body_engine.py')
         .add_local_file(ROOT/'correction_engine.py', '/opt/lift/correction_engine.py')
         .add_local_file(ROOT/'modal_probe.py', '/root/modal_probe.py'))


@app.cls(image=image, gpu='L40S', cpu=4, memory=32768, min_containers=0,
         max_containers=1, scaledown_window=30, timeout=480, startup_timeout=300,
         volumes={'/models': weights}, secrets=[secret])
class Reconstructor:
    @modal.enter()
    def load(self):
        from body_engine import load_estimator
        self.estimator = load_estimator()
        weights.commit()

    @modal.method()
    def reconstruct(self, media: bytes, manifest: dict, expires: float):
        from body_engine import analyse
        if time.time() >= expires:
            raise TimeoutError('Body queue expired')
        return analyse(self.estimator, media, manifest, expires)


common = (modal.Image.debian_slim(python_version='3.12').pip_install('fastapi==0.135.1')
          .env({'PYTHONPATH': '/opt/lift'})
          .add_local_file(ROOT/'body_engine.py', '/opt/lift/body_engine.py')
          .add_local_file(ROOT/'correction_engine.py', '/opt/lift/correction_engine.py')
          .add_local_file(ROOT.parent/'sam3'/'engine.py', '/opt/lift/engine.py')
          .add_local_file(ROOT.parent/'sam3'/'gateway.py', '/opt/lift/gateway.py')
          .add_local_file(ROOT/'modal_probe.py', '/root/modal_probe.py'))


@app.function(image=common, secrets=[modal.Secret.from_name('lift-journal-sam31-api')],
              min_containers=0, max_containers=2, timeout=60)
@modal.asgi_app()
def api():
    from gateway import create_app
    from body_engine import decode_payload, MAX_BYTES, MAX_MANIFEST
    return create_app(Reconstructor().reconstruct.spawn.aio, modal.FunctionCall.from_id,
        path='/body', content_type='application/octet-stream', decode_payload=decode_payload,
        max_bytes=MAX_BYTES+MAX_MANIFEST+4)


@app.local_entrypoint()
def smoke(video: str, manifest: str, output: str):
    from body_engine import validate_manifest
    m = validate_manifest(json.loads(Path(manifest).read_text()))
    started = time.monotonic()
    call = Reconstructor().reconstruct.spawn(Path(video).read_bytes(), m, time.time()+600)
    try:
        result = call.get(timeout=660)
        Path(output).write_text(json.dumps(result, allow_nan=False))
        print(json.dumps({'status': result['status'], 'frames': len(result['frames']),
            'bodyFrames': sum('image' in f for f in result['frames']), 'seconds': round(time.monotonic()-started, 2)}))
    except (TimeoutError, KeyboardInterrupt):
        call.cancel(terminate_containers=True)
        raise
