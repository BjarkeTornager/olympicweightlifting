import Foundation
import Testing

@testable import LiftStore

@Suite("Workout routes")
struct RouteShapeTests {
  /// An out-and-back along a street with a bend, one fix a second.
  private func walk() -> [RoutePoint] {
    var out: [RoutePoint] = []
    for i in 0..<1200 {
      let t = Double(i)
      out.append(RoutePoint(lat: 55.67 + (i < 600 ? 0 : (t - 600) * 0.00001), lng: 12.54 + min(t, 600) * 0.00001))
    }
    return out + out.reversed()
  }

  @Test("A long track keeps at most 200 points, its ends and its shape")
  func simplify() {
    let track = walk()
    let path = RouteShape.simplify(track)
    #expect(path.count <= 200)
    #expect(path.count >= 3)
    #expect(path.first == track.first)
    #expect(path.last == track.last)
    // The corner of the street survives.
    #expect(path.contains(RoutePoint(lat: 55.67, lng: 12.546)))
  }

  @Test func shortTracksAreUnchanged() {
    let track = [RoutePoint(lat: 55, lng: 12), RoutePoint(lat: 55.001, lng: 12.001)]
    #expect(RouteShape.simplify(track) == track)
  }

  @Test("An out-and-back is a loop that turns at its farthest point")
  func loop() {
    let path = RouteShape.simplify(walk())
    #expect(RouteShape.isLoop(path))
    let far = path[RouteShape.farthestIndex(path)]
    #expect(abs(far.lat - 55.676) < 0.0001)
    #expect(!RouteShape.isLoop([RoutePoint(lat: 55, lng: 12), RoutePoint(lat: 55, lng: 12.01)]))
  }

  @Test func metres() {
    // One thousandth of a degree of latitude is about 111 m.
    let d = RouteShape.metres(RoutePoint(lat: 55, lng: 12), RoutePoint(lat: 55.001, lng: 12))
    #expect(abs(d - 111.2) < 0.5)
  }

  @Test("Place names leave out house numbers")
  func placeLabels() {
    #expect(PlaceNames.label(name: "Vesterbrogade 12", city: "Copenhagen") == "Vesterbrogade, Copenhagen")
    #expect(PlaceNames.label(name: "221B Baker Street", city: "London") == "Baker Street, London")
    #expect(PlaceNames.label(name: "Frederiksberg Have", city: "Frederiksberg") == "Frederiksberg Have")
    #expect(PlaceNames.label(name: "12", city: "Aarhus") == "Aarhus")
    #expect(PlaceNames.label(name: nil, city: nil) == nil)
  }
}
