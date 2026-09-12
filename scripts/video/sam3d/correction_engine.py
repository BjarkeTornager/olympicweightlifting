"""Constrained MHR reposing of a supplied, independently supported 2D target.

This module does not detect faults or invent an ideal lift. Shape, scale, camera,
depth and hand articulation are immutable. Image-plane root motion is bounded. Targets originate from the
application's phase-specific correction builder, never arbitrary model text.
"""
import math
import time

# MediaPipe's visible body landmarks to the pinned model's MHR70 convention.
LANDMARKS = {11: 5, 12: 6, 13: 7, 14: 8, 15: 62, 16: 41,
             23: 9, 24: 10, 25: 11, 26: 12, 27: 13, 28: 14,
             29: 17, 30: 20, 31: 15, 32: 18}
CONTACTS = [5, 6, 7, 8, 13, 14, 15, 16, 17, 18, 19, 20, 41, 62]
# From the pinned MHR compact parameter layout. Do not optimize translations,
# body scales, face, hand articulation, or the six global transform parameters.
POSE_INDICES = list(range(6, 68)) + list(range(122, 130))


def validate_target(target):
    if not isinstance(target, dict) or set(target) != {'id', 'observed', 'suggested'}:
        raise ValueError('Invalid correction target')
    if not isinstance(target['id'], str) or not 1 <= len(target['id']) <= 100:
        raise ValueError('Invalid correction id')
    ids = None
    for name in ('observed', 'suggested'):
        points = target[name]
        if not isinstance(points, list) or not 8 <= len(points) <= 16:
            raise ValueError('Invalid correction landmarks')
        current = []
        for p in points:
            if not isinstance(p, dict) or set(p) != {'id', 'x', 'y'} or type(p['id']) is not int or p['id'] not in LANDMARKS:
                raise ValueError('Invalid correction point')
            if any(type(p[k]) not in (int, float) or not math.isfinite(p[k]) or not 0 <= p[k] <= 1 for k in ('x', 'y')):
                raise ValueError('Invalid correction coordinate')
            current.append(p['id'])
        if len(set(current)) != len(current) or (ids is not None and current != ids):
            raise ValueError('Mismatched correction landmarks')
        ids = current
    sides = [[11+s, 13+s, 15+s, 23+s, 25+s, 27+s, 29+s, 31+s] for s in (0, 1)]
    if not any(set(side).issubset(ids) for side in sides):
        raise ValueError('Correction needs a visible arm, trunk, leg and foot')
    for observed, suggested in zip(target['observed'], target['suggested']):
        if observed['id'] not in (23, 24, 25, 26) and observed != suggested:
            raise ValueError('This correction must preserve shoulder, hand and foot contacts')
        if math.hypot(observed['x']-suggested['x'], observed['y']-suggested['y']) > .15:
            raise ValueError('Excessive correction displacement')
    return target


