import { correctionReview } from "./correction";
import { interpolateJoints } from "../../lib/video/overlay-timeline";

// Synthetic motion for frame-timing/IK regression, never a real technique label.
export function formGuideReview() {
  const review = correctionReview(),
    a = review.analysis!;
  const [reference, focus] = a.pose!.frames;
  a.identification!.phases.unshift({
    kind: "front_rack_hold",
    time: 0,
    frame: 1,
    evidence: "Synthetic rack hold",
  });
  a.pose!.frames = Array.from({ length: 40 }, (_, i) => {
    const t = i / 20;
    const u = Math.min(1, Math.max(0, Math.sin((t / 2) * Math.PI)));
    return { t, points: interpolateJoints(reference.points, focus.points, u) };
  });
  a.segmentation = {
    version: 1,
    model: "sam3.1",
    revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7",
    sourceSha256: "a".repeat(64),
    width: 320,
    height: 480,
    status: "tracked",
    reason: "Synthetic contour",
    frames: Array.from({ length: 24 }, (_, i) => ({
      t: i / 12,
      objects: [
        {
          id: "person-1",
          kind: "person" as const,
          polygon: [
            [0.35 + i * 0.001, 0.2],
            [0.7 + i * 0.001, 0.2],
            [0.7 + i * 0.001, 0.9],
            [0.35 + i * 0.001, 0.9],
          ] as [number, number][],
        },
      ],
    })),
  };
  a.tracking.points = Array.from({ length: 40 }, (_, i) => ({
    t: i / 20,
    x: 0.65,
    y: 0.8 - i * 0.01,
    score: 1,
  }));
  return review;
}
