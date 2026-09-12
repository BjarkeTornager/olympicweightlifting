import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from fastapi.testclient import TestClient
from engine import adapt_multiplex_state, analyse, infer_frames, mask_outline, sample_indices, select_subjects, validate_manifest
from gateway import create_app

DATA = b"synthetic video"
MANIFEST = dict(version=1, sha256=hashlib.sha256(DATA).hexdigest(), width=320,height=480,
                duration=2,sampleTimes=[0,1,2],anchors=[])
TOKEN = "fixture-secret-not-a-real-token-12345"


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        async def segment(data, manifest):
            self.calls.append((data, manifest))
            return {"fixture": True}
        self.client = TestClient(create_app(segment, TOKEN))
        self.headers = {"Authorization": f"Bearer {TOKEN}","Content-Type":"video/mp4",
                        "X-SAM3-Manifest":json.dumps(MANIFEST)}

    def test_auth_before_gpu_or_body_processing(self):
        for path in ["/", "/docs", "/openapi.json"]:
            self.assertEqual(self.client.get(path).status_code,404)
        r = self.client.post("/segment",content=DATA)
        self.assertEqual(r.status_code,401)
        self.assertEqual(self.calls,[])

    def test_valid_binary_request(self):
        r = self.client.post("/segment",headers=self.headers,content=DATA)
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.headers["cache-control"],"no-store")
        self.assertEqual(self.calls,[(DATA,MANIFEST)])

    def test_bad_hash_and_arbitrary_remote_url_never_reach_gpu(self):
        r = self.client.post("/segment",headers=self.headers,content=b"different video")
        self.assertEqual(r.status_code,400)
        headers = dict(self.headers)
        headers["X-SAM3-Manifest"] = json.dumps({**MANIFEST,"url":"http://internal"})
        self.assertEqual(self.client.post("/segment",headers=headers,content=DATA).status_code,400)
        self.assertEqual(self.calls,[])

    def test_large_body_and_provider_errors(self):
        import gateway
        before = gateway.MAX_BYTES
        gateway.MAX_BYTES = 3
        try:
            self.assertEqual(self.client.post("/segment",headers=self.headers,content=DATA).status_code,413)
        finally:
            gateway.MAX_BYTES = before
        async def failed(*args):
            raise RuntimeError("private path and secret")
        client = TestClient(create_app(failed,TOKEN))
        response = client.post("/segment",headers=self.headers,content=DATA)
        self.assertEqual(response.status_code,503)
        self.assertNotIn("secret",response.text)


def box(key, kind, x=.2, y=.1, w=.6, h=.8):
    return {"id":key,"kind":kind,"polygon":[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]}


