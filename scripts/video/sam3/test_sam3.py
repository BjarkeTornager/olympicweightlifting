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
        from types import SimpleNamespace
        self.calls, self.cancelled, self.reads = [], [], []
        self.now = 1000
        self.pending = False
        async def get(timeout):
            self.reads.append(timeout)
            if self.pending: raise TimeoutError()
            return {"fixture": True}
        async def cancel(): self.cancelled.append("job-1")
        self.call = SimpleNamespace(object_id="job-1", get=SimpleNamespace(aio=get), cancel=SimpleNamespace(aio=cancel))
        async def spawn(data, manifest, expires):
            self.calls.append((data, manifest, expires))
            return self.call
        self.spawn = spawn
        self.lookup = lambda job: self.call if job == "job-1" else self.fail("Wrong job")
        self.client = TestClient(create_app(spawn, self.lookup, TOKEN, lambda: self.now))
        self.headers = {"Authorization": f"Bearer {TOKEN}","Content-Type":"video/mp4",
                        "X-SAM3-Manifest":json.dumps(MANIFEST),
                        "X-SAM3-Request":"12345678-abcd-1234-abcd-123456789012", "X-SAM3-Budget-Ms":"300000"}

    def queue(self):
        r = self.client.post("/segment",headers=self.headers,content=DATA)
        self.assertEqual(r.status_code,202)
        return {**self.headers, "X-SAM3-Job":r.json()["job"]}

    def test_auth_before_gpu_or_body_processing(self):
        for path in ["/", "/docs", "/openapi.json"]:
            self.assertEqual(self.client.get(path).status_code,404)
        for method in ["post", "get", "delete"]:
            self.assertEqual(getattr(self.client,method)("/segment").status_code,401)
        self.assertEqual(self.calls,[])
        self.assertEqual(self.reads,[])

    def test_queue_poll_and_repeat_reads_do_not_resubmit(self):
        headers = self.queue()
        self.assertEqual(self.calls,[(DATA,MANIFEST,1300)])
        self.pending = True
        self.assertEqual(self.client.get("/segment",headers=headers).status_code,202)
        self.pending = False
        for _ in range(2):
            r = self.client.get("/segment",headers=headers)
            self.assertEqual(r.json(),{"fixture":True})
            self.assertEqual(r.headers["cache-control"],"no-store")
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.reads,[0,0,0])

    def test_cold_start_beyond_90_seconds_survives_gateway_restart(self):
        headers = self.queue()
        self.now += 150
        self.pending = True
        restarted = TestClient(create_app(self.spawn,self.lookup,TOKEN,lambda:self.now))
        self.assertEqual(restarted.get("/segment",headers=headers).status_code,202)
        self.now += 90
        self.pending = False
        self.assertEqual(restarted.get("/segment",headers=headers).json(),{"fixture":True})
        self.assertEqual(len(self.calls),1)

    def test_durable_receipt_survives_cold_start_beyond_five_minutes(self):
        self.headers["X-SAM3-Budget-Ms"] = "900000"
        headers = self.queue()
        self.assertEqual(self.calls[0][2], 1900)
        self.now += 400
        self.pending = True
        restarted = TestClient(create_app(self.spawn,self.lookup,TOKEN,lambda:self.now))
        self.assertEqual(restarted.get("/segment",headers=headers).status_code,202)
        self.now += 170
        self.pending = False
        self.assertEqual(restarted.get("/segment",headers=headers).json(),{"fixture":True})
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.cancelled,[])
        self.now = 1901
        self.assertEqual(restarted.get("/segment",headers=headers).status_code,410)

    def test_receipt_tampering_and_wrong_request_do_not_access_job(self):
        headers = self.queue()
        for patch in [{"X-SAM3-Job":headers["X-SAM3-Job"]+"x"},
                      {"X-SAM3-Request":"different account job"}, {"X-SAM3-Job":"invalid"}]:
            for method in ["get", "delete"]:
                self.assertEqual(getattr(self.client,method)("/segment",headers={**headers,**patch}).status_code,400)
        self.assertEqual(self.reads,[])
        self.assertEqual(self.cancelled,[])

    def test_expiration_and_cancellation_stop_only_this_job(self):
        headers = self.queue()
        self.now = 1301
        self.assertEqual(self.client.get("/segment",headers=headers).status_code,410)
        self.assertEqual(self.client.delete("/segment",headers=headers).status_code,200)
        self.assertEqual(self.reads,[])
        self.assertEqual(self.cancelled,["job-1","job-1"])

    def test_bad_hash_and_arbitrary_remote_url_never_reach_gpu(self):
        r = self.client.post("/segment",headers=self.headers,content=b"different video")
        self.assertEqual(r.status_code,400)
        for patch in [{"X-SAM3-Manifest":json.dumps({**MANIFEST,"url":"http://internal"})},
                      {"X-SAM3-Budget-Ms":"9999999"}, {"X-SAM3-Request":""}]:
            self.assertEqual(self.client.post("/segment",headers={**self.headers,**patch},content=DATA).status_code,400)
        self.assertEqual(self.calls,[])

    def test_oversize_body_rejected_before_dispatch(self):
        self.assertEqual(self.client.post("/segment",headers=self.headers,content=b"a"*(25*1024*1024+1)).status_code,413)
        self.assertEqual(self.calls,[])

    def test_provider_errors_never_escape(self):
        async def fail(*args): raise RuntimeError("private secret media")
        client = TestClient(create_app(fail,self.lookup,TOKEN))
        r = client.post("/segment",headers=self.headers,content=DATA)
        self.assertEqual(r.status_code,503)
        self.assertNotIn("private",r.text)


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

    def plate_fixture(self, competing=False, camera_pan=False):
        frames, anchors = [], []
        for i in range(30):
            t = i / 10
            travel = abs(__import__("math").sin(i/29*3.14))
            y = .6 - .1*travel if camera_pan else .7 - .4*travel
            shift = .6-y if camera_pan else 0
            person = {"id":"person-1","kind":"person","polygon":[[.3,.1-shift],[.7,.1-shift],[.7,.9-shift],[.3,.9-shift]]}
            def plate(id,x,cy,size):
                return {"id":id,"kind":"plate","polygon":[[x-size,cy-size],[x+size,cy-size],[x+size,cy+size],[x-size,cy+size]]}
            # Two ends and a stacked plate, with perspective-scaled travel.
            objects = [person, plate("plate-1",.25,y,.05),
                       plate("plate-2",.75, (.6-shift if camera_pan else .1+.8*y),.06),
                       plate("plate-3",.73, (.6-shift if camera_pan else .1+.8*y),.03)]
            if competing:
                objects[2] = plate("plate-2",.75,.3+i/29*.4,.06)
            frames.append({"t":t,"objects":objects})
            anchors.append({"t":t,"points":[{"id":id,"x":.5,"y":.5-shift} for id in [11,12,23]]})
        return frames, anchors

    def test_two_bar_ends_and_stacked_plates_are_not_false_ambiguity(self):
        frames, anchors = self.plate_fixture()
        result = select_subjects(frames,anchors)
        self.assertTrue(all(len(f["objects"]) == 2 for f in result))
        self.assertEqual(len({o["id"] for f in result for o in f["objects"] if o["kind"] == "plate"}),1)

    def test_unrelated_motion_and_camera_pan_do_not_select_a_plate(self):
        for options in [{"competing":True}, {"camera_pan":True}]:
            frames, anchors = self.plate_fixture(**options)
            self.assertTrue(all(o["kind"] == "person" for f in select_subjects(frames,anchors) for o in f["objects"]))

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
