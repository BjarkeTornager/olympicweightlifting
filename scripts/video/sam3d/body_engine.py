"""Observed and constrained suggested movement, selected-lifter frames only.

No ideal-form inference, measurements, external URLs or persistent media. The
returned PNGs are shaded projections of a mesh, not joint-confidence evidence.
"""
import base64
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import time

MODEL = 'facebook/sam-3d-body-dinov3'
REVISION = '11aaa346c7204874a1cbafe3d39a979080b2c55a'
MAX_BYTES = 25 * 1024 * 1024
MAX_MANIFEST = 200_000


def finite(x):
    return type(x) in (int, float) and math.isfinite(x)


def validate_manifest(m):
    required = {'version', 'sha256', 'width', 'height', 'duration', 'frames'}
    if not isinstance(m, dict) or not required.issubset(m) or set(m)-required-{'motionVersion','corrections'}:
        raise ValueError('Invalid body manifest')
    if 'motionVersion' in m and (type(m['motionVersion']) is not int or m['motionVersion'] != 1):
        raise ValueError('Invalid motion version')
    if 'corrections' in m and m.get('motionVersion') != 1:
        raise ValueError('Corrections require the movement protocol')
    if m['version'] != 1 or not isinstance(m['sha256'], str) or len(m['sha256']) != 64 or any(c not in '0123456789abcdef' for c in m['sha256']):
        raise ValueError('Invalid source')
    if any(type(m[k]) is not int or not 1 <= m[k] <= 960 for k in ('width', 'height')):
        raise ValueError('Invalid dimensions')
    if not finite(m['duration']) or not .1 <= m['duration'] <= 120.2:
        raise ValueError('Invalid duration')
    if not isinstance(m['frames'], list) or not 1 <= len(m['frames']) <= 48:
        raise ValueError('Invalid frame count')
    previous = -1
    for f in m['frames']:
        if not isinstance(f, dict) or set(f) != {'t', 'person', 'plates'}:
            raise ValueError('Invalid frame')
        if not finite(f['t']) or not previous < f['t'] <= m['duration'] + .002:
            raise ValueError('Invalid time')
        previous = f['t']
        if not isinstance(f['plates'], list) or len(f['plates']) > 1:
            raise ValueError('Invalid plate regions')
        for p in ([] if f['person'] is None else [f['person']]) + f['plates']:
            if not isinstance(p, list) or not 3 <= len(p) <= 64:
                raise ValueError('Invalid region')
            if any(not isinstance(xy, list) or len(xy) != 2 or any(not finite(x) or not 0 <= x <= 1 for x in xy) for xy in p):
                raise ValueError('Invalid polygon')
    if 'corrections' in m:
        from correction_engine import validate_plan
        if not isinstance(m['corrections'],list) or len(m['corrections']) != 1:
            raise ValueError('One main correction per attempt')
        for plan in m['corrections']:
            validate_plan(plan)
            if any(not any(abs(f['t']-plan[k]) < .00001 for f in m['frames']) for k in ('referenceTime','focusTime')):
                raise ValueError('Correction must use exact evidence frames')
    return m


def decode_payload(data):
    if len(data) < 5 or len(data) > MAX_BYTES + MAX_MANIFEST + 4:
        raise ValueError('Invalid body request')
    size = int.from_bytes(data[:4], 'big')
    if not 0 < size <= MAX_MANIFEST or len(data) <= size + 4:
        raise ValueError('Invalid body manifest length')
    manifest = validate_manifest(json.loads(data[4:4+size]))
    media = data[4+size:]
    if len(media) > MAX_BYTES or media[4:8] != b'ftyp' or hashlib.sha256(media).hexdigest() != manifest['sha256']:
        raise ValueError('Invalid media')
    return media, manifest


def load_estimator():
    import os
    from huggingface_hub import snapshot_download
    from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body
    path = Path(snapshot_download(MODEL, revision=REVISION, token=os.environ['HF_TOKEN'],
        allow_patterns=['model.ckpt', 'model_config.yaml', 'assets/mhr_model.pt']))
    model, cfg = load_sam_3d_body(str(path/'model.ckpt'), mhr_path=str(path/'assets/mhr_model.pt'))
    return SAM3DBodyEstimator(model, cfg)


def mask_for(polygon, w, h):
    import numpy as np
    import cv2
    mask = np.zeros((h, w), np.uint8)
    if polygon:
        p = np.round(np.asarray(polygon) * [w, h]).astype(np.int32)
        cv2.fillPoly(mask, [p], 255)
    return mask