class EvidenceTests(unittest.TestCase):
    def test_multiplex_adapter_preserves_video_offload_and_rejects_state_offload(self):
        from types import SimpleNamespace
        calls = []
        def init_state(resource_path, offload_video_to_cpu=False, async_loading_frames=False):
            calls.append((resource_path, offload_video_to_cpu, async_loading_frames))
            return {"loaded": True}
        predictor = SimpleNamespace(model=SimpleNamespace(init_state=init_state))
        adapt_multiplex_state(predictor)
        self.assertEqual(predictor.model.init_state(resource_path="frames", offload_state_to_cpu=False,
                         offload_video_to_cpu=True, async_loading_frames=False), {"loaded": True})
        self.assertEqual(calls, [("frames", True, False)])
        with self.assertRaises(ValueError):
            predictor.model.init_state(resource_path="frames", offload_state_to_cpu=True)
        self.assertEqual(len(calls), 1)

    def test_bounded_samples_preserve_real_pts(self):
        times = [round(i/120,6) for i in range(14400)]
        requested = [times[i*297] for i in range(48)]
        picks = sample_indices(times,requested)
        self.assertLessEqual(len(picks),400)
        self.assertTrue(set(requested) <= {times[i] for i in picks})
        self.assertEqual(picks,sorted(set(picks)))
        with self.assertRaises(ValueError):
            sample_indices([0,.1,.2],[.05])

    def test_manifest_rejects_nonfinite_and_bad_coordinates(self):
        for patch in [{"duration":float("nan")},{"width":10000},{"sampleTimes":[1,0]},
                      {"anchors":[{"t":0,"points":[{"id":11,"x":2,"y":0}]}]}]:
            with self.assertRaises((ValueError,TypeError)):
                validate_manifest({**MANIFEST,**patch})

    def test_ambiguous_athletes_are_not_selected(self):
        frames = [{"t":t,"objects":[box("person-1","person"),box("person-2","person")]} for t in [0,1]]
        anchors = [{"t":t,"points":[{"id":i,"x":.5,"y":.5} for i in [11,12,23]]} for t in [0,1]]
        self.assertTrue(all(not f["objects"] for f in select_subjects(frames,anchors)))
        frames[0]["objects"].pop()
        frames[1]["objects"].pop()
        self.assertTrue(all(f["objects"] for f in select_subjects(frames,anchors)))

    def test_mask_contours_bound_coordinates_and_drop_fragments(self):
        import numpy as np
        mask = np.zeros((100,100), dtype=bool)
        mask[10:40,10:40] = True
        polygon = mask_outline(mask)
        self.assertTrue(3 <= len(polygon) <= 64)
        self.assertTrue(all(0 <= n <= 1 for point in polygon for n in point))
        mask[60:90,60:90] = True
        self.assertIsNone(mask_outline(mask))
        self.assertIsNone(mask_outline(np.zeros((100,100))))

    def test_sessions_are_closed_when_model_output_fails(self):
        class Fake:
            def __init__(self): self.closed = []
            def handle_request(self,req):
                if req["type"] == "start_session": return {"session_id":"one"}
                if req["type"] == "close_session": self.closed.append(req["session_id"])
            def handle_stream_request(self,req):
                yield {"frame_index":1000,"outputs":{}}
        fake = Fake()
        with self.assertRaises(ValueError): infer_frames(fake,"/tmp/fixture",[0,1],[])
        self.assertEqual(fake.closed,["one"])

    def test_real_ffmpeg_decode_with_fake_segmentation_preserves_pts_and_cleanup(self):
        import numpy as np
        class Fake:
            def __init__(self): self.sessions = []; self.roots = []; self.closed = []; self.prompt = None
            def handle_request(self,req):
                if req["type"] == "start_session":
                    self.roots.append(Path(req["resource_path"]))
                    self.sessions.append(str(len(self.sessions)))
                    return {"session_id":self.sessions[-1]}
                if req["type"] == "add_prompt": self.prompt = req["text"]
                if req["type"] == "close_session": self.closed.append(req["session_id"])
            def handle_stream_request(self,req):
                files = sorted(self.roots[-1].glob("*.jpg"))
                for i in range(len(files)):
                    mask = np.zeros((480,320), dtype=bool)
                    if self.prompt == "person": mask[48:432,64:256] = True
                    yield {"frame_index":i,"outputs":{"out_obj_ids":[1],"out_binary_masks":[mask]}}
        with tempfile.TemporaryDirectory() as root:
            clip = Path(root)/"clip.mp4"
            subprocess.run(["ffmpeg","-v","error","-f","lavfi","-i","color=size=320x480:rate=30:duration=2",
                            "-c:v","libx264","-pix_fmt","yuv420p",str(clip)],check=True)
            data = clip.read_bytes()
            manifest = copy.deepcopy(MANIFEST)
            manifest.update(sha256=hashlib.sha256(data).hexdigest(),duration=1.966667,sampleTimes=[0,1,1.966667])
            manifest["anchors"] = [{"t":t,"points":[{"id":i,"x":.5,"y":.5} for i in [11,12,23]]} for t in [0,1]]
            fake = Fake()
            result = analyse(fake,data,manifest)
            self.assertEqual(result["model"],"sam3.1")
            self.assertTrue(result["frames"][0]["objects"])
            self.assertAlmostEqual(result["frames"][-1]["t"],1.966667)
            self.assertEqual(fake.closed,fake.sessions)
            self.assertTrue(all(not p.exists() for p in fake.roots))


if __name__ == "__main__":
    unittest.main()
