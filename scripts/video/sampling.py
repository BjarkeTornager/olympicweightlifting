"""Bounded, real-frame evidence with coverage between detected phases."""
import bisect
import math


def evidence_indices(times, start, end, phases, limit=48):
    available = [i for i, t in enumerate(times) if start <= t <= end + .001]
    if len(available) < 2:
        raise ValueError("No complete evidence window")
    observed = [times[i] for i in available]

    def nearest(t):
        j = bisect.bisect_left(observed, t)
        return min((available[max(0, j-1)], available[min(j, len(available)-1)]),
                   key=lambda i: abs(times[i]-t))

    centres = sorted({nearest(t) for t in phases
                      if isinstance(t, (int, float)) and math.isfinite(t) and start <= t <= end})
    picks = {available[0], available[-1], *centres}
    # Retain complete-clip context even if the first model missed a phase.
    for i in range(12):
        picks.add(nearest(start + (end-start)*i/11))
    if len(picks) > limit:
        raise ValueError("Too many phase centres")
    active_start = max(start, times[centres[0]]-.5) if centres else start
    active_end = min(end, times[centres[-1]]+.5) if centres else end
    picks.update([nearest(active_start), nearest(active_end)])

    # Fill the largest remaining temporal gap, prioritising the entire movement
    # window. Clustering all spare frames around known poses misses transitions.
    while len(picks) < min(limit, len(available)):
        ordered = sorted(picks)
        candidates = []
        for left, right in zip(ordered, ordered[1:]):
            mid = nearest((times[left]+times[right])/2)
            if mid in picks:
                continue
            active = active_start <= times[mid] <= active_end
            candidates.append(((active, times[right]-times[left]), mid))
        if not candidates:
            break
        picks.add(max(candidates)[1])
    result = sorted(picks)
    # Contact sheets always contain 48 labelled cells; short clips repeat only
    # real decoded frames, never interpolated evidence.
    return sorted(result + [result[-1]] * (limit-len(result)))
