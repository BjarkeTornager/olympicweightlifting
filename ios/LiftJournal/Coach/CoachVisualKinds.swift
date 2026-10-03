import Charts
import LiftAPI
import LiftTheme
import SwiftUI

// The visuals Coach composes from journal numbers, drawn natively in the
// figure grammar Today's charts use: a zero baseline, no gridlines, earlier
// days in track and the latest in the area's pigment, values labelled in
// place. Trends, targets, headline numbers, comparisons, splits, calendars
// and recipe cards. The website draws the same kinds
// (components/coach-visual-kinds.tsx).

typealias Visual = Components.Schemas.CoachVisual

/// A colour for a labelled number: the app's own pigment when the label
/// names something it already has one for (protein, water, sleep…),
/// otherwise the next in a fixed order. Never the accent, which is for
/// actions.
enum VisualTint {
  static func of(_ label: String, index: Int) -> Color {
    let name = label.lowercased()
    let known: [(String, Color)] = [
      ("body fat", Theme.bodyFat), ("protein", Theme.protein), ("carb", Theme.carbs), ("fat", Theme.fat),
      ("water", Theme.water), ("drink", Theme.water), ("sleep", Theme.sleep), ("calor", Theme.calories),
      ("energy", Theme.calories), ("kcal", Theme.calories), ("step", Theme.activity), ("heart", Theme.heart),
      ("hrv", Theme.variability), ("weight", Theme.body), ("body", Theme.body),
    ]
    if let match = known.first(where: { name.contains($0.0) }) { return match.1 }
    let order = [Theme.ink, Theme.water, Theme.sleep, Theme.activity, Theme.calories, Theme.body]
    return order[index % order.count]
  }

  /// Fat beside carbs, in a bar that can hatch: the food pigment's hatch, as
  /// on Today, rather than a colour of its own.
  static func hatched(_ label: String) -> Bool {
    let name = label.lowercased()
    return name.contains("fat") && !name.contains("body")
  }

  /// What a reply is about, for its byline and margin rule: the first
  /// figure, or else saved entry, whose title names an area ("Sleep this
  /// week", "Log breakfast"). A recipe is food.
  static func topic(visuals: [Visual], receipts: [String] = []) -> Category? {
    for visual in visuals {
      if visual.kind == "recipe" { return .food }
      if let topic = topic(visual.title) { return topic }
    }
    return receipts.lazy.compactMap(topic).first
  }

  static func topic(_ label: String) -> Category? {
    let name = label.lowercased()
    let areas: [(Category, [String])] = [
      (.body, ["body fat", "bodyweight", "weight", "body"]),
      (.sleep, ["sleep", "bedtime"]),
      (.water, ["water", "drink", "hydration"]),
      (
        .food,
        [
          "meal", "breakfast", "brunch", "lunch", "dinner", "snack", "food", "recipe", "nutrition", "macro",
          "protein", "carb", "fat", "calor", "kcal", "supplement", "vitamin",
        ]
      ),
      (.heart, ["heart", "hrv", "pulse"]),
      (.activity, ["step", "run", "walk", "ride", "cycl", "cardio", "burned", "activity"]),
      (.training, ["workout", "training", "session", "lift", "squat", "snatch", "clean", "jerk", "tonnage"]),
      (.checkin, ["check-in", "check in", "checkin", "feel", "soreness", "mood"]),
    ]
    return areas.first { area in area.1.contains { name.contains($0) } }?.0
  }
}

/// Numbers as a figure writes them: hours as "7 h 12", everything else as
/// "112" with up to one decimal, in the journal's British English.
enum VisualAmount {
  static func hours(_ unit: String?) -> Bool {
    ["h", "hr", "hrs", "hour", "hours"].contains(unit?.lowercased().trimmingCharacters(in: .whitespaces) ?? "")
  }

  /// Inside a bar: the number alone, or hours and minutes.
  static func short(_ value: Double, unit: String?) -> String {
    guard hours(unit) else { return formatted(value) }
    let minutes = Int((value * 60).rounded())
    return minutes % 60 == 0 ? "\(minutes / 60) h" : "\(minutes / 60) h \(minutes % 60)"
  }

  /// In a caption or a sentence: with its unit.
  static func long(_ value: Double, unit: String?) -> String {
    if hours(unit) { return short(value, unit: unit) }
    return [formatted(value), unit].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " ")
  }
}

private func formatted(_ value: Double) -> String {
  Format.decimal(value)
}

