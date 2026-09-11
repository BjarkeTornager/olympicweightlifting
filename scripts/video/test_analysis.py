"""Synthetic motion tests; no athlete videos or paid model calls."""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
import cv2
import numpy as np

SCRIPT = pathlib.Path(__file__).with_name('analyse.py')


def fixture(directory, fps=60, occluded=False):
    path = os.path.join(directory, 'source')
    output = path + '.mp4'
    writer = cv2.VideoWriter(output, cv2.VideoWriter_fourcc(*'mp4v'), fps, (320, 480))
    for i in range(120):
        frame = np.full((480, 320, 3), (28, 37, 45), dtype=np.uint8)
        if not occluded or i < 60:
            cx, cy = 100 + round(i / 5), 330 - i
            cv2.circle(frame, (cx, cy), 30, (220, 180, 40), -1)
            cv2.circle(frame, (cx, cy), 24, (35, 55, 75), 3)
            cv2.circle(frame, (cx, cy), 7, (240, 240, 240), -1)
            cv2.line(frame, (cx - 19, cy - 12), (cx + 12, cy + 19), (65, 85, 25), 4)
        writer.write(frame)
    writer.release()
    os.rename(output, path)


def process(directory, fps=60, occluded=False, real=True, track=True):
    fixture(directory, fps, occluded)
    spec = {'id': 'synthetic', 'lift': 'Snatch', 'date': '2026-09-11', 'load': '', 'start': 0, 'end': 120 / fps}
    if track:
        spec['calibration'] = {'x':100/320, 'y':330/480, 'diameterPixelsRatio':60/320,
                               'diameterCm':45, 'sideView':True, 'realTime':real}
    with open(os.path.join(directory, 'input.json'), 'w') as f:
        json.dump(spec, f)
    result = subprocess.run([os.environ.get('VIDEO_PYTHON_PATH', 'python3'), str(SCRIPT), directory], capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    with open(os.path.join(directory, 'result.json')) as f:
        return json.load(f)


class AnalysisTests(unittest.TestCase):
    def test_known_motion_and_timestamps(self):
        with tempfile.TemporaryDirectory(prefix='lift-motion-test-') as d:
            out = process(d)
            a, t = out['analysis'], out['analysis']['tracking']
            self.assertEqual(a['frameCount'], 120)
            self.assertEqual(len(out['frames']), 4)
            self.assertEqual(t['status'], 'tracked')
            self.assertAlmostEqual(t['riseCm'], 89.25, delta=1.5)
            self.assertAlmostEqual(t['horizontalRangeCm'], 18, delta=1.5)
            self.assertAlmostEqual(t['peakUpwardVelocity'], .45, delta=.06)
            self.assertAlmostEqual(a['sampleTimes'][-1], 119/60, delta=.002)
            self.assertGreater(os.path.getsize(os.path.join(d, 'media.mp4')), 1000)

    def test_occlusion_stops_without_fabricated_metrics(self):
        with tempfile.TemporaryDirectory(prefix='lift-occlusion-test-') as d:
            t = process(d, occluded=True)['analysis']['tracking']
            self.assertEqual(t['status'], 'partial')
            self.assertLess(t['coverage'], .6)
            self.assertIsNone(t['peakUpwardVelocity'])
            self.assertIsNone(t['riseCm'])
            self.assertEqual(t['velocities'], [])

    def test_unknown_real_time_withholds_velocity(self):
        with tempfile.TemporaryDirectory(prefix='lift-timing-test-') as d:
            t = process(d, real=False)['analysis']['tracking']
            self.assertEqual(t['status'], 'tracked')
            self.assertIsNone(t['peakUpwardVelocity'])
            self.assertEqual(t['velocities'], [])

    def test_video_feedback_does_not_require_calibration(self):
        with tempfile.TemporaryDirectory(prefix='lift-frames-test-') as d:
            a = process(d, track=False)['analysis']
            self.assertEqual(a['tracking']['status'], 'not_requested')
            self.assertEqual(len(a['sampleTimes']), 24)


if __name__ == '__main__':
    unittest.main()