def render_body(result, faces, mask, plates, *, suggested=False):
    import cv2
    import numpy as np
    h, w = mask.shape
    vertices = np.asarray(result['pred_vertices'], dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int32)
    if vertices.shape != (18439, 3) or faces.shape != (36874, 3) or faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError('Unexpected geometry')
    camera = vertices + np.asarray(result['pred_cam_t'])
    focal = float(np.asarray(result['focal_length']).reshape(-1)[0])
    if not np.isfinite(camera).all() or (camera[:, 2] <= 0).any() or not math.isfinite(focal) or focal <= 0:
        raise ValueError('Invalid projection')
    uv = camera[:, :2] / camera[:, 2:3] * focal + [w/2, h/2]
    if np.max(np.abs(uv)) > max(w, h) * 10:
        raise ValueError('Invalid image bounds')
    triangles = camera[faces]
    normals = np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)
    shades = np.abs(np.sum(normals * [0.2, -0.4, -0.89], axis=1)) * .6 + .4
    painted = np.zeros((h, w, 4), np.uint8)
    for idx in np.argsort(triangles[:, :, 2].mean(axis=1))[::-1]:
        polygon = np.round(uv[faces[idx]]).astype(np.int32)
        color = tuple(int(x) for x in np.array([180, 230, 80])*shades[idx]) + (155,)
        cv2.fillConvexPoly(painted, polygon, color, lineType=cv2.LINE_AA)
    silhouette = painted[:, :, 3] > 0
    observed = mask > 127
    overlap = np.logical_and(silhouette, observed).sum() / max(1, np.logical_or(silhouette, observed).sum())
    # Model-to-model agreement is only a coarse misalignment rejection, not a
    # confidence score or technique threshold. Unselected/occluded pixels stay clear.
    if not suggested and overlap < .55:
        return None
    if not suggested:
        painted[:, :, 3][~observed] = 0
    for plate in plates:
        painted[:, :, 3][mask_for(plate, w, h) > 0] = 0
    scale = min(1, (480 if suggested else 640)/max(w, h))
    if scale < 1:
        painted = cv2.resize(painted, (round(w*scale), round(h*scale)), interpolation=cv2.INTER_AREA)
    ok, png = cv2.imencode('.png', painted)
    if not ok or len(png) > 135_000:
        return None
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def analyse(estimator, media, manifest, expires):
    import cv2
    import numpy as np
    import torch
    m = validate_manifest(manifest)
    if not 0 < len(media) <= MAX_BYTES or hashlib.sha256(media).hexdigest() != m['sha256']:
        raise ValueError('Mismatched source')
    frames = []
    plans = m.get('corrections', [])
    motion_clips = []
    with tempfile.TemporaryDirectory(prefix='lift-body-') as root:
        source = Path(root)/'clip.mp4'
        source.write_bytes(media)
        source.chmod(0o600)
        probe = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov',
            '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,width,height', '-of', 'json', str(source)],
            check=True, capture_output=True, timeout=45)
        if len(probe.stdout) > 3_000_000:
            raise ValueError('Oversized frame metadata')
        raw = json.loads(probe.stdout)['frames']
        if not 1 <= len(raw) <= 14400:
            raise ValueError('Invalid decoded count')
        times = [float(f['best_effort_timestamp_time']) for f in raw]
        if any(not finite(t) or not 0 <= t <= 120.2 for t in times) or any(b <= a for a,b in zip(times,times[1:])):
            raise ValueError('Invalid source timing')
        if abs(times[-1]-m['duration']) > .002 or any(f['width'] != m['width'] or f['height'] != m['height'] for f in raw):
            raise ValueError('Mismatched source dimensions')
        wanted = {}
        original_indices = {}
        for f in m['frames']:
            i = min(range(len(times)), key=lambda i: abs(times[i]-f['t']))
            if abs(times[i]-f['t']) > .002 or i in wanted:
                raise ValueError('Evidence frame mismatch')
            wanted[i] = f
            original_indices[i] = f
        plan_indices = []
        for plan in plans:
            start, end = plan['referenceTime'], plan['focusTime']
            picks = sorted(set(min(range(len(times)), key=lambda i:abs(times[i]-t))
                               for t in np.linspace(start,end,min(66,math.ceil((end-start)*24)+1))))
            plan_indices.append(picks)
            for i in picks:
                if i in wanted: continue
                nearest = min(m['frames'],key=lambda f:abs(f['t']-times[i]))
                # Keep a bounded link to the selected person's real mask. Sparse
                # tracking must not turn into invented identity through a gap.
                wanted[i] = {'t':round(times[i],6), 'person':nearest['person'] if abs(nearest['t']-times[i]) <= .14 else None,
                             'plates':[]}
        reconstructed = {}
        cap = cv2.VideoCapture(str(source))
        try:
            for i in range(max(wanted)+1):
                if time.time() >= expires:
                    raise TimeoutError('Body queue expired')
                ok, frame = cap.read()
                if not ok:
                    raise ValueError('Video decode failed')
                if i not in wanted:
                    continue
                f = wanted[i]
                record = {'t': f['t']}
                mask = mask_for(f['person'], m['width'], m['height'])
                ys, xs = np.where(mask > 127)
                if len(xs) >= mask.size * .02:
                    with torch.inference_mode():
                        predictions = estimator.process_one_image(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
                            bboxes=np.array([[xs.min(), ys.min(), xs.max()+1, ys.max()+1]], dtype=np.float32),
                            masks=(mask > 127).astype(np.uint8)[None], inference_type='body')
                    if len(predictions) == 1:
                        prediction = predictions[0]
                        png = render_body(prediction, estimator.faces, mask, f['plates'])
                        if png:
                            record['image'] = png
                            # Keep temporary model parameters only inside this
                            # request; none enter the persistent weights volume.
                            reconstructed[i] = prediction
                if i in original_indices:
                    frames.append(record)
        finally:
            cap.release()
        from correction_engine import solve, frame_target, LANDMARKS
        from collections import Counter
        diagnostics = Counter()
        for plan,picks in zip(plans,plan_indices):
            clip = {'id':plan['id'],'start':plan['referenceTime'],'end':plan['focusTime'],'frames':[]}
            reference = reconstructed.get(picks[0])
            focus = reconstructed.get(picks[-1])
            valid = reference is not None and focus is not None
            if valid:
                for source,points in [(reference,plan['reference']), (focus,plan['observed'])]:
                    actual = np.array([source['pred_keypoints_2d'][LANDMARKS[p['id']]] for p in points])
                    expected = np.array([[p['x']*m['width'],p['y']*m['height']] for p in points])
                    if np.linalg.norm(actual-expected,axis=1).max() > max(m['width'],m['height'])*.035:
                        valid = False
            previous = None
            changed_frames = 0
            focus_solved = False
            for i in picks:
                row = {'t':round(times[i],6)}
                prediction = reconstructed.get(i)
                reason = 'reference_mismatch' if not valid else 'body_unavailable' if prediction is None else 'phase_geometry'
                if valid and prediction is not None:
                    target = frame_target(plan,prediction,reference,m['width'],m['height'])
                    if target is not None:
                        adjusted, report = solve(estimator.model.head_pose,prediction,target,m['width'],m['height'],expires,previous=previous)
                        reason = report['reason']
                        if report['reason'] == 'no_correction': adjusted = prediction
                        if adjusted is not None:
                            png = render_body(adjusted,estimator.faces,np.zeros((m['height'],m['width']),np.uint8),wanted[i]['plates'],suggested=True)
                            if png:
                                row['image'] = png
                                previous = report.get('delta')
                                if report['reason'] == 'solved':
                                    changed_frames += 1
                                    if i == picks[-1]: focus_solved = True
                        else: previous = None
                if 'image' not in row: previous = None
                clip['frames'].append(row)
                diagnostics['rendered' if 'image' in row else reason] += 1
            # An unchanged reconstruction at the start must never masquerade as
            # a correction. Require the actual focus target and a usable motion
            # sequence; an isolated plausible mesh is insufficient.
            coverage = sum('image' in f for f in clip['frames']) / max(1,len(clip['frames']))
            if not focus_solved or changed_frames < 2 or coverage < .85:
                clip['frames'] = [{'t':f['t']} for f in clip['frames']]
                diagnostics['sequence_withheld'] += 1
            motion_clips.append(clip)
        if plans:
            print(json.dumps({'stage':'movement_reconstruction','results':dict(diagnostics)}),flush=True)
    count = sum('image' in f for f in frames)
    motion_count = sum('image' in f for c in motion_clips for f in c['frames'])
    motion_total = sum(len(c['frames']) for c in motion_clips)
    result = {'version': 1, 'model': 'sam-3d-body', 'revision': REVISION, 'sourceSha256': m['sha256'],
            'width': m['width'], 'height': m['height'], 'status': 'tracked' if count == len(frames) else 'partial' if count else 'unavailable',
            'reason': 'Observed body reconstruction at analysed frames; hands and hidden body parts are approximate.' if count else 'No body reconstruction aligned well enough with the selected lifter.',
            'frames': frames}
    if m.get('motionVersion') == 1:
        result['motion'] = {'version':1,'status':'available' if motion_count and motion_count == motion_total else 'partial' if motion_count else 'unavailable',
                       'reason':'Suggested movement for the supported coaching cue. Missing or uncertain frames are left clear.' if motion_count else
                                'No supported movement target could be reconstructed for this review. Use the coaching cue and evidence frames.',
                       'clips':motion_clips}
    return result
