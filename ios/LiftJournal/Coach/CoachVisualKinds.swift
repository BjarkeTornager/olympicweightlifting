import Charts
import LiftAPI
import LiftTheme
import SwiftUI

// The visuals Coach composes from journal numbers, drawn natively: trends,
// targets, headline numbers, comparisons, splits and calendars, and recipe
// cards. The website draws the same kinds (components/coach-visual-kinds.tsx).

typealias Visual = Components.Schemas.CoachVisual

/// A colour for a labelled number: the app's own colour when the label names
/// something it already has one for (protein, water, sleep…), otherwise the
/// next in a fixed order.
enum VisualTint {
  static func of(_ label: String, index: Int) -> Color {
    let name = label.lowercased()
    let known: [(String, Color)] = [
      ("protein", Theme.protein), ("carb", Theme.carbs), ("fat", Theme.fat), ("water", Theme.water),
      ("drink", Theme.water), ("sleep", Theme.sleep), ("calor", Theme.calories), ("energy", Theme.calories),
      ("kcal", Theme.calories), ("step", Theme.activity), ("heart", Theme.heart), ("hrv", Theme.variability),
      ("weight", Theme.body), ("body", Theme.body),
    ]
    if let match = known.first(where: { name.contains($0.0) }) { return match.1 }
    let order = [Theme.accent, Theme.water, Theme.protein, Theme.sleep, Theme.activity, Theme.heart]
    return order[index % order.count]
  }
}

private func formatted(_ value: Double) -> String {
  value.formatted(.number.precision(.fractionLength(0...1)))
}

/// Levels over time, up to three lines, with an optional target line.
struct VisualLineChart: View {
  let visual: Visual

