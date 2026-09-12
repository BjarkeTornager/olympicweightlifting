import copy
import unittest
import numpy as np
from correction_engine import validate_target, validate_plan, frame_target, LANDMARKS

class CorrectionTest(unittest.TestCase):
    def setUp(self):
        self.width,self.height=320,480
        self.ids=[11,13,15,23,25,27,29,31]
        ref=[[100,80],[130,100],[140,110],[100,200],[120,270],[100,330],[90,340],[120,340]]
        now=[[115,90],[140,110],[140,110],[100,210],[120,270],[100,330],[90,340],[120,340]]
        now[1]=[150,125]
        def prediction(values):
            points=np.zeros((70,2))
            for id,point in zip(self.ids,values):points[LANDMARKS[id]]=point
            return {'pred_keypoints_2d':points}
        self.ref,self.now=prediction(ref),prediction(now)
        def normalized(values):return [{'id':id,'x':x/320,'y':y/480} for id,(x,y) in zip(self.ids,values)]
        self.plan={'id':'synthetic','issue':'jerk_dip_posture','side':'left','referenceTime':.5,'focusTime':1,
                   'reference':normalized(ref),'observed':normalized(now),'suggested':normalized(now)}

    def test_reposing_changes_trunk_without_changing_projected_contacts_or_arm_lengths(self):
        target=frame_target(self.plan,self.now,self.ref,320,480)
        self.assertIsNotNone(target)
        observed={p['id']:np.array([p['x']*320,p['y']*480]) for p in target['observed']}
        suggested={p['id']:np.array([p['x']*320,p['y']*480]) for p in target['suggested']}
        self.assertLess(abs(suggested[11][0]-suggested[23][0]),abs(observed[11][0]-observed[23][0]))
        for id in [11,13,15,27,29,31]:np.testing.assert_array_equal(observed[id],suggested[id])
        for a,b in [(11,13),(13,15),(11,23),(23,25),(25,27)]:self.assertAlmostEqual(np.linalg.norm(observed[a]-observed[b]),np.linalg.norm(suggested[a]-suggested[b]))

    def test_missing_contacts_wrong_phase_and_excessive_movement_are_rejected(self):
        plan=copy.deepcopy(self.plan);plan['side']='right'
        with self.assertRaises(ValueError):validate_plan(plan)
        target={k:copy.deepcopy(self.plan[k]) for k in ['id','observed','suggested']}
        target['suggested'][-1]['x']+=.01
        with self.assertRaises(ValueError):validate_target(target)
        target['suggested'][-1]['x']=float('nan')
        with self.assertRaises(ValueError):validate_target(target)
        plan=copy.deepcopy(self.plan);plan['issue']='early_pull_posture'
        self.assertIsNone(frame_target(plan,self.now,self.ref,320,480))
        moved=copy.deepcopy(self.now);moved['pred_keypoints_2d'][LANDMARKS[27]][0]+=30
        self.assertIsNone(frame_target(self.plan,moved,self.ref,320,480))

if __name__=='__main__':unittest.main()
