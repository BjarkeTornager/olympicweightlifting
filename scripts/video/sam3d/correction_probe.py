"""Bounded offline rig test on an existing public reconstruction, not coaching."""
from pathlib import Path
import json
import sys
import time
import modal
sys.path.insert(0, str(Path(__file__).parent))
from modal_probe import image as base, weights, secret

ROOT = Path(__file__).parent
app = modal.App('lift-journal-correction-probe')
image = (base.env({'PYTHONPATH': '/opt/lift:/opt/sam3d'})
         .add_local_file(ROOT/'body_engine.py', '/opt/lift/body_engine.py')
         .add_local_file(ROOT/'correction_engine.py', '/opt/lift/correction_engine.py')
         .add_local_file(ROOT/'modal_probe.py', '/root/modal_probe.py'))


@app.function(image=image, gpu='L40S', cpu=4, memory=32768, timeout=300,
              min_containers=0, max_containers=1, scaledown_window=2,
              volumes={'/models': weights}, secrets=[secret])
def probe(data, target):
    from body_engine import load_estimator
    from correction_engine import solve
    import numpy as np
    if data.get('kind') != 'observed_body_only':
        raise ValueError('An explicit public probe reconstruction is required')
    estimator = load_estimator()
    started = time.monotonic()
    result, report = solve(estimator.model.head_pose, data['geometry'], target,
                           data['width'], data['height'], time.time()+180)
    return {'report': {**report, 'seconds': time.monotonic()-started},
            'vertices': np.asarray(result['pred_vertices']).tolist() if result else None}


@app.local_entrypoint()
def main(source: str, target: str, output: str):
    data = json.loads(Path(source).read_text())
    request = json.loads(Path(target).read_text())
    result = probe.remote(data, request)
    Path(output).write_text(json.dumps(result, allow_nan=False))
    print(json.dumps({k:v for k,v in result['report'].items() if k != 'delta'}))
