import Charts
import LiftAPI
import LiftStore
import LiftTheme
import MapKit
import SwiftUI

/// A visual Coach attached to a reply, set as a captioned figure ("Fig. 1 ·
/// Protein this week") in the figure grammar, drawn with native components:
/// tables, charts, diagrams, photos and routes here, and the kinds it
/// composes from journal numbers, and recipes, in CoachVisualKinds.swift.
/// The sheet around it is the caller's (`.card`).
struct CoachVisualView: View {
  let visual: Components.Schemas.CoachVisual
  /// On the call screen: a recipe's first ingredients and a table's first
  /// rows; the whole card opens in a sheet.
  var compact = false
  /// Its number among the reply's figures, for the caption.
  var number: Int?
  /// The pigment of what the reply is about, for what the figure lights.
  var tint: Color?
  static let compactRows = 6

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      // A recipe is a page of its own, with its name as the heading.
      if visual.kind != "recipe" {
        FigureCaption(number: number, title: visual.title, note: Self.note(visual))
      }
      switch visual.kind {
      case "table":
        let rows = visual.rows ?? []
        DataTable(
          columns: visual.columns ?? [], rows: compact ? Array(rows.prefix(Self.compactRows)) : rows, inset: 0)
      case "bar_chart":
        VisualBars(visual: visual, tint: tint ?? VisualTint.of(visual.title, index: 0))
      case "diagram":
        diagram
      case "photo_gallery":
        gallery
      case "route_map":
        route
      case "line_chart":
        VisualLineChart(visual: visual, tint: tint)
      case "progress":
        VisualProgress(visual: visual)
      case "stats":
        VisualStats(visual: visual)
      case "comparison":
        VisualComparison(visual: visual)
      case "split":
        VisualSplit(visual: visual)
      case "calendar":
        VisualCalendar(visual: visual, tint: tint ?? VisualTint.of(visual.title, index: 0))
      case "recipe":
        VisualRecipe(visual: visual, compact: compact)
      default:
        EmptyView()
      }
      if let caption = visual.caption, !caption.isEmpty {
        Text(caption)
          .font(.footnote)
          .foregroundStyle(Theme.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// The button that opens what a compact card leaves out ("Full recipe",
  /// "Show all"), or nil when it already shows everything.
  static func more(_ visual: Components.Schemas.CoachVisual) -> String? {
    switch visual.kind {
    case "recipe":
      let hidden =
        (visual.ingredients?.count ?? 0) > VisualRecipe.compactIngredients
        || !(visual.steps ?? []).isEmpty || !VisualRecipe.nutrition(visual.nutrition).isEmpty
      return hidden ? "Full recipe" : nil
    case "table":
      return (visual.rows?.count ?? 0) > compactRows ? "Show all" : nil
    default:
      return nil
    }
  }

  /// What the caption's right side says: a run of days' average, or the
  /// unit the bars are counted in.
  static func note(_ visual: Components.Schemas.CoachVisual) -> String? {
    guard visual.kind == "bar_chart" else { return nil }
    if let average = VisualBars.average(visual) {
      return "Average \(VisualAmount.long(average, unit: visual.unit))"
    }
    return visual.unit.flatMap { $0.isEmpty || VisualAmount.hours($0) ? nil : $0 }
  }

  /// The figures' numbers in a reply, counted in order. A recipe is a page
  /// of its own and takes none.
  static func numbers(_ visuals: [Components.Schemas.CoachVisual]) -> [Int?] {
    var count = 0
    return visuals.map { visual in
      guard visual.kind != "recipe" else { return nil }
      count += 1
      return count
    }
  }
}

/// A figure's caption in serif italic, "Fig. 1 · Sleep this week", with a
/// note on the right: the dotted average's value, or the unit. The note
/// moves under the caption when both don't fit.
struct FigureCaption: View {
  let number: Int?
  let title: String
  var note: String?

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        caption
        Spacer(minLength: 0)
        noteView
      }
      VStack(alignment: .leading, spacing: 4) {
        caption
        noteView
      }
    }
  }

  private var caption: some View {
    let figure = number.map { Text("Fig. \($0) · ").foregroundStyle(Theme.inkSecondary) } ?? Text(verbatim: "")
    return Text("\(figure)\(Text(title).foregroundStyle(Theme.ink))")
      .font(.system(.subheadline, design: .serif))
      .italic()
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
  }

  @ViewBuilder
  private var noteView: some View {
    if let note {
      HStack(spacing: 5) {
        if note.hasPrefix("Average") {
          DottedRule().frame(width: 14)
        }
        Text(note)
          .font(.caption.weight(.semibold))
          .foregroundStyle(Theme.inkSecondary)
          .lineLimit(1)
      }
      .fixedSize()
    }
  }
}

extension CoachVisualView {
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
          .foregroundStyle(Theme.ink)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Theme.fill, in: .rect(cornerRadius: Theme.Radius.badge, style: .continuous))
        if index < order.count - 1 {
          let label = edges.first { $0.from == node.id && $0.to == order[index + 1].id }?.label
          Label(label ?? "", systemImage: "arrow.down")
            .font(.footnote)
            .foregroundStyle(Theme.inkSecondary)
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
            .clipShape(.rect(cornerRadius: Theme.Radius.badge, style: .continuous))
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
      Theme.fill
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