/// A dotted ink line across a chart: the average.
struct DottedRule: View {
  var body: some View {
    Canvas { context, size in
      var line = Path()
      line.move(to: CGPoint(x: 0, y: size.height / 2))
      line.addLine(to: CGPoint(x: size.width, y: size.height / 2))
      context.stroke(
        line, with: .color(Theme.ink.opacity(0.75)), style: StrokeStyle(lineWidth: 1.2, dash: [1.5, 2.5]))
    }
    .frame(height: 2)
    .accessibilityHidden(true)
  }
}

/// Amounts per day or per item. A run of days draws the earlier ones in
/// track and the latest in the pigment, labels the highest, the lowest and
/// the latest inside their bars, and dots the average; items are all in
/// the pigment, each with its value. Days are named in full beneath.
struct VisualBars: View {
  let visual: Visual
  let tint: Color
  @ScaledMetric(relativeTo: .caption2) private var height: CGFloat = 104

  var body: some View {
    let points = visual.points ?? []
    let unit = visual.unit
    let days = Self.isDays(points.map(\.label))
    let average = Self.average(visual)
    let top = max(points.map(\.value).max() ?? 0, 0.0001)
    let labelled = days ? Self.labelled(points.map(\.value)) : Set(points.indices)
    let gap: CGFloat = points.count > 12 ? 3 : 8
    let shown = Set(points.count > 8 ? VisualLineChart.sparse(points.map(\.label), count: 5) : points.map(\.label))
    VStack(spacing: 6) {
      HStack(alignment: .bottom, spacing: gap) {
        ForEach(Array(points.enumerated()), id: \.offset) { index, point in
          let latest = days && index == points.count - 1
          bar(
            point.value / top, lit: !days || latest, bold: latest,
            label: labelled.contains(index) ? VisualAmount.short(point.value, unit: unit) : nil,
            inside: points.count <= 8)
        }
      }
      .frame(height: height)
      .overlay(alignment: .top) {
        if let average {
          DottedRule().offset(y: height * (1 - average / top) - 1)
        }
      }
      .overlay(alignment: .bottom) {
        Rectangle().fill(Theme.ink.opacity(0.5)).frame(height: 1)
      }
      HStack(spacing: gap) {
        ForEach(Array(points.enumerated()), id: \.offset) { index, point in
          let latest = days && index == points.count - 1
          Text(shown.contains(point.label) ? point.label : "")
            .font(.caption2.weight(latest ? .bold : .medium))
            .foregroundStyle(latest ? Theme.ink : Theme.inkSecondary)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: .infinity)
        }
      }
    }
    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      points.map { "\($0.label): \(VisualAmount.long($0.value, unit: unit))" }.joined(separator: ", "))
  }

  /// One bar on the baseline, its value at its foot when it is tall enough
  /// to hold it, otherwise just above it.
  private func bar(_ share: Double, lit: Bool, bold: Bool, label: String?, inside: Bool) -> some View {
    let fits = inside && share >= 0.3
    return UnevenRoundedRectangle(topLeadingRadius: Theme.Radius.mark, topTrailingRadius: Theme.Radius.mark)
      .fill(lit ? tint : Theme.track)
      .frame(height: max(1, height * share))
      .overlay(alignment: fits ? .bottom : .top) {
        if let label {
          Text(label)
            .font(.caption2.weight(bold ? .bold : .semibold))
            .monospacedDigit()
            .foregroundStyle(fits && lit ? Theme.surface : Theme.ink)
            .lineLimit(1)
            .fixedSize()
            .padding(.bottom, fits ? 6 : 0)
            .alignmentGuide(.top) { fits ? $0[.top] : $0[.bottom] + 3 }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
  }

  /// Whether the labels name days or dates ("Mon", "Sa 26", "26 Sep",
  /// "Week 40"), rather than items: only a run of days has a latest.
  static func isDays(_ labels: [String]) -> Bool {
    let weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    let months = [
      "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
      "november", "december",
    ]
    return labels.count >= 2
      && labels.allSatisfy { label in
        let lower = label.lowercased().trimmingCharacters(in: .whitespaces)
        if lower.first?.isNumber == true { return true }
        let word = String(lower.prefix(while: \.isLetter))
        guard word.count >= 2 else { return false }
        return weekdays.contains { $0.hasPrefix(word) }
          || (word.count >= 3 && months.contains { $0.hasPrefix(word) })
          || ["today", "yesterday", "week", "wk"].contains(word)
      }
  }

  /// The bars whose values are written: the highest, the lowest and the
  /// latest.
  static func labelled(_ values: [Double]) -> Set<Int> {
    guard let high = values.indices.max(by: { values[$0] < values[$1] }),
      let low = values.indices.min(by: { values[$0] < values[$1] })
    else { return [] }
    return [high, low, values.count - 1]
  }

  /// The average a run of three days or more is dotted at.
  static func average(_ visual: Visual) -> Double? {
    let points = visual.points ?? []
    guard points.count >= 3, isDays(points.map(\.label)) else { return nil }
    return points.map(\.value).reduce(0, +) / Double(points.count)
  }
}

/// Levels over time, up to three lines, with an optional target as a dotted
/// line. No gridlines; three values at the side, the days beneath, the
/// latest in bold ink and ringed on the line.
struct VisualLineChart: View {
  let visual: Visual
  /// The topic's pigment, for a single line.
  var tint: Color?

  var body: some View {
    let series = visual.series ?? []
    let unit = visual.unit ?? ""
    let colours = series.indices.map { index in
      series.count == 1
        ? tint ?? VisualTint.of(series[index].name, index: 0) : VisualTint.of(series[index].name, index: index)
    }
    let labels = series.first?.points.map(\.label) ?? []
    VStack(alignment: .leading, spacing: 10) {
      Chart {
        ForEach(Array(series.enumerated()), id: \.offset) { index, line in
          ForEach(Array(line.points.enumerated()), id: \.offset) { _, point in
            LineMark(x: .value("Day", point.label), y: .value(unit, point.value))
              .foregroundStyle(by: .value("Series", line.name))
              .interpolationMethod(.catmullRom)
              .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
          }
          if let last = line.points.last {
            PointMark(x: .value("Day", last.label), y: .value(unit, last.value))
              .symbol {
                Circle()
                  .strokeBorder(colours[index], lineWidth: 2)
                  .background(Circle().fill(Theme.surface))
                  .frame(width: 9, height: 9)
              }
          }
        }
        if let target = visual.target {
          RuleMark(y: .value("Target", target))
            .foregroundStyle(Theme.ink.opacity(0.75))
            .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [1.5, 2.5]))
            .annotation(position: .top, alignment: .leading) {
              Text("Target \(VisualAmount.long(target, unit: unit))")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.inkSecondary)
            }
        }
      }
      .chartForegroundStyleScale(domain: series.map(\.name), range: colours)
      .chartLegend(.hidden)
      .chartYScale(domain: .automatic(includesZero: false))
      .chartYAxis {
        AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { _ in
          AxisValueLabel().font(.caption2).foregroundStyle(Theme.inkSecondary)
        }
      }
      .chartXAxis {
        // The labels are names, not dates: show about four, evenly spaced,
        // always with the first and the last.
        // The outer two lean inwards so the chart's edges don't cut them.
        AxisMarks(values: Self.sparse(labels)) { value in
          let last = value.index == value.count - 1
          AxisValueLabel(anchor: value.index == 0 ? .topLeading : last ? .topTrailing : .top) {
            if let label = value.as(String.self) {
              Text(label)
                .font(.caption2.weight(last ? .bold : .medium))
                .foregroundStyle(last ? Theme.ink : Theme.inkSecondary)
            }
          }
        }
      }
      .frame(height: 160)
      if series.count > 1 {
        FlowLayout(spacing: 14, lineSpacing: 4) {
          ForEach(Array(series.enumerated()), id: \.offset) { index, line in
            HStack(spacing: 6) {
              Key(tint: colours[index])
              Text(line.name).font(.footnote).foregroundStyle(Theme.inkSecondary)
            }
          }
        }
      } else if let line = series.first, let first = line.points.first, let last = line.points.last {
        HStack {
          Text("\(first.label): \(VisualAmount.long(first.value, unit: unit))")
            .foregroundStyle(Theme.inkSecondary)
          Spacer()
          Text("\(last.label): \(VisualAmount.long(last.value, unit: unit))")
            .fontWeight(.semibold)
            .foregroundStyle(Theme.ink)
        }
        .font(.footnote)
        .monospacedDigit()
      }
    }
    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
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

