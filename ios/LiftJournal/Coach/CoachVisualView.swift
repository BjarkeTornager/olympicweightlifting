import Charts
import LiftAPI
import LiftStore
import MapKit
import SwiftUI

/// A table, chart, diagram, photo gallery or route that Coach attached to a
/// reply, drawn with native components.
struct CoachVisualView: View {
  let visual: Components.Schemas.CoachVisual

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(visual.title).font(.subheadline.weight(.semibold))
      switch visual.kind {
      case "table":
        DataTable(columns: visual.columns ?? [], rows: visual.rows ?? [])
      case "bar_chart":
        chart
      case "diagram":
        diagram
      case "photo_gallery":
        gallery
      case "route_map":
        route
      default:
        EmptyView()
      }
      if let caption = visual.caption, !caption.isEmpty {
        Text(caption).font(.footnote).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  // MARK: Bar chart

  private var chart: some View {
    let points = visual.points ?? []
    let unit = visual.unit ?? ""
    return Chart(Array(points.enumerated()), id: \.offset) { _, point in
      BarMark(x: .value("Label", point.label), y: .value(unit.isEmpty ? "Value" : unit, point.value))
        .foregroundStyle(Color.accentColor.gradient)
        .cornerRadius(4)
        .annotation(position: .top) {
          Text(point.value.formatted(.number.precision(.fractionLength(0...1))))
            .font(.caption2).foregroundStyle(.secondary)
        }
    }
    .chartYAxisLabel(unit)
    .frame(height: 200)
    .padding(12)
    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14))
  }

  // MARK: Diagram

  /// Steps in the order the connections run, each arrow with its label.
  private var diagram: some View {
    let nodes = visual.nodes ?? []
    let edges = visual.edges ?? []
    let order = Self.order(nodes: nodes, edges: edges)
    return VStack(alignment: .leading, spacing: 4) {
      ForEach(Array(order.enumerated()), id: \.offset) { index, node in
        Text(node.label)
          .font(.subheadline.weight(.medium))
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 10))
        if index < order.count - 1 {
          let label = edges.first { $0.from == node.id && $0.to == order[index + 1].id }?.label
          Label(label ?? "", systemImage: "arrow.down")
            .font(.caption)
            .foregroundStyle(.secondary)
            .labelStyle(.titleAndIcon)
            .padding(.leading, 14)
        }
      }
    }
  }

  static func order(
    nodes: [Components.Schemas.DiagramNode], edges: [Components.Schemas.DiagramEdge]
  ) -> [Components.Schemas.DiagramNode] {
    let targets = Set(edges.map(\.to))
    var ordered: [Components.Schemas.DiagramNode] = []
    var current = nodes.first { !targets.contains($0.id) } ?? nodes.first
    while let node = current, !ordered.contains(where: { $0.id == node.id }) {
      ordered.append(node)
      current = edges.first { $0.from == node.id }.flatMap { edge in nodes.first { $0.id == edge.to } }
    }
    return ordered + nodes.filter { node in !ordered.contains { $0.id == node.id } }
  }

  // MARK: Photos

  private var gallery: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(visual.imageIds ?? [], id: \.self) { id in
          PrivateImage(id: id)
            .frame(width: 140, height: 140)
            .clipShape(.rect(cornerRadius: 12))
        }
      }
    }
    .scrollIndicators(.hidden)
  }

  // MARK: Route

  private var route: some View {
    VStack(alignment: .leading, spacing: 8) {
      RouteMap(visual: visual)
      RouteFacts(visual: visual)
    }
  }
}

/// An image from the athlete's private library, fetched with their session.
struct PrivateImage: View {
  @Environment(AppModel.self) private var app
  let id: String
  @State private var image: UIImage?

  var body: some View {
    ZStack {
      Color(.secondarySystemBackground)
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        ProgressView()
      }
    }
    .task(id: id) {
      guard image == nil, let session = app.session,
        let response = try? await RawRequest.send(
          "api/images/\(id)", method: "GET", json: nil, token: session.token, account: session.accountID),
        response.status == 200
      else { return }
      image = UIImage(data: response.data)
    }
  }
}
