"""Deterministic public-free tracking tests: geometry, occlusion and identity."""
import unittest
from unittest.mock import patch
import cv2
import numpy as np
from automatic_bar import AutomaticBarTracker
from overlay_recovery import selected_pose
from types import SimpleNamespace


def frame(i=0, hidden=False, wrong_colour=False):
    image=np.full((480,640,3),35,np.uint8)
    x,y=140+i,340-i*2
    # A bigger background plate must not win without a visible grip-line match.
    cv2.circle(image,(470,90),50,(30,210,230),-1)
    if not hidden:
        cv2.ellipse(image,(x,y),(23,36),0,0,360,(220,60,30) if wrong_colour else (30,210,230),-1)
        cv2.circle(image,(x,y),5,(230,230,230),-1)
        for dx,dy in [(-8,-19),(10,18),(8,-12),(-10,12)]:
            cv2.circle(image,(x+dx,y+dy),2,(40,40,40),-1)
    hands=[{'id':15,'x':220/640,'y':y/480},{'id':16,'x':340/640,'y':y/480}]
    return image,hands


class AutomaticOverlayTests(unittest.TestCase):
    def test_automatic_plate_follows_pixels_without_calibration_or_physical_claims(self):
        tracker=AutomaticBarTracker()
        for i in range(24):tracker.add(*frame(i),i/20)
        result=tracker.result(24)
        self.assertGreater(len(result['points']),20)
        for p in result['points']:
            i=round(p['t']*20)
            self.assertLess(abs(p['x']*640-(140+i)),3)
            self.assertLess(abs(p['y']*480-(340-i*2)),3)
        self.assertIsNone(result['peakUpwardVelocity'])
        self.assertIsNone(result['riseCm'])
        self.assertIsNone(result['horizontalRangeCm'])
        self.assertEqual(result['velocities'],[])

    def test_missing_hands_cannot_seed_a_background_plate(self):
        tracker=AutomaticBarTracker()
        for i in range(8):tracker.add(frame(i)[0],[],i/20)
        self.assertEqual(tracker.result(8)['points'],[])

    def test_occlusion_ends_the_track_instead_of_switching_identity(self):
        tracker=AutomaticBarTracker()
        for i in range(8):tracker.add(*frame(i),i/20)
        for i in range(8,18):tracker.add(*frame(i,hidden=True),i/20)
        count=len(tracker.points)
        self.assertTrue(tracker.stopped)
        for i in range(18,28):tracker.add(*frame(i,wrong_colour=True),i/20)
        self.assertEqual(len(tracker.points),count)
        self.assertLess(tracker.points[-1]['t'],.5)

    def test_decoder_gap_is_not_extrapolated(self):
        tracker=AutomaticBarTracker()
        for i in range(6):tracker.add(*frame(i),i/20)
        count=len(tracker.points)
        tracker.add(*frame(7),2)
        self.assertEqual(len(tracker.points),count)
        self.assertTrue(tracker.stopped)

    def test_crop_landmarks_map_back_to_the_selected_person_only(self):
        image=np.zeros((480,640,3),np.uint8)
        polygon=[[.25,.1],[.65,.1],[.65,.9],[.25,.9]]
        landmarks=[SimpleNamespace(x=.5,y=.5,visibility=.99,presence=.99) for _ in range(33)]
        tracker=SimpleNamespace(model=SimpleNamespace(detect_for_video=lambda image,time:SimpleNamespace(pose_landmarks=[landmarks])),
            mp=SimpleNamespace(Image=lambda **args:args,ImageFormat=SimpleNamespace(SRGB=1)))
        points=selected_pose(tracker,image,polygon,.5)
        self.assertTrue(points)
        self.assertTrue(all(.25<=p['x']<=.65 and .1<=p['y']<=.9 for p in points))
        tracker.model.detect_for_video=lambda image,time:SimpleNamespace(pose_landmarks=[landmarks,landmarks])
        self.assertEqual(selected_pose(tracker,image,polygon,.6),[])


if __name__=='__main__':unittest.main()