/// Amounts against their targets, counted as on Today's Ledger: a row of
/// marks, one for a round amount, filled to the value.
struct VisualProgress: View {
  let visual: Visual

  var body: some View {
    let targets = visual.targets ?? []
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(targets.enumerated()), id: \.offset) { index, item in
        let tint = VisualTint.of(item.label, index: index)
        let per = Self.perMark(item.target)
        VStack(alignment: .leading, spacing: 8) {
          CardLabel(title: item.label, key: tint)
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Measure(value: formatted(item.value), unit: item.unit, role: .inline)
              .fixedSize()
            Text("of \(VisualAmount.long(item.target, unit: item.unit))")
              .font(.footnote)
              .foregroundStyle(Theme.inkSecondary)
          }
          IsotypeMeter(value: item.value, target: item.target, unit: per, tint: tint, markWidth: 5, height: 22)
          Text("One mark = \(VisualAmount.long(per, unit: item.unit))")
            .font(.caption2.weight(.medium))
            .foregroundStyle(Theme.inkSecondary)
        }
        .padding(.vertical, 12)
        .overlay(alignment: .top) {
          if index > 0 { Rectangle().fill(Theme.rule).frame(height: 1) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
          "\(item.label): \(formatted(item.value)) of \(VisualAmount.long(item.target, unit: item.unit))")
      }
    }
  }

  /// What one mark stands for: the smallest round amount (1, 2, 2.5 or 5
  /// times a power of ten) that counts the target in 20 marks or fewer.
  static func perMark(_ target: Double) -> Double {
    guard target > 0, target.isFinite else { return 1 }
    var magnitude = pow(10, floor(log10(target / 20)))
    while true {
      for factor in [1, 2, 2.5, 5] where target / (factor * magnitude) <= 20 {
        return factor * magnitude
      }
      magnitude *= 10
    }
  }
}