  var body: some View {
    let series = visual.series ?? []
    let unit = visual.unit ?? ""
    VStack(alignment: .leading, spacing: 10) {
      Chart {
        ForEach(Array(series.enumerated()), id: \.offset) { index, line in
          ForEach(Array(line.points.enumerated()), id: \.offset) { _, point in
            LineMark(x: .value("Day", point.label), y: .value(unit, point.value))
              .foregroundStyle(by: .value("Series", line.name))
              .interpolationMethod(.catmullRom)
              .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
          }
          if let last = line.points.last {
            PointMark(x: .value("Day", last.label), y: .value(unit, last.value))
              .foregroundStyle(by: .value("Series", line.name))
              .symbolSize(30)
          }
        }
        if let target = visual.target {
          RuleMark(y: .value("Target", target))
            .foregroundStyle(.secondary)
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .annotation(position: .top, alignment: .leading) {
              Text("Target \(formatted(target)) \(unit)").font(.caption2).foregroundStyle(.secondary)
            }
        }
      }
      .chartForegroundStyleScale(
        domain: series.map(\.name),
        range: series.indices.map { VisualTint.of(series[$0].name, index: $0) }
      )
      .chartLegend(series.count > 1 ? .visible : .hidden)
      .chartYScale(domain: .automatic(includesZero: false))
      .chartXAxis {
        // The labels are names, not dates: show about four, evenly spaced,
        // always with the first and the last.
        // The outer two lean inwards so the chart's edges don't cut them.
        AxisMarks(values: Self.sparse(series.first?.points.map(\.label) ?? [])) { value in
          AxisGridLine()
          AxisValueLabel(
            anchor: value.index == 0 ? .topLeading : value.index == value.count - 1 ? .topTrailing : .top)
        }
      }
      .frame(height: 180)
      if series.count == 1, let line = series.first, let first = line.points.first, let last = line.points.last {
        HStack {
          Text("\(first.label): \(formatted(first.value)) \(unit)")
          Spacer()
          Text("\(last.label): \(formatted(last.value)) \(unit)").fontWeight(.semibold)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .monospacedDigit()
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      series.map { line in
        "\(line.name) from \(formatted(line.points.first?.value ?? 0)) to \(formatted(line.points.last?.value ?? 0)) \(unit)"
      }.joined(separator: "; "))
  }
}

extension VisualLineChart {
  static func sparse(_ labels: [String], count: Int = 4) -> [String] {
    guard labels.count > count else { return labels }
    let step = Double(labels.count - 1) / Double(count - 1)
    return (0..<count).map { labels[Int((Double($0) * step).rounded())] }
  }
}

/// Amounts against their targets: rings for up to three, bars for more.
struct VisualProgress: View {
  let visual: Visual

  var body: some View {
    let targets = visual.targets ?? []
    if targets.count <= 3 {
      HStack(spacing: 8) {
        ForEach(Array(targets.enumerated()), id: \.offset) { index, item in
          TargetRing(
            title: item.label, value: formatted(item.value), target: "of \(formatted(item.target)) \(item.unit)",
            progress: item.target > 0 ? item.value / item.target : 0,
            tint: VisualTint.of(item.label, index: index))
        }
      }
    } else {
      VStack(spacing: 12) {
        ForEach(Array(targets.enumerated()), id: \.offset) { index, item in
          VStack(alignment: .leading, spacing: 5) {
            HStack {
              Text(item.label).font(.subheadline)
              Spacer()
              Text("\(formatted(item.value)) / \(formatted(item.target)) \(item.unit)")
                .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
            GeometryReader { proxy in
              ZStack(alignment: .leading) {
                Capsule().fill(Theme.track)
                Capsule()
                  .fill(VisualTint.of(item.label, index: index))
                  .frame(width: proxy.size.width * min(1, max(0.02, item.target > 0 ? item.value / item.target : 0)))
              }
            }
            .frame(height: 8)
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(item.label): \(formatted(item.value)) of \(formatted(item.target)) \(item.unit)")
        }
      }
    }
  }
}

/// Headline numbers as small cards, two to a row.
struct VisualStats: View {
  let visual: Visual

  var body: some View {
    let stats = visual.stats ?? []
    // A plain grid, two to a row: the thread around it is already lazy.
    Grid(horizontalSpacing: 8, verticalSpacing: 8) {
      ForEach(Array(stride(from: 0, to: stats.count, by: 2)), id: \.self) { start in
        GridRow {
          card(stats[start])
          if start + 1 < stats.count {
            card(stats[start + 1])
          } else {
            Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
          }
        }
      }
    }
  }

  private func card(_ stat: Components.Schemas.VisualStat) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      CardLabel(title: stat.label)
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(stat.value)
          .font(.system(.title3, design: .rounded, weight: .bold))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        if let unit = stat.unit {
          Text(unit).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
      }
      if let change = stat.change {
        Label(change, systemImage: symbol(stat.trend))
          .font(.caption.weight(.medium))
          .foregroundStyle(.secondary)
          .labelStyle(.titleAndIcon)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(12)
    .background(Theme.fill, in: .rect(cornerRadius: 12, style: .continuous))
    .accessibilityElement(children: .combine)
  }

  private func symbol(_ trend: String?) -> String {
    switch trend {
    case "up": "arrow.up.right"
    case "down": "arrow.down.right"
    default: "arrow.right"
    }
  }
}

/// One period against another, each change marked good or not when that's
/// known.
struct VisualComparison: View {
  let visual: Visual

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Spacer()
        Text(visual.beforeLabel ?? "Before").frame(width: 72, alignment: .trailing)
        Text(visual.afterLabel ?? "After").frame(width: 72, alignment: .trailing)
        Text("Change").frame(width: 70, alignment: .trailing)
      }
      .font(.caption.weight(.semibold))
      .foregroundStyle(.secondary)
      .padding(.bottom, 6)
      ForEach(Array((visual.comparisons ?? []).enumerated()), id: \.offset) { index, row in
        if index > 0 { Divider() }
        let change = row.after - row.before
        let good: Bool? = row.higherIsBetter.flatMap { change == 0 ? nil : $0 == (change > 0) }
        HStack {
          Text(row.label).font(.subheadline).lineLimit(2)
          Spacer(minLength: 6)
          Text(amount(row.before, row.unit)).frame(width: 72, alignment: .trailing).foregroundStyle(.secondary)
          Text(amount(row.after, row.unit)).frame(width: 72, alignment: .trailing).fontWeight(.semibold)
          Text("\(change > 0 ? "+" : "")\(formatted(change))")
            .font(.caption.weight(.semibold))
            .foregroundStyle(good == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(good! ? Theme.success : Theme.danger))
            .frame(width: 70, alignment: .trailing)
        }
        .font(.subheadline)
        .monospacedDigit()
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
      }
    }
  }

  private func amount(_ value: Double, _ unit: String?) -> String {
    [formatted(value), unit].compactMap { $0 }.joined(separator: " ")
  }
}

/// How a whole divides, as one bar with a legend.
struct VisualSplit: View {
  let visual: Visual

