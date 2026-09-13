"""Image-plane plate-centre observations; no inferred scale or bar velocity."""
import math
import cv2
import numpy as np


def plate_candidates(image, points, continuing=False):
    h, w = image.shape[:2]
    hands = {p['id']: np.array([p['x']*w, p['y']*h]) for p in points if p['id'] in (15, 16)}
    if len(hands) != 2 and not continuing:
        return []
    a, b = hands.get(15,np.array([0,0])), hands.get(16,np.array([w,0]))
    direction = b-a
    length = float(np.linalg.norm(direction))
    if length < w*.035 and not continuing:
        return []
    length=max(1,length)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 120)
    contours = list(cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)[0])
    # Coloured bumper faces provide closed conics even when their textured edge
    # is broken. Hue is only a proposal: grip alignment and continuity still gate it.
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    for hue in range(0, 170, 10):
        face = cv2.inRange(hsv, (hue, 65, 45), (hue+20, 255, 255))
        face = cv2.morphologyEx(face, cv2.MORPH_CLOSE, np.ones((5,5), np.uint8))
        contours.extend(cv2.findContours(face, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0])
    candidates = []
    for contour in contours:
        if len(contour) < 18:
            continue
        (x, y), (minor, major), angle = cv2.fitEllipse(contour)
        if not (12 <= major <= min(w,h)*.28 and max(6, major*.22) <= minor <= major):
            continue
        if min(x-minor/2, y-major/2, w-x-minor/2, h-y-major/2) < 2:
            continue
        area = cv2.contourArea(contour)
        if not .7 <= area/max(math.pi*minor*major/4, 1) <= 1.15:
            continue
        centre = np.array([x,y])
        along = float(np.dot(centre-a, direction)/length**2)
        across = abs(float(direction[0]*(y-a[1])-direction[1]*(x-a[0])))/length
        # A plate must meet the visibly observed grip line, outside the grip.
        # Background circular objects and inferred wrist positions are not seeds.
        if not continuing and (not (-2 <= along <= .05 or .95 <= along <= 3) or across > max(5, major*.12)):
            continue
        mask = np.zeros((h,w),np.uint8)
        cv2.drawContours(mask,[contour],-1,255,-1)
        colours = hsv[(mask>0)&(hsv[:,:,1]>=65)&(hsv[:,:,2]>=45),0]
        if len(colours)<area*.35:
            continue
        histogram=np.bincount(colours//10,minlength=18)
        hue=int(np.argmax(histogram))*10+5
        if histogram.max()/len(colours)<.3:
            continue
        candidates.append({'x': x/w, 'y': y/h, 'size': major/h,
                           'minor':minor, 'major':major, 'angle':angle,
                           'hue':hue, 'score': .85 if continuing else max(0, 1-across/max(8, major*.2)), 'area': area})
    # Nested edges on the same physical plate are one candidate, not competitors.
    result = []
    for candidate in sorted(candidates, key=lambda c: c['area'], reverse=True):
        if not any(math.hypot(candidate['x']-c['x'], candidate['y']-c['y']) < c['size']*.15 for c in result):
            result.append(candidate)
    return result


class AutomaticBarTracker:
    def __init__(self):
        self.points = []
        self.previous = None
        self.pending = []
        self.stopped = False
        self.gray = None
        self.features = None
        self.last_conic = -1

    def optical(self, gray, time):
        if self.gray is None or self.features is None or len(self.features)<6 or time-self.last_conic>.5:
            return None
        forward,status,_=cv2.calcOpticalFlowPyrLK(self.gray,gray,self.features,None,winSize=(25,25),maxLevel=3)
        if forward is None:return None
        backward,back_status,_=cv2.calcOpticalFlowPyrLK(gray,self.gray,forward,None,winSize=(25,25),maxLevel=3)
        if backward is None:return None
        good=(status[:,0]>0)&(back_status[:,0]>0)&(np.linalg.norm(backward-self.features,axis=2)[:,0]<1.2)
        if good.sum()<6 or good.mean()<.65:return None
        transform,inliers=cv2.estimateAffinePartial2D(self.features[good],forward[good],method=cv2.RANSAC,ransacReprojThreshold=1.8)
        if transform is None or inliers is None or not np.isfinite(transform).all() or inliers.mean()<.7:return None
        scale=math.hypot(transform[0,0],transform[1,0])
        if not .9<scale<1.1:return None
        h,w=gray.shape
        centre=transform@np.array([self.previous['x']*w,self.previous['y']*h,1])
        if not 0<centre[0]<w or not 0<centre[1]<h:return None
        if math.hypot(centre[0]/w-self.previous['x'],centre[1]/h-self.previous['y'])>.025+(time-self.previous['t'])*1.5:return None
        self.features=forward[good][inliers[:,0]>0]
        return dict(self.previous,x=float(centre[0]/w),y=float(centre[1]/h),
                    size=self.previous['size']*scale,score=.75,optical=True)

    def seed_features(self, gray, candidate):
        h,w=gray.shape;mask=np.zeros((h,w),np.uint8)
        cv2.ellipse(mask,((candidate['x']*w,candidate['y']*h),
            (candidate['minor']*.85,candidate['major']*.85),candidate['angle']),255,-1)
        self.features=cv2.goodFeaturesToTrack(gray,maxCorners=60,qualityLevel=.03,minDistance=3,mask=mask)

    def add(self, image, points, time):
        if self.stopped:
            return
        gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
        candidates = plate_candidates(image, points, bool(self.previous))
        if self.previous:
            dt = time-self.previous['t']
            if dt <= 0 or dt > .3:
                self.stopped = bool(self.points)
                if not self.stopped: self.previous, self.pending = None, []
                return
            flow=self.optical(gray,time)
            expected=flow or self.previous
            candidates = [c for c in candidates if .7 <= c['size']/self.previous['size'] <= 1.4
                          and min(abs(c['hue']-self.previous['hue']),180-abs(c['hue']-self.previous['hue']))<=15
                          and math.hypot(c['x']-expected['x'], c['y']-expected['y']) <= (.025 if flow else .025+dt*1.5)]
            candidates.sort(key=lambda c: math.hypot(c['x']-expected['x'], c['y']-expected['y']))
            if not candidates and flow:candidates=[flow]
            if not candidates:
                # Missing pixels create a gap; never jump to another plate.
                if dt > .12:
                    self.stopped = bool(self.points)
                    if not self.stopped: self.previous, self.pending = None, []
                return
            if len(candidates) > 1:
                distances = [math.hypot(c['x']-self.previous['x'], c['y']-self.previous['y']) for c in candidates[:2]]
                if distances[1]-distances[0] < .02:
                    self.stopped = bool(self.points)
                    if not self.stopped:self.previous,self.pending=None,[]
                    return
        else:
            candidates.sort(key=lambda c: c['area'], reverse=True)
            if not candidates:
                self.pending = []
                return
        candidate = dict(candidates[0], t=time)
        if not candidate.get('optical'):
            self.last_conic=time
            self.seed_features(gray,candidate)
        self.gray=gray
        self.previous = candidate
        self.pending.append(candidate)
        if len(self.pending) >= 3:
            self.points = [{'t': round(c['t'],6), 'x': round(c['x'],5), 'y': round(c['y'],5),
                            'score': round(c['score'],3)} for c in self.pending]

    def result(self, sampled_frames):
        return {'status': 'partial' if self.points else 'unavailable', 'source': 'automatic_plate',
                'reason': 'Automatic image-plane plate path. No physical scale or velocity is inferred. Missing or ambiguous plate observations end the path.' if self.points else
                'A visible plate could not be followed confidently. Film the complete bar and plates, or mark a plate in the optional tracking controls.',
                'points': self.points, 'coverage': len(self.points)/max(1,sampled_frames),
                'horizontalRangeCm': None, 'riseCm': None, 'peakUpwardVelocity': None, 'velocities': []}