/// Headline numbers, two to a row in cells divided by hairlines, each with
/// its kicker, a serif value and how it changed. One to a row at the
/// largest text sizes.
struct VisualStats: View {
  let visual: Visual
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let stats = visual.stats ?? []
    let perRow = typeSize.isAccessibilitySize ? 1 : 2
    // A plain grid: the thread around it is already lazy.
    Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
      ForEach(Array(stride(from: 0, to: stats.count, by: perRow)), id: \.self) { start in
        if start > 0 {
          Rectangle().fill(Theme.rule).frame(height: 1).gridCellUnsizedAxes(.horizontal)
        }
        GridRow {
          cell(stats[start]).padding(.trailing, perRow == 2 ? 12 : 0)
          if perRow == 2 {
            Group {
              if start + 1 < stats.count {
                cell(stats[start + 1])
              } else {
                Color.clear.frame(maxWidth: .infinity)
              }
            }
            .padding(.leading, 12)
            .overlay(alignment: .leading) { Rectangle().fill(Theme.rule).frame(width: 1) }
          }
        }
      }
    }
  }

  private func cell(_ stat: Components.Schemas.VisualStat) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      CardLabel(title: stat.label)
      Measure(value: stat.value, unit: stat.unit, role: .inline)
      if let change = stat.change {
        Label(change, systemImage: symbol(stat.trend))
          .font(.footnote.weight(.medium))
          .foregroundStyle(Theme.inkSecondary)
          .labelStyle(.titleAndIcon)
      }
    }
    .padding(.vertical, 10)
    .frame(maxWidth: .infinity, alignment: .topLeading)
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

/// One period against another, row by row between hairlines. A change for
/// the better is in ink and bold, one for the worse in secondary ink: a
/// record, not a verdict, so never red.
struct VisualComparison: View {
  let visual: Visual
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .subheadline) private var column: CGFloat = 72

  var body: some View {
    let before = visual.beforeLabel ?? "Before"
    let after = visual.afterLabel ?? "After"
    VStack(spacing: 0) {
      if !typeSize.isAccessibilitySize {
        HStack {
          Spacer()
          Text(before).frame(width: column, alignment: .trailing)
          Text(after).frame(width: column, alignment: .trailing)
          Text("Change").frame(width: column, alignment: .trailing)
        }
        .kicker()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.bottom, 6)
      }
      ForEach(Array((visual.comparisons ?? []).enumerated()), id: \.offset) { index, row in
        let change = row.after - row.before
        let good: Bool? = row.higherIsBetter.flatMap { change == 0 ? nil : $0 == (change > 0) }
        let delta = "\(change > 0 ? "+" : "")\(formatted(change))"
        Group {
          if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
              Text(row.label).fontWeight(.semibold).foregroundStyle(Theme.ink)
              Text("\(before) \(amount(row.before, row.unit)) · \(after) \(amount(row.after, row.unit)) · \(delta)")
                .foregroundStyle(Theme.inkSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          } else {
            HStack {
              Text(row.label).lineLimit(2).foregroundStyle(Theme.ink)
              Spacer(minLength: 6)
              Text(amount(row.before, row.unit)).frame(width: column, alignment: .trailing)
                .foregroundStyle(Theme.inkSecondary)
              Text(amount(row.after, row.unit)).frame(width: column, alignment: .trailing)
                .fontWeight(.semibold).foregroundStyle(Theme.ink)
              Text(delta)
                .font(.footnote.weight(good == true ? .bold : .semibold))
                .foregroundStyle(good == true ? Theme.ink : Theme.inkSecondary)
                .frame(width: column, alignment: .trailing)
            }
          }
        }
        .font(.subheadline)
        .monospacedDigit()
        .padding(.vertical, 9)
        .overlay(alignment: .top) { Rectangle().fill(Theme.rule).frame(height: 1) }
        .accessibilityElement(children: .combine)
        .accessibilityValue(good.map { $0 ? "Better" : "Worse" } ?? "")
      }
    }
  }

  private func amount(_ value: Double, _ unit: String?) -> String {
    [formatted(value), unit].compactMap { $0 }.joined(separator: " ")
  }
}

