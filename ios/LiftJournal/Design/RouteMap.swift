import LiftAPI
import MapKit
import SwiftUI

/// A route on Apple Maps: a suggested one from Coach, or one Apple Health
/// recorded, with its start, turning point or end marked.
struct RouteMap: View {
  let visual: Components.Schemas.CoachVisual
  var height: CGFloat? = 220

  var body: some View {
    let path = (visual.path ?? []).compactMap { pair -> CLLocationCoordinate2D? in
      pair.count == 2 ? CLLocationCoordinate2D(latitude: pair[0], longitude: pair[1]) : nil
    }
    let stops = visual.stops ?? []
    // A loop finishes where it started: one flag is enough.
    let shown = visual.loop == true && stops.count > 2 ? Array(stops.dropLast()) : stops
    Map(interactionModes: [.pan, .zoom]) {
      MapPolyline(coordinates: path)
        .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
      ForEach(Array(shown.enumerated()), id: \.offset) { index, stop in
        Marker(
          stop.label, systemImage: symbol(index, of: stops.count),
          coordinate: CLLocationCoordinate2D(latitude: stop.lat, longitude: stop.lng)
        )
        .tint(index == 0 ? .green : .accentColor)
      }
    }
    .mapStyle(.standard(pointsOfInterest: .excludingAll))
    .frame(height: height)
    .frame(maxHeight: height == nil ? .infinity : nil)
    .clipShape(.rect(cornerRadius: height == nil ? 0 : 14))
    .accessibilityLabel(accessibilityText)
  }

  private func symbol(_ index: Int, of count: Int) -> String {
    if index == 0 { return "flag.fill" }
    if index == count - 1 { return "flag.checkered" }
    return visual.loop == true ? "arrow.uturn.backward" : "mappin"
  }

  private var accessibilityText: String {
    let places = (visual.stops ?? []).map(\.label).joined(separator: ", then ")
    return "\(visual.recorded == true ? "Recorded" : "Suggested") route map: \(places)"
  }
}

/// Distance and time under a route, as in Fitness.
struct RouteFacts: View {
  let visual: Components.Schemas.CoachVisual

  var body: some View {
    HStack(spacing: 16) {
      if let km = visual.distanceKm {
        Label(
          km.formatted(.number.precision(.fractionLength(0...2))) + " km",
          systemImage: "point.topleft.down.to.point.bottomright.curvepath")
      }
      if let seconds = visual.durationSeconds {
        Label(
          Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)),
          systemImage: "clock")
      }
      if visual.recorded == true {
        Label("Apple Health", systemImage: "heart.fill")
          .labelStyle(.titleAndIcon)
          .foregroundStyle(.pink)
      }
    }
    .font(.footnote)
    .foregroundStyle(.secondary)
  }
}