def solve(head, prediction, target, width, height, expires, steps=120, previous=None):
    import numpy as np
    import torch
    validate_target(target)
    device = head.keypoint_mapping.device
    tensor = lambda a: torch.tensor(np.asarray(a), dtype=torch.float32, device=device)
    original = tensor(prediction['mhr_model_params'])[None]
    shape = tensor(prediction['shape_params'])[None]
    camera = tensor(prediction['pred_cam_t'])
    focal = float(np.asarray(prediction['focal_length']).reshape(-1)[0])
    if original.shape != (1, 204) or shape.shape != (1, 45):
        raise ValueError('Unexpected rig parameters')
    flip = tensor([1., -1., -1.])
    center = tensor([width/2, height/2])
    indices = torch.tensor(POSE_INDICES, device=device)

    def forward(params, translation=None):
        verts, skeleton = head.mhr(shape, params, torch.zeros((1, 72), device=device))
        vertices = verts[0] / 100 * flip
        joints = skeleton[0, :, :3] / 100 * flip
        points = head.keypoint_mapping[:70] @ torch.cat([vertices, joints], dim=0)
        if translation is not None:
            shift = torch.cat([translation, torch.zeros(1,device=device)])
            vertices = vertices + shift
            points = points + shift
        return vertices, points

    def project(points):
        xyz = points + camera
        return xyz[:, :2] / xyz[:, 2:3].clamp(min=.01) * focal + center

    with torch.no_grad():
        baseline_vertices, baseline = forward(original)
        if not torch.isfinite(baseline).all() or (baseline+camera)[:, 2].min() <= 0:
            return None, {'reason': 'invalid_projection'}
        error = (baseline_vertices-tensor(prediction['pred_vertices'])).norm(dim=-1).max().item()
        if error > .0001:
            return None, {'reason': 'rig_roundtrip', 'error': error}
        projected = project(baseline)
    point_indices = [LANDMARKS[p['id']] for p in target['observed']]
    observed = tensor([[p['x']*width, p['y']*height] for p in target['observed']])
    desired = tensor([[p['x']*width, p['y']*height] for p in target['suggested']])
    # The independent visible pose must agree with this reconstructed person.
    if (projected[point_indices]-observed).norm(dim=-1).max().item() > max(width, height)*.035:
        return None, {'reason': 'landmark_mismatch'}
    displacement = desired-observed
    if displacement.norm(dim=-1).max().item() < 1:
        return None, {'reason': 'no_correction'}
    # Apply the supported delta to the rig's own positions, so a small difference
    # between two estimators does not become a second, unrequested correction.
    targets = projected[point_indices] + displacement
    delta = torch.zeros((1, len(POSE_INDICES)), device=device, requires_grad=True)
    root = torch.zeros(2, device=device, requires_grad=True)
    optimizer = torch.optim.Adam([{'params':[delta], 'lr':.012}, {'params':[root], 'lr':.002}])
    prior = tensor(previous) if previous is not None else None
    if prior is not None:
        with torch.no_grad(): delta.copy_(prior.clamp(-.35,.35))
    normalizer = max(width, height)
    def objective():
        if time.time() >= expires:
            raise TimeoutError('Correction solve expired')
        params = original.index_add(1, indices, delta.clamp(-.35,.35))
        vertices, points = forward(params, root.clamp(-.12,.12))
        loss = ((project(points)[point_indices]-targets)/normalizer).square().mean()*4000
        loss = loss + (points[CONTACTS]-baseline[CONTACTS]).square().mean()*1200
        loss = loss + (points[:21]-baseline[:21]).square().mean()*2
        loss = loss + delta.square().mean()*.08
        loss = loss + root.square().mean()*.1
        if prior is not None:
            loss = loss + (delta-prior).square().mean()*.02
        return loss
    for _ in range(steps):
        optimizer.zero_grad(set_to_none=True)
        loss = objective()
        if not torch.isfinite(loss):
            return None, {'reason': 'non_finite_solve'}
        loss.backward()
        optimizer.step()
        with torch.no_grad():
            delta.clamp_(-.35, .35)
            root.clamp_(-.12,.12)
    # Finish the fit with a line-search solver instead of loosening acceptance
    # tolerances when first-order optimization stalls near a contact constraint.
    refine = torch.optim.LBFGS([delta,root],lr=.6,max_iter=25,max_eval=35,history_size=10,line_search_fn='strong_wolfe')
    def closure():
        refine.zero_grad(set_to_none=True)
        loss = objective()
        if not torch.isfinite(loss): raise ValueError('Non-finite correction fit')
        loss.backward()
        return loss
    refine.step(closure)
    with torch.no_grad():
        delta.clamp_(-.35,.35); root.clamp_(-.12,.12)
        vertices, points = forward(original.index_add(1, indices, delta), root)
        projected_target_error = (project(points)[point_indices]-targets).norm(dim=-1).max().item()
        contact_error = (points[CONTACTS]-baseline[CONTACTS]).norm(dim=-1).max().item()
        moved = (vertices-baseline_vertices).norm(dim=-1).max().item()
        if (not torch.isfinite(vertices).all() or (vertices+camera)[:, 2].min() <= 0
                or projected_target_error > max(2.5, normalizer*.006)
                or contact_error > .012 or moved > .20):
            return None, {'reason': 'constraints', 'targetErrorPixels': projected_target_error,
                          'contactError': contact_error, 'maxDisplacement': moved,
                          'maxAngleDelta': delta.abs().max().item(), 'rootShift': root.detach().cpu().tolist()}
        return {**prediction, 'pred_vertices': vertices.cpu().numpy()}, {
            'reason': 'solved', 'targetErrorPixels': projected_target_error,
            'contactError': contact_error, 'maxDisplacement': moved,
            'identityUnchanged': True,
            'delta': delta.detach().cpu().tolist(),
        }