/// How a whole divides: one 12 pt bar with 3 pt gaps, fat hatched in the
/// food pigment as on Today, and a key for each part below.
struct VisualSplit: View {
  let visual: Visual

  var body: some View {
    let parts = visual.parts ?? []
    let total = max(parts.reduce(0) { $0 + $1.value }, 0.0001)
    let percentages = (visual.unit ?? "").contains("%")
    let tints = parts.enumerated().map { index, part in
      VisualTint.hatched(part.label) ? Theme.carbs : VisualTint.of(part.label, index: index)
    }
    VStack(alignment: .leading, spacing: 10) {
      GeometryReader { proxy in
        HStack(spacing: 3) {
          ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
            Group {
              if VisualTint.hatched(part.label) {
                Hatch(tint: tints[index])
              } else {
                RoundedRectangle(cornerRadius: Theme.Radius.key).fill(tints[index])
              }
            }
            .frame(width: max(0, (proxy.size.width - CGFloat(parts.count - 1) * 3) * part.value / total))
          }
        }
      }
      .frame(height: 12)
      .accessibilityHidden(true)
      VStack(spacing: 0) {
        ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
          HStack(spacing: 8) {
            Key(tint: tints[index], hatched: VisualTint.hatched(part.label))
            Text(part.label).font(.subheadline).foregroundStyle(Theme.ink)
            Spacer()
            let share = "\(Int((100 * part.value / total).rounded())) %"
            // Coach should send amounts; when they are already shares, the
            // share alone says it (the title and caption give the context).
            if percentages {
              Text(share).font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
            } else {
              Text("\(formatted(part.value)) \(visual.unit ?? "")")
                .font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
              Text(share)
                .font(.footnote).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                .frame(minWidth: 40, alignment: .trailing)
            }
          }
          .padding(.vertical, 8)
          .overlay(alignment: .top) {
            if index > 0 { Rectangle().fill(Theme.rule).frame(height: 1) }
          }
          .accessibilityElement(children: .combine)
        }
      }
    }
  }
}

/// Which days something happened, as a month-style grid from Monday, in the
/// topic's pigment: deeper for more. Days are placed by their date; days
/// Coach left out show as a plain number.
struct VisualCalendar: View {
  let visual: Visual
  var tint: Color = Theme.ink

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
            Text(name)
              .font(.caption2.weight(.semibold))
              .foregroundStyle(Theme.inkSecondary)
              .frame(maxWidth: .infinity)
              .accessibilityHidden(true)
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
      .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
      if let legend = visual.legend {
        Text(legend).font(.footnote).foregroundStyle(Theme.inkSecondary)
      }
    }
  }

  private func day(_ cell: Cell) -> some View {
    Text("\(cell.number)")
      .font(.caption2.weight(cell.level == 3 ? .bold : .medium))
      .monospacedDigit()
      .foregroundStyle(cell.level == 3 ? Theme.surface : cell.level == nil ? Theme.inkSecondary : Theme.ink)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(fill(cell.level), in: .rect(cornerRadius: Theme.Radius.key, style: .continuous))
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
    case 3: tint
    case 2: tint.opacity(0.45)
    case 1: tint.opacity(0.22)
    case 0: Theme.track
    default: .clear
    }
  }
}