  var body: some View {
    let parts = visual.parts ?? []
    let total = max(parts.reduce(0) { $0 + $1.value }, 0.0001)
    let percentages = (visual.unit ?? "").contains("%")
    VStack(alignment: .leading, spacing: 10) {
      GeometryReader { proxy in
        HStack(spacing: 3) {
          ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
            Capsule()
              .fill(VisualTint.of(part.label, index: index))
              .frame(width: max(0, (proxy.size.width - CGFloat(parts.count - 1) * 3) * part.value / total))
          }
        }
      }
      .frame(height: 10)
      ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
        HStack(spacing: 8) {
          Circle().fill(VisualTint.of(part.label, index: index)).frame(width: 8, height: 8)
          Text(part.label).font(.subheadline)
          Spacer()
          let share = "\(Int((100 * part.value / total).rounded())) %"
          // Coach should send amounts; when they are already shares, the
          // share alone says it (the title and caption give the context).
          if percentages {
            Text(share).font(.subheadline.weight(.semibold)).monospacedDigit()
          } else {
            Text("\(formatted(part.value)) \(visual.unit ?? "")").font(.subheadline.weight(.semibold)).monospacedDigit()
            Text(share)
              .font(.caption).foregroundStyle(.secondary).monospacedDigit()
              .frame(width: 40, alignment: .trailing)
          }
        }
        .accessibilityElement(children: .combine)
      }
    }
  }
}

/// Which days something happened, as a month-style grid from Monday. Days
/// are placed by their date; days Coach left out show as a plain number.
struct VisualCalendar: View {
  let visual: Visual

  struct Cell: Equatable {
    let date: String
    let number: Int
    let level: Int?
    let label: String?
  }

  var body: some View {
    let (offset, cells) = Self.layout(visual.days ?? [])
    // Plain rows of fixed height rather than a lazy grid of squares: the
    // thread is a lazy stack, and a height that follows the width set it
    // laying out again and again.
    let slots = Array(repeating: Cell?.none, count: offset) + cells.map(Optional.some)
    VStack(alignment: .leading, spacing: 8) {
      VStack(spacing: 5) {
        HStack(spacing: 5) {
          ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, name in
            Text(name).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
          }
        }
        ForEach(Array(stride(from: 0, to: slots.count, by: 7)), id: \.self) { start in
          HStack(spacing: 5) {
            ForEach(start..<start + 7, id: \.self) { index in
              if index < slots.count, let cell = slots[index] {
                day(cell)
              } else {
                Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
              }
            }
          }
          .frame(height: 34)
        }
      }
      if let legend = visual.legend {
        Text(legend).font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private func day(_ cell: Cell) -> some View {
    Text("\(cell.number)")
      .font(.caption2.weight(.medium))
      .monospacedDigit()
      .foregroundStyle(color(cell.level))
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(fill(cell.level), in: .rect(cornerRadius: 6, style: .continuous))
      .accessibilityElement()
      .accessibilityLabel("\(cell.date): \(cell.label ?? cell.level.map { "level \($0)" } ?? "no record")")
  }

  /// Every day from the first given to the last, at most six weeks, and how
  /// many blank cells come before the first so it falls on its weekday.
  static func layout(_ days: [Components.Schemas.VisualDay]) -> (offset: Int, cells: [Cell]) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let given = Dictionary(days.map { ($0.date, $0) }, uniquingKeysWith: { first, _ in first })
    guard let first = given.keys.min(), let last = given.keys.max(),
      let start = JournalDay.date(first, calendar: calendar)
    else { return (0, []) }
    var cells: [Cell] = []
    var date = start
    while cells.count < 42 {
      let key = JournalDay.string(date, calendar: calendar)
      guard key <= last else { break }
      let day = given[key]
      cells.append(
        Cell(date: key, number: calendar.component(.day, from: date), level: day?.level, label: day?.label))
      date = calendar.date(byAdding: .day, value: 1, to: date)!
    }
    return ((calendar.component(.weekday, from: start) + 5) % 7, cells)
  }

  private func fill(_ level: Int?) -> Color {
    switch level {
    case 3: Theme.accent
    case 2: Theme.accent.opacity(0.65)
    case 1: Theme.accent.opacity(0.3)
    case 0: Theme.track
    default: .clear
    }
  }

  private func color(_ level: Int?) -> Color {
    switch level {
    case .none: .secondary
    case .some(let level) where level >= 2: Theme.onAccent
    default: .primary
    }
  }
}

/// A recipe or meal idea: an AI picture of the dish when one was asked for,
/// servings and time, every ingredient with its amount, numbered steps (none
/// for a quick idea) and the estimated nutrition per serving.
struct VisualRecipe: View {
  let visual: Visual
  /// On the call screen: the picture as a strip and the first ingredients
  /// only, without the method or nutrition.
  var compact = false
  static let compactIngredients = 4

