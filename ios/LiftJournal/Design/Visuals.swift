import Charts
import LiftTheme
import SwiftUI

/// A progress ring with rounded ends over a neutral track, as in Fitness.
/// Past 100 % the ring stays full; the number beside it tells the rest.
struct ProgressRing: View {
  let progress: Double
  let tint: Color
  var lineWidth: CGFloat = 10

  var body: some View {
    ZStack {
      Circle().stroke(Theme.track, lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: max(0.001, min(1, progress)))
        .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
    .animation(.spring(duration: 0.8, bounce: 0.2), value: progress)
    .accessibilityHidden(true)
  }
}

/// One of the day's targets: a ring with the value inside, and a label.
struct TargetRing: View {
  let title: String
  let value: String
  let target: String
  let progress: Double
  let tint: Color

  var body: some View {
    VStack(spacing: 8) {
      ZStack {
        ProgressRing(progress: progress, tint: tint, lineWidth: 9)
        VStack(spacing: -2) {
          Text(value)
            .font(.system(.headline, design: .rounded, weight: .bold))
            .monospacedDigit()
            .minimumScaleFactor(0.6)
            .lineLimit(1)
            .contentTransition(.numericText())
          Text(target)
            .font(.system(.caption2, design: .rounded, weight: .medium))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 12)
      }
      .frame(width: 88, height: 88)
      CardLabel(title: title)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(title): \(value) of \(target)")
  }
}

/// A small chart of the last days, without axes: bars for amounts, a line
/// for levels. Earlier days are neutral and the latest is in colour. Missing
/// days are left out rather than drawn as zero; among bars they keep a faint
/// stub, so the span of days stays visible.
struct Sparkline: View {
  enum Style { case bars, line }
  let values: [Double?]
  let tint: Color
  var style: Style = .bars

  var body: some View {
    let points = values.enumerated().compactMap { index, value in value.map { (index, $0) } }
    let days = values.indices.map(String.init)
    let stub = (points.map(\.1).max() ?? 1) * 0.05
    Chart {
      if style == .bars {
        ForEach(values.indices.filter { values[$0] == nil }, id: \.self) { index in
          BarMark(x: .value("Day", String(index)), y: .value("Value", stub), width: .ratio(0.6))
            .foregroundStyle(Theme.track.opacity(0.6))
            .cornerRadius(3)
        }
      }
      ForEach(points, id: \.0) { index, value in
        switch style {
        case .bars:
          BarMark(x: .value("Day", String(index)), y: .value("Value", value), width: .ratio(0.6))
            .foregroundStyle(index == values.count - 1 ? tint : Theme.track)
            .cornerRadius(3)
        case .line:
          LineMark(x: .value("Day", String(index)), y: .value("Value", value))
            .foregroundStyle(tint)
            .interpolationMethod(.catmullRom)
            .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
          if index == points.last?.0 {
            PointMark(x: .value("Day", String(index)), y: .value("Value", value))
              .foregroundStyle(tint)
              .symbolSize(28)
          }
        }
      }
    }
    .chartXAxis(.hidden)
    .chartYAxis(.hidden)
    .chartXScale(domain: days)
    .chartYScale(domain: yDomain(points.map(\.1)))
    .accessibilityHidden(true)
  }

  private func yDomain(_ values: [Double]) -> ClosedRange<Double> {
    guard let low = values.min(), let high = values.max() else { return 0...1 }
    if style == .bars { return 0...max(high, 0.001) }
    let pad = max((high - low) * 0.25, abs(high) * 0.01, 0.5)
    return (low - pad)...(high + pad)
  }
}

/// A square-ish tile for one measurement: a tinted icon and title, the value,
/// a note, and a small chart of recent days.
struct MetricTile<Chart: View>: View {
  let title: String
  let category: Category
  let value: String?
  var unit: String?
  var note: String?
  var empty = "No data yet"
  /// A symbol other than the category's, such as steps within activity.
  var symbol: String?
  @ViewBuilder var chart: Chart

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      CardLabel(title: title, symbol: symbol ?? category.symbol, tint: category.tint)
      if let value {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
          Text(value)
            .font(.system(.title2, design: .rounded, weight: .bold))
            .monospacedDigit()
            .contentTransition(.numericText())
            .foregroundStyle(Color.primary)
          if let unit {
            Text(unit)
              .font(.system(.footnote, design: .rounded, weight: .semibold))
              .foregroundStyle(.secondary)
          }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      } else {
        Text(empty)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxHeight: .infinity, alignment: .top)
      }
      chart.frame(height: 34)
      if let note {
        Text(note)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
    .card(padding: 14)
    .accessibilityElement(children: .combine)
  }
}

/// How the day's energy splits between protein, carbs and fat, as one bar
/// with a legend of the grams.
struct MacroSplit: View {
  let protein: Double
  let carbs: Double
  let fat: Double

  var body: some View {
    let parts = [
      ("Protein", protein, protein * 4, Theme.protein),
      ("Carbs", carbs, carbs * 4, Theme.carbs),
      ("Fat", fat, fat * 9, Theme.fat),
    ]
    let total = parts.map(\.2).reduce(0, +)
    VStack(alignment: .leading, spacing: 10) {
      GeometryReader { proxy in
        HStack(spacing: 3) {
          ForEach(parts, id: \.0) { part in
            Capsule()
              .fill(total > 0 ? part.3 : Theme.track)
              .frame(width: max(0, (proxy.size.width - 6) * (total > 0 ? part.2 / total : 1.0 / 3)))
          }
        }
      }
      .frame(height: 8)
      .animation(.spring(duration: 0.7), value: total)
      HStack(spacing: 14) {
        ForEach(parts, id: \.0) { part in
          HStack(spacing: 5) {
            Circle().fill(part.3).frame(width: 7, height: 7)
            Text(part.0).foregroundStyle(.secondary)
            Text("\(Format.number(part.1)) g").fontWeight(.semibold).monospacedDigit()
          }
          .font(.caption)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "Protein \(Format.number(protein)) grams, carbs \(Format.number(carbs)) grams, fat \(Format.number(fat)) grams")
  }
}

/// Buttons inside cards that should look like the card, not like links.
struct CardButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .opacity(configuration.isPressed ? 0.9 : 1)
      .animation(.spring(duration: 0.25), value: configuration.isPressed)
  }
}