/// A recipe or meal idea, set like a cookbook's page: the AI picture of the
/// dish when one was asked for, the name in the serif with servings and
/// time, every ingredient with its amount, numbered steps (none for a quick
/// idea) and the estimated nutrition per serving as serif numbers.
struct VisualRecipe: View {
  let visual: Visual
  /// On the call screen: the picture as a strip and the first ingredients
  /// only, without the method or nutrition.
  var compact = false
  static let compactIngredients = 4
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .subheadline) private var amountWidth: CGFloat = 76

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
      VStack(alignment: .leading, spacing: 4) {
        CardLabel(title: "Recipe", key: Theme.calories)
        Text(visual.title)
          .folio(.inline)
          .foregroundStyle(Theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 2)
          .accessibilityAddTraits(.isHeader)
        Text(Self.meta(servings: visual.servings ?? 1, minutes: visual.minutes))
          .font(.subheadline)
          .foregroundStyle(Theme.inkSecondary)
      }
      section("Ingredients") {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(shown.enumerated()), id: \.offset) { index, ingredient in
            ingredientRow(ingredient.amount, ingredient.item)
              .padding(.vertical, 7)
              .overlay(alignment: .top) {
                if index > 0 { Rectangle().fill(Theme.rule).frame(height: 1) }
              }
          }
        }
        if shown.count < ingredients.count {
          Text("+\(ingredients.count - shown.count) more")
            .font(.footnote)
            .foregroundStyle(Theme.inkSecondary)
        }
      }
      if !steps.isEmpty {
        section("Method") {
          ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
            HStack(alignment: .firstTextBaseline, spacing: 12) {
              Text("\(index + 1)")
                .font(.system(.body, design: .serif))
                .monospacedDigit()
                .foregroundStyle(Theme.inkSecondary)
                .frame(minWidth: 18, alignment: .trailing)
              Text(step)
                .font(.system(.body, design: .serif))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
          }
        }
      }
      if !nutrition.isEmpty {
        section("Estimate per serving") {
          // All in a row while they fit, then two to a row: larger text
          // sizes need the room.
          ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 0) {
              ForEach(Array(nutrition.enumerated()), id: \.offset) { index, item in
                nutrient(item, divided: index > 0)
              }
            }
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 10) {
              ForEach(Array(stride(from: 0, to: nutrition.count, by: 2)), id: \.self) { start in
                GridRow {
                  nutrient(nutrition[start], divided: false)
                  if start + 1 < nutrition.count {
                    nutrient(nutrition[start + 1], divided: true)
                  } else {
                    Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                  }
                }
              }
            }
          }
        }
        .accessibilityElement(children: .combine)
      }
    }
  }

  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Rectangle().fill(Theme.rule).frame(height: 1)
      CardLabel(title: title).padding(.top, 4)
      content()
    }
  }

  @ViewBuilder
  private func ingredientRow(_ amount: String?, _ item: String) -> some View {
    if typeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        Text(item).foregroundStyle(Theme.ink)
        if let amount { Text(amount).foregroundStyle(Theme.inkSecondary).monospacedDigit() }
      }
      .font(.subheadline)
      .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        Text(amount ?? "")
          .foregroundStyle(Theme.inkSecondary)
          .monospacedDigit()
          .frame(width: amountWidth, alignment: .leading)
        Text(item)
          .foregroundStyle(Theme.ink)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .font(.subheadline)
    }
  }

  private func nutrient(_ item: Nutrient, divided: Bool) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(item.label).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1)
      Measure(value: item.value, role: .inline).fixedSize()
    }
    .padding(.leading, divided ? 12 : 0)
    .padding(.trailing, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .leading) {
      if divided { Rectangle().fill(Theme.rule).frame(width: 1) }
    }
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

#if DEBUG
  /// The recipe as Coach sends it, in full and as the call screen's compact
  /// card, with its AI picture.
  private struct RecipePreview: View {
    init() {
      CoachPicture.cache.setObject(PreviewData.dishPicture, forKey: PreviewData.pictureID as NSString)
    }

    var body: some View {
      ScrollView {
        VStack(spacing: 20) {
          CoachVisualView(visual: PreviewData.recipe, tint: Theme.calories).card(padding: 14)
          CoachVisualView(visual: PreviewData.recipe, compact: true, tint: Theme.calories).card(padding: 14)
        }
        .padding(20)
      }
      .background(Theme.background)
      .environment(AppModel())
    }
  }

  #Preview("Recipe card") { RecipePreview() }
  #Preview("Recipe card, dark") { RecipePreview().preferredColorScheme(.dark) }
  #Preview("Recipe card, AX3") { RecipePreview().dynamicTypeSize(.accessibility3) }
#endif
