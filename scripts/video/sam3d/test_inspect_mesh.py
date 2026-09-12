import unittest
import json
import tempfile
from pathlib import Path
import numpy as np
from inspect_mesh import inspect, project


class ProjectionTest(unittest.TestCase):
    def test_camera_translation_and_non_square_image_center(self):
        actual = project([[0, 0, 0], [1, 1, 1]], [0, 0, 4], 500, 960, 540)
        np.testing.assert_allclose(actual, [[480, 270], [580, 370]])

    def test_mirror_does_not_flip_vertical_axis(self):
        actual = project([[-1, 1, 1], [1, 1, 1]], [0, 0, 4], 500, 320, 480)
        np.testing.assert_allclose(actual, [[60, 340], [260, 340]])

    def test_invalid_depth_and_nonfinite_points_cannot_be_rendered(self):
        for points in [[[0, 0, -4]], [[0, 0, -5]], [[float('nan'), 0, 0]]]:
            with self.assertRaises(ValueError):
                project(points, [0, 0, 4], 500, 960, 540)

    def test_wrong_source_frame_is_rejected_before_rendering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'frame.jpg').write_bytes(b'a different frame')
            (root / 'mask.png').write_bytes(b'a mask')
            (root / 'result.json').write_text(json.dumps({
                'kind': 'observed_body_only', 'sourceSha256': '0' * 64, 'maskSha256': '0' * 64,
            }))
            with self.assertRaisesRegex(ValueError, 'exact source image'):
                inspect(root / 'frame.jpg', root / 'mask.png', root / 'result.json', root / 'output.jpg')
            self.assertFalse((root / 'output.jpg').exists())


if __name__ == '__main__':
    unittest.main()
