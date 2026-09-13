"""Revisit actual pixels using the selected SAM athlete, before Coach reviews them."""
import json
import math
import os
import sys
import cv2
import numpy as np
from pose import PoseTracker, visible_points
from automatic_bar import AutomaticBarTracker


def selected_pose(tracker, image, polygon, time):
    if tracker.model is None or len(polygon) < 3:
        return []
    h,w=image.shape[:2]
    contour=np.asarray([[x*w,y*h] for x,y in polygon], np.float32)
    x,y,bw,bh=cv2.boundingRect(contour)
    pad=max(12,round(max(bw,bh)*.12))
    left,top=max(0,x-pad),max(0,y-pad)
    right,bottom=min(w,x+bw+pad),min(h,y+bh+pad)
    if right-left<20 or bottom-top<40:return []
    crop=image[top:bottom,left:right].copy()
    # Remove spectators/reflections outside the selected athlete's region while
    # retaining a generous edge margin. Cropping changes no source timestamp.
    mask=np.zeros(image.shape[:2],np.uint8)
    cv2.fillPoly(mask,[contour.astype(np.int32)],255)
    mask=cv2.dilate(mask,np.ones((17,17),np.uint8))
    crop[mask[top:bottom,left:right]==0]=127
    try:
        result=tracker.model.detect_for_video(tracker.mp.Image(image_format=tracker.mp.ImageFormat.SRGB,
            data=cv2.cvtColor(crop,cv2.COLOR_BGR2RGB)),round(time*1000))
        candidates=[]
        for pose in result.pose_landmarks:
            points=[dict(p,x=(left+p['x']*(right-left))/w,y=(top+p['y']*(bottom-top))/h)
                    for p in visible_points([pose])]
            points=[p for p in points if cv2.pointPolygonTest(contour,(p['x']*w,p['y']*h),True)>=-8]
            ids={p['id'] for p in points}
            if {11,23}<=ids or {12,24}<=ids:candidates.append(points)
        return candidates[0] if len(candidates)==1 else []
    except Exception:
        return []


def recover(path, spec):
    cv2.setNumThreads(2)
    region_frames=(spec.get('segmentation') or {}).get('frames',[])
    original=(spec.get('pose') or {}).get('frames',[])
    start,end=min(spec['sampleTimes']),max(spec['sampleTimes'])
    dense=[f['t'] for f in original if start<=f['t']<=end]
    dense=dense[::max(1,math.ceil(len(dense)/350))]
    requested=sorted({f['t'] for f in region_frames}|set(spec['sampleTimes'])|set(dense))
    tracker=PoseTracker()
    bar=AutomaticBarTracker()
    output=[]; cap=cv2.VideoCapture(path)
    cursor=0; last=-1; decoded=0
    while cursor<len(requested) and decoded<14400:
        ok,image=cap.read()
        if not ok:break
        decoded+=1
        t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
        if not math.isfinite(t) or t<0 or t<=last:continue
        last=t
        while cursor<len(requested) and requested[cursor]<t-.002:cursor+=1
        if cursor>=len(requested):break
        if abs(t-requested[cursor])>.002:continue
        old=min(original,key=lambda f:abs(f['t']-t),default=None)
        old_points=old['points'] if old and abs(old['t']-t)<.002 else []
        region=min(region_frames,key=lambda f:abs(f['t']-t),default=None)
        people=[o for o in region['objects'] if o['kind']=='person'] if region and abs(region['t']-t)<.002 else []
        points=selected_pose(tracker,image,people[0]['polygon'],t) if len(people)==1 else []
        # Do not discard already visible landmarks when crop recovery has less
        # evidence. Both tracks remain tied to the same foreground athlete.
        if len(people)==1:
            h,w=image.shape[:2]
            contour=np.asarray([[x*w,y*h] for x,y in people[0]['polygon']],np.float32)
            old_points=[p for p in old_points if cv2.pointPolygonTest(contour,(p['x']*w,p['y']*h),True)>=-8]
        elif region and abs(region['t']-t)<.002:
            old_points=[]
        if len(points)<len(old_points):points=old_points
        output.append({'t':round(t,6),'points':points})
        bar.add(image,points,t)
        cursor+=1
    cap.release();tracker.close()
    count=sum(bool(f['points']) for f in output)
    return {'pose':{'version':2,'status':'partial' if count else 'unavailable',
                   'reason':'Foreground body tracking from the selected athlete’s pixels. Hidden or ambiguous landmarks are omitted.',
                   'frames':output},'tracking':bar.result(len(output))}


if __name__=='__main__':
    root=sys.argv[1]
    with open(os.path.join(root,'input.json')) as f:spec=json.load(f)
    result=recover(os.path.join(root,'media.mp4'),spec)
    with open(os.path.join(root,'result.json'),'w') as f:json.dump(result,f,allow_nan=False)
