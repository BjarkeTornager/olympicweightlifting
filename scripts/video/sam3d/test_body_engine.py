import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from body_engine import decode_payload, validate_manifest
sys.path.insert(0,str(Path(__file__).parents[1]/'sam3'))
from gateway import create_app
from fastapi.testclient import TestClient

DATA=b'\x00\x00\x00\x18ftypisomsynthetic'
M={'version':1,'sha256':hashlib.sha256(DATA).hexdigest(),'width':320,'height':480,'duration':2,
   'frames':[{'t':0.5,'person':[[.1,.1],[.9,.1],[.9,.9]],'plates':[]}]}
def payload(m=M,data=DATA):
    s=json.dumps(m).encode();return len(s).to_bytes(4,'big')+s+data

class BodyGatewayTest(unittest.TestCase):
    def test_auth_validation_and_private_receipt_before_dispatch(self):
        calls=[]
        async def get(timeout): return {'status':'tracked'}
        async def cancel(): calls.append('cancelled')
        job=SimpleNamespace(object_id='private-call',get=SimpleNamespace(aio=get),cancel=SimpleNamespace(aio=cancel))
        async def spawn(data,m,expires): calls.append((data,m)); return job
        token='synthetic-body-fixture-secret-123456789'
        client=TestClient(create_app(spawn,lambda _:job,token,path='/body',content_type='application/octet-stream',decode_payload=decode_payload))
        self.assertEqual(client.post('/body',content=payload()).status_code,401)
        self.assertEqual(calls,[])
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/octet-stream','X-SAM3-Request':'12345678-abcd-1234-abcd-123456789012','X-SAM3-Budget-Ms':'900000'}
        self.assertEqual(client.post('/body',headers=headers,content=payload(data=DATA+b'wrong')).status_code,400)
        self.assertEqual(calls,[])
        response=client.post('/body',headers=headers,content=payload())
        self.assertEqual(response.status_code,202);self.assertEqual(calls,[(DATA,M)])
        headers['X-SAM3-Job']=response.json()['job']
        self.assertEqual(client.get('/body',headers=headers).json(),{'status':'tracked'})
        other=TestClient(create_app(spawn,lambda _:self.fail('Cross-service lookup'),token))
        self.assertEqual(other.get('/segment',headers=headers).status_code,400)
        headers['X-SAM3-Request']='another-user-request'
        self.assertEqual(client.get('/body',headers=headers).status_code,400)
        self.assertEqual(len(calls),1)

    def test_invalid_evidence_cannot_reach_reconstructor(self):
        self.assertEqual(decode_payload(payload()),(DATA,M))
        for bad in [b'',b'\xff\xff\xff\xff{}',payload(data=DATA+b'x')]:
            with self.assertRaises(ValueError): decode_payload(bad)
        for change in [{'width':10000},{'frames':M['frames']*49},{'frames':M['frames']*2}]:
            with self.assertRaises(ValueError): validate_manifest({**M,**change})
        m=copy.deepcopy(M);m['frames'][0]['person'][0][0]=float('nan')
        with self.assertRaises(ValueError): validate_manifest(m)

if __name__=='__main__':unittest.main()
