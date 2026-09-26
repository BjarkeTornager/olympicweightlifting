import Foundation

/// A point on a recorded route, in degrees.
public struct RoutePoint: Sendable, Equatable {
  public var lat: Double
  public var lng: Double

  public init(lat: Double, lng: Double) {
    self.lat = lat
    self.lng = lng
  }
}

/// Turns a GPS track of thousands of points into the few hundred that keep
/// its shape, as the journal stores it.
public enum RouteShape {
  /// Distance along the Earth's surface, in metres.
  public static func metres(_ a: RoutePoint, _ b: RoutePoint) -> Double {
    let rad = Double.pi / 180
    let dLat = (b.lat - a.lat) * rad
    let dLng = (b.lng - a.lng) * rad
    let h = sin(dLat / 2) * sin(dLat / 2)
      + cos(a.lat * rad) * cos(b.lat * rad) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * 6_371_000 * asin(min(1, h.squareRoot()))
  }

  /// Ramer–Douglas–Peucker, loosened until at most `limit` points remain.
  /// The first and last points are always kept.
  public static func simplify(_ points: [RoutePoint], limit: Int = 200) -> [RoutePoint] {
    guard points.count > limit, limit >= 2 else { return points }
    var tolerance = 2.0
    while true {
      let kept = douglasPeucker(points, tolerance: tolerance)
      if kept.count <= limit { return kept }
      tolerance *= 1.5
    }
  }

  /// The index of the point farthest from the start: where an out-and-back
  /// turned round. The server marks the same point on the map.
  public static func farthestIndex(_ points: [RoutePoint]) -> Int {
    guard let first = points.first else { return 0 }
    var best = 0
    var distance = 0.0
    for (i, p) in points.enumerated() {
      let d = metres(first, p)
      if d > distance { (best, distance) = (i, d) }
    }
    return best
  }

  /// Whether the route ends within 300 m of its start, as the server decides.
  public static func isLoop(_ points: [RoutePoint]) -> Bool {
    guard points.count > 2, let first = points.first, let last = points.last else { return false }
    return metres(first, last) < 300
  }

  private static func douglasPeucker(_ points: [RoutePoint], tolerance: Double) -> [RoutePoint] {
    // Flat metres around the first point are exact enough over one workout.
    let origin = points[0]
    let scale = cos(origin.lat * .pi / 180)
    let xy = points.map { p in
      ((p.lng - origin.lng) * 111_320 * scale, (p.lat - origin.lat) * 110_540)
    }
    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true
    keep[points.count - 1] = true
    // An explicit stack: a long ride has thousands of points.
    var stack = [(0, points.count - 1)]
    while let (start, end) = stack.popLast() {
      guard end > start + 1 else { continue }
      var index = start
      var distance = 0.0
      for i in (start + 1)..<end {
        let d = offLine(xy[i], xy[start], xy[end])
        if d > distance { (index, distance) = (i, d) }
      }
      if distance > tolerance {
        keep[index] = true
        stack.append((start, index))
        stack.append((index, end))
      }
    }
    return zip(points, keep).compactMap { $1 ? $0 : nil }
  }

  /// Distance from `p` to the segment from `a` to `b`.
  private static func offLine(
    _ p: (Double, Double), _ a: (Double, Double), _ b: (Double, Double)
  ) -> Double {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1)
    let length = dx * dx + dy * dy
    let t = length == 0 ? 0 : max(0, min(1, ((p.0 - a.0) * dx + (p.1 - a.1) * dy) / length))
    let (x, y) = (a.0 + t * dx - p.0, a.1 + t * dy - p.1)
    return (x * x + y * y).squareRoot()
  }
}