def validate_plan(plan):
    if not isinstance(plan, dict) or set(plan) != {'id','issue','referenceTime','focusTime','side','reference','observed','suggested'}:
        raise ValueError('Invalid movement plan')
    if plan['issue'] not in ('early_pull_posture', 'jerk_dip_posture') or plan['side'] not in ('left','right'):
        raise ValueError('Unsupported movement plan')
    if any(type(plan[k]) not in (int,float) or not math.isfinite(plan[k]) for k in ('referenceTime','focusTime')):
        raise ValueError('Invalid movement times')
    if not 0 <= plan['referenceTime'] < plan['focusTime'] <= 120.2 or not .08 <= plan['focusTime']-plan['referenceTime'] <= 2.5:
        raise ValueError('Invalid movement span')
    validate_target({k:plan[k] for k in ('id','observed','suggested')})
    validate_target({'id':plan['id'],'observed':plan['reference'],'suggested':plan['reference']})
    if [p['id'] for p in plan['reference']] != [p['id'] for p in plan['observed']]:
        raise ValueError('Mismatched reference')
    side = 0 if plan['side'] == 'left' else 1
    if not {11+side,13+side,15+side,23+side,25+side,27+side,29+side,31+side}.issubset({p['id'] for p in plan['observed']}):
        raise ValueError('Mismatched correction side')
    return plan


def frame_target(plan, prediction, reference_prediction, width, height):
    """Maintain the approved earlier trunk orientation through this phase only.

    The rig's earlier posture cancels small offsets between the pose estimators.
    An analytic leg solve keeps its planted foot and limb lengths unchanged.
    """
    import numpy as np
    side = 0 if plan['side'] == 'left' else 1
    ids = [11+side,13+side,15+side,23+side,25+side,27+side,29+side,31+side]
    points = np.asarray(prediction['pred_keypoints_2d'], dtype=float)
    prior = np.asarray(reference_prediction['pred_keypoints_2d'], dtype=float)
    p = {i:points[LANDMARKS[i]] for i in ids}
    r = {i:prior[LANDMARKS[i]] for i in ids}
    hip, shoulder, wrist, elbow = [p[i] for i in [23+side,11+side,15+side,13+side]]
    length = np.linalg.norm(shoulder-hip)
    angle = lambda s,h: math.atan2(s[0]-h[0], -(s[1]-h[1]))
    now, before = angle(shoulder,hip), angle(r[11+side],r[23+side])
    delta = before-now
    # Never illustrate normal extension, a reverse adjustment, moving feet or
    # an increasing departure from the approved reference. Bounds are rejection
    # limits for this illustration, not measured athlete metrics.
    if (length < height*.10 or length > height*.55 or abs(delta) > math.radians(18)
        or any(np.linalg.norm(p[i]-r[i]) > height*.025 for i in [27+side,29+side,31+side])
        or shoulder[1] >= hip[1]):
        return None
    if plan['issue'] == 'early_pull_posture' and wrist[1] < p[25+side][1]:
        return None
    if plan['issue'] == 'jerk_dip_posture' and (np.linalg.norm(wrist-shoulder) > length*.5 or abs(before) > math.radians(15)):
        return None
    if abs(now) < abs(before):
        delta = 0
    target_hip = shoulder - length*np.array([math.sin(now+delta), -math.cos(now+delta)])
    knee, ankle = p[25+side], p[27+side]
    thigh, shin = np.linalg.norm(hip-knee), np.linalg.norm(knee-ankle)
    span = np.linalg.norm(ankle-target_hip)
    if span < height*.01 or span > thigh+shin+1e-7 or span < abs(thigh-shin) or np.linalg.norm(target_hip-hip) > height*.08:
        return None
    along = (thigh**2-shin**2+span**2)/(2*span)
    offset = math.sqrt(max(0,thigh**2-along**2))
    direction = (ankle-target_hip)/span
    perpendicular = np.array([-direction[1],direction[0]])
    target_knee = min([target_hip+direction*along+s*perpendicular*offset for s in (-1,1)], key=lambda q:np.linalg.norm(q-knee))
    if np.linalg.norm(target_knee-knee) > height*.08:
        return None
    normal = np.array([width,height])
    observed = [{'id':i,'x':float(p[i][0]/width),'y':float(p[i][1]/height)} for i in ids]
    suggested = [{**v} for v in observed]
    for id, value in [(23+side,target_hip),(25+side,target_knee)]:
        q = suggested[ids.index(id)]; q['x'],q['y'] = (value/normal).tolist()
    target = {'id':plan['id'],'observed':observed,'suggested':suggested}
    try: return validate_target(target)
    except ValueError: return None
