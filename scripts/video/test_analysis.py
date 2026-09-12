"""Synthetic motion tests; no athlete videos or paid model calls."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import cv2
import numpy as np
from types import SimpleNamespace
from pose import visible_points, deny_network, PoseTracker, SubjectTracker

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


def process(directory, fps=60, occluded=False, real=True, track=True, automatic=False):
    fixture(directory, fps, occluded)
    spec = {'id': 'synthetic', 'lift': 'Snatch', 'date': '2026-09-11', 'load': '', 'start': 0, 'end': 120 / fps}
    if automatic:
        spec.update(mode="automatic", start=0, end=120)
    if track:
        spec['calibration'] = {'x':100/320, 'y':330/480, 'diameterPixelsRatio':60/320,
                               'diameterCm':45, 'sideView':True, 'realTime':real}
    with open(os.path.join(directory, 'input.json'), 'w') as f:
        json.dump(spec, f)
    result = subprocess.run([os.environ.get('VIDEO_PYTHON_PATH', sys.executable), str(SCRIPT), directory], capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    with open(os.path.join(directory, 'result.json')) as f:
        return json.load(f)


class AnalysisTests(unittest.TestCase):
    def test_foreground_tracking_keeps_the_lifter_when_spectators_are_present(self):
        def person(cx=.5, cy=.5, size=1):
            result = [SimpleNamespace(x=cx, y=cy, visibility=.99, presence=.99) for _ in range(33)]
            for i, x, y in [(11,-.14,-.22),(12,.14,-.22),(13,-.18,-.08),(14,.18,-.08),(23,-.1,.05),(24,.1,.05),(25,-.1,.2),(26,.1,.2),(27,-.1,.36),(28,.1,.36)]:
                result[i].x, result[i].y = cx+x*size, cy+y*size
            return result
        tracker = SubjectTracker()
        lifter, spectator = person(), person(.8, .35, .5)
        self.assertTrue(tracker.select([lifter, spectator], 0))
        self.assertTrue(tracker.select([spectator, person(.51)], .05))
        self.assertEqual(tracker.select([spectator], .1), [])
        self.assertTrue(tracker.select([person(.52), spectator], .15))
        # A missing subject cannot silently be replaced by another person.
        self.assertEqual(tracker.select([spectator], .2), [])
        self.assertEqual(tracker.select([person(.52)], 1), [])
        self.assertEqual(SubjectTracker().select([person(.4), person(.6)], 0), [])
        ambiguous = SubjectTracker()
        self.assertTrue(ambiguous.select([lifter], 0))
        self.assertEqual(ambiguous.select([person(.49), person(.51)], .05), [])

    @unittest.skipUnless(os.environ.get('VIDEO_POSE_MODEL_PATH'), 'Pose model not configured locally')
    def test_pose_backend_initializes(self):
        tracker = PoseTracker()
        self.assertIsNotNone(tracker.model, tracker.reason)
        tracker.close()

    def test_whole_upload_keeps_late_motion_without_manual_trim(self):
        with tempfile.TemporaryDirectory(prefix='lift-auto-test-') as d:
            a = process(d, fps=4, track=False, automatic=True)['analysis']
            self.assertGreater(a['duration'], 29)
            self.assertEqual(len(a['sampleTimes']), 48)
            self.assertEqual(a['sampleTimes'], sorted(a['sampleTimes']))
            self.assertGreater(a['sampleTimes'][-1], 29)
            self.assertEqual(a['pose']['status'], 'unavailable')
            self.assertEqual(a['pose']['frames'], [])

    def test_pose_highlights_omit_hidden_landmarks_and_multiple_people(self):
        person = [SimpleNamespace(x=.5, y=.5, visibility=.99, presence=.99) for _ in range(33)]
        self.assertEqual(len(visible_points([person])), 16)
        self.assertEqual(visible_points([person, person]), [])
        person[13].visibility = .5
        person[14].x = float('nan')
        person[11].presence = .4
        self.assertNotIn(13, [p['id'] for p in visible_points([person])])
        self.assertNotIn(14, [p['id'] for p in visible_points([person])])
        self.assertNotIn(11, [p['id'] for p in visible_points([person])])

    @unittest.skipUnless(sys.platform == 'linux', 'Production Linux sandbox')
    def test_native_tracking_process_cannot_create_network_sockets(self):
        code = 'from pose import deny_network; import socket; deny_network(); socket.socket()'
        result = subprocess.run([sys.executable, '-c', code], cwd=SCRIPT.parent, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'PermissionError', result.stderr)

    def test_dense_evidence_uses_observed_times_around_the_event(self):
        with tempfile.TemporaryDirectory(prefix='lift-dense-test-') as d:
            process(d, track=False)
            with open(os.path.join(d, 'input.json'), 'w') as f:
                json.dump({'start':0, 'end':1.98, 'phases':[.5, 1.0, 1.5]}, f)
            subprocess.run([sys.executable, str(SCRIPT.with_name('refine.py')), d], check=True, capture_output=True)
            with open(os.path.join(d, 'result.json')) as f:
                result = json.load(f)
            self.assertEqual(len(result['frames']), 8)
            self.assertEqual(len(result['sampleTimes']), 48)
            self.assertTrue(any(abs(t-.5) < .001 for t in result['sampleTimes']))
            self.assertTrue(any(abs(t-(.5+1/12)) < .002 for t in result['sampleTimes']))
            self.assertTrue(all(0 <= t <= 1.98 for t in result['sampleTimes']))
            self.assertEqual(result['pose']['version'], 2)
            self.assertTrue(all(any(abs(f['t']-t) < .00001 for t in result['sampleTimes']) for f in result['pose']['frames']))

    def test_known_motion_and_timestamps(self):
        with tempfile.TemporaryDirectory(prefix='lift-motion-test-') as d:
            out = process(d)
            a, t = out['analysis'], out['analysis']['tracking']
            self.assertEqual(a['frameCount'], 120)
            self.assertEqual(len(out['frames']), 8)
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
            self.assertEqual(len(a['sampleTimes']), 48)


if __name__ == '__main__':
    unittest.main()