  struct Nutrient: Equatable {
    let label: String
    let value: String
  }

  var body: some View {
    let ingredients = visual.ingredients ?? []
    let shown = compact ? Array(ingredients.prefix(Self.compactIngredients)) : ingredients
    let steps = compact ? [] : visual.steps ?? []
    let nutrition = compact ? [] : Self.nutrition(visual.nutrition)
    VStack(alignment: .leading, spacing: 16) {
      // Drawn after the card appears; a strip in the compact card.
      if let picture = visual.pictureId {
        CoachPicture(id: picture, title: visual.title, height: compact ? 140 : nil)
      }
      Text(Self.meta(servings: visual.servings ?? 1, minutes: visual.minutes))
        .font(.subheadline)
        .foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 8) {
        CardLabel(title: "Ingredients")
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
          ForEach(Array(shown.enumerated()), id: \.offset) { _, ingredient in
            GridRow {
              Text(ingredient.amount ?? "")
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .frame(maxWidth: 110, alignment: .leading)
              Text(ingredient.item)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
          }
        }
        .font(.subheadline)
        if shown.count < ingredients.count {
          Text("+\(ingredients.count - shown.count) more")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      if !steps.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          CardLabel(title: "Method")
          ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Text("\(index + 1)")
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.accent)
                .frame(minWidth: 16, alignment: .trailing)
              Text(step)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
          }
        }
      }
      if !nutrition.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          CardLabel(title: "Estimate per serving")
          // All in a row while they fit, then two to a row, then one: larger
          // text sizes need the room.
          ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
              ForEach(nutrition, id: \.label) { nutrient($0) }
            }
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
              ForEach(Array(stride(from: 0, to: nutrition.count, by: 2)), id: \.self) { start in
                GridRow {
                  nutrient(nutrition[start])
                  if start + 1 < nutrition.count {
                    nutrient(nutrition[start + 1])
                  } else {
                    Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                  }
                }
              }
            }
            VStack(spacing: 8) {
              ForEach(nutrition, id: \.label) { nutrient($0) }
            }
          }
        }
        .accessibilityElement(children: .combine)
      }
    }
  }

  private func nutrient(_ item: Nutrient) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(item.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      Text(item.value)
        .font(.subheadline.weight(.semibold))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(Theme.fill, in: .rect(cornerRadius: 10, style: .continuous))
  }

  /// The line under the title, such as "2 servings · 1 h 15 min", as on the
  /// website.
  static func meta(servings: Int, minutes: Int?) -> String {
    var parts = ["\(servings) \(servings == 1 ? "serving" : "servings")"]
    if let minutes {
      parts.append(
        minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h" + (minutes % 60 > 0 ? " \(minutes % 60) min" : ""))
    }
    return parts.joined(separator: " · ")
  }

  /// The nutrition values Coach gave, in a fixed order.
  static func nutrition(_ nutrition: Components.Schemas.RecipeNutrition?) -> [Nutrient] {
    guard let nutrition else { return [] }
    return [
      ("Calories", nutrition.kcal, "kcal"), ("Protein", nutrition.protein, "g"),
      ("Carbs", nutrition.carbs, "g"), ("Fat", nutrition.fat, "g"),
    ].compactMap { label, value, unit in
      value.map { Nutrient(label: label, value: "\(formatted($0)) \(unit)") }
    }
  }
}
