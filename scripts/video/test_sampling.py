import unittest
from sampling import evidence_indices


class SamplingTests(unittest.TestCase):
    def test_front_rack_to_overhead_transition_has_dense_coverage(self):
        times = [i/30 for i in range(541)]
        phases = [6, 7.1, 7.6, 9.7]
        selected = [times[i] for i in evidence_indices(times, 0, 18, phases)]
        self.assertEqual(len(selected), 48)
        self.assertEqual(len(set(selected)), 48)
        self.assertTrue(all(t in selected for t in phases))
        transition = [t for t in selected if 7.6 <= t <= 9.7]
        self.assertLessEqual(max(b-a for a, b in zip(transition, transition[1:])), .25)
        self.assertEqual((selected[0], selected[-1]), (0, 18))

    def test_unknown_phases_and_irregular_timestamps_keep_full_coverage(self):
        times = [i*.041 + (i%3)*.002 for i in range(300)]
        selected = [times[i] for i in evidence_indices(times, 1, 11, [])]
        self.assertEqual(len(set(selected)), 48)
        self.assertTrue(all(1 <= t <= 11.001 for t in selected))
        self.assertLess(max(b-a for a, b in zip(selected, selected[1:])), .42)

    def test_short_clips_repeat_real_frames_without_inventing_times(self):
        times = [0, .03, .07, .1]
        selected = evidence_indices(times, 0, .1, [.03, .07])
        self.assertEqual(len(selected), 48)
        self.assertEqual(set(selected), {0, 1, 2, 3})
        self.assertEqual(selected, sorted(selected))

    def test_no_frames_outside_attempt(self):
        times = [i/30 for i in range(600)]
        selected = evidence_indices(times, 5, 9, [1, 6, 7, 18])
        self.assertTrue(all(5 <= times[i] <= 9 for i in selected))


if __name__ == "__main__":
    unittest.main()
