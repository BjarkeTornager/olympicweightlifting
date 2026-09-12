"""Inspect observed SAM 3D Body geometry against its exact source image/mask.

This checks projection plumbing and mask overlap, not biomechanical accuracy.
No model credentials, network access or app records are used by this command.
"""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


def project(points, translation, focal, width, height):
    camera = np.asarray(points, dtype=np.float64) + np.asarray(translation, dtype=np.float64)
    if camera.ndim != 2 or camera.shape[1] != 3 or not np.isfinite(camera).all() or (camera[:, 2] <= 0).any():
        raise ValueError("Invalid or behind-camera geometry")
    return camera[:, :2] / camera[:, 2:3] * focal + [width / 2, height / 2]


def inspect(source, mask_path, result_path, output):
    data = json.loads(Path(result_path).read_text())
    if data.get("kind") != "observed_body_only":
        raise ValueError("Expected observed-body geometry, never corrected-form geometry")
    if (hashlib.sha256(Path(source).read_bytes()).hexdigest() != data.get("sourceSha256")
            or hashlib.sha256(Path(mask_path).read_bytes()).hexdigest() != data.get("maskSha256")):
        raise ValueError("Geometry must belong to these exact source image and mask bytes")
    frame = cv2.imread(str(source))
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if frame is None or mask is None or frame.shape[:2] != mask.shape:
        raise ValueError("Source image and mask must match")
    height, width = mask.shape
    if (data["width"], data["height"]) != (width, height):
        raise ValueError("Geometry must match source dimensions")
    g = data["geometry"]
    vertices = np.asarray(g["pred_vertices"], dtype=np.float64)
    faces = np.asarray(g["faces"], dtype=np.int32)
    if vertices.shape != (18439, 3) or faces.shape != (36874, 3) or faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError("Unexpected mesh topology")
    focal = float(np.asarray(g["focal_length"]).reshape(-1)[0])
    if not np.isfinite(focal) or focal <= 0:
        raise ValueError("Invalid camera estimate")
    translation = np.asarray(g["pred_cam_t"])
    uv = project(vertices, translation, focal, width, height)
    keypoints = project(g["pred_keypoints_3d"], translation, focal, width, height)
    predicted = np.asarray(g["pred_keypoints_2d"])
    if keypoints.shape != predicted.shape or not np.isfinite(predicted).all():
        raise ValueError("Mismatched keypoint projections")
    error = np.linalg.norm(keypoints - predicted, axis=1)
    if np.max(np.abs(uv)) > max(width, height) * 10:
        raise ValueError("Projection is outside reasonable image bounds")
    triangles = vertices[faces]
    depth = triangles[:, :, 2].mean(axis=1)
    normals = np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)
    shades = np.abs(np.sum(normals * [0.2, -0.4, -0.89], axis=1)) * 0.6 + 0.4
    if not np.isfinite(shades).all():
        raise ValueError("Invalid mesh normals")
    painted = frame.copy()
    silhouette = np.zeros(mask.shape, np.uint8)
    for idx in np.argsort(depth)[::-1]:
        polygon = np.round(uv[faces[idx]]).astype(np.int32)
        color = tuple(int(v) for v in (np.array([175, 220, 65]) * shades[idx]))
        cv2.fillConvexPoly(painted, polygon, color, lineType=cv2.LINE_AA)
        cv2.fillConvexPoly(silhouette, polygon, 255)
    mixed = cv2.addWeighted(frame, 0.35, painted, 0.65, 0)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(mixed, contours, -1, (80, 210, 255), 1)
    observed, reconstructed = mask > 127, silhouette > 127
    union = np.logical_or(observed, reconstructed).sum()
    overlap = float(np.logical_and(observed, reconstructed).sum()/max(union, 1))
    panel = np.hstack([frame, mixed])
    footer = np.full((70, panel.shape[1], 3), 250, dtype=np.uint8)
    cv2.putText(footer, "Original public frame", (20, 28), cv2.FONT_HERSHEY_SIMPLEX, .6, (40, 40, 40), 1)
    cv2.putText(footer, "Observed 3D reconstruction (not corrected form)", (width+20, 28), cv2.FONT_HERSHEY_SIMPLEX, .6, (40, 40, 40), 1)
    cv2.putText(footer, "Yellow: SAM 3.1 outline. Teal: projected body mesh.", (width+20, 53), cv2.FONT_HERSHEY_SIMPLEX, .5, (40, 40, 40), 1)
    if not cv2.imwrite(str(output), np.vstack([panel, footer])):
        raise ValueError("Could not write the inspection image")
    report = {"samMaskOverlap": round(overlap, 4), "projectionConsistencyMaxPixels": round(float(error.max()), 5),
              "projectionConsistencyMeanPixels": round(float(error.mean()), 5), "vertices": len(vertices),
              "keypoints": len(keypoints), "meaning": "model-to-model mask agreement and internal projection consistency, not ground-truth pose accuracy"}
    Path(str(output)+".json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source"); parser.add_argument("mask"); parser.add_argument("result"); parser.add_argument("output")
    args = parser.parse_args()
    print(json.dumps(inspect(args.source, args.mask, args.result, args.output)))
