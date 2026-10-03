import Charts
import LiftTheme
import SwiftUI

/// A progress ring with rounded ends over a neutral track. Past 100 % the
/// ring stays full; the number beside it tells the rest.
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

/// One target as a ring with the value inside. Today's targets are the
/// Ledger now; this stays for Coach's progress visual until it moves to the
/// isotype meter too.
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
            .font(.headline.weight(.semibold).monospacedDigit())
            .minimumScaleFactor(0.6)
            .lineLimit(1)
            .contentTransition(.numericText())
          Text(target)
            .font(.caption2.weight(.medium).monospacedDigit())
            .foregroundStyle(Theme.inkSecondary)
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

// MARK: The Ledger

/// One line of the Ledger: an amount against its target, counted in marks of
/// a fixed size.
struct LedgerLine {
  let title: String
  let tint: Color
  let value: Double
  /// Nil when no target is set: the line says what was logged, no meter.
  let target: Double?
  /// The amount one mark stands for: 100 kcal, 10 g, one 250 ml glass.
  let perMark: Double
  /// The value and its unit as printed ("980", "kcal").
  let number: String
  let unit: String
  /// The target as printed, with its unit when it differs ("1,900", "2.45 L").
  let targetText: String?
  /// What a mark is worth, under the meter ("10 g a mark", "2 of 10 glasses").
  let scale: String
  /// The unit as VoiceOver says it ("kilocalories").
  let spokenUnit: String

  /// "980 of 1,900 kilocalories", or "980 kilocalories logged today" without a target.
  var spoken: String {
    let value = Format.number(value)
    guard let target else { return "\(value) \(spokenUnit) logged today" }
    return "\(value) of \(Format.number(target)) \(spokenUnit)"
  }
}

/// One column of the Ledger: the kicker with its key, the serif number, its
/// target, the isotype meter and the scale. VoiceOver reads it as one line:
/// "Energy, 980 of 1,900 kilocalories". With a `link`, the column opens that
/// chart and shows an arrow; the scale row stays outside the link, so its
/// "Set a target" button is never a button inside a button.
struct LedgerColumn<Accessory: View>: View {
  let line: LedgerLine
  var role: Folio.Role = .ledger
  var markWidth: CGFloat = 5
  var meterHeight: CGFloat = 24
  var link: Trend?
  var setTarget: (() -> Void)?
  @ViewBuilder var accessory: Accessory
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let link {
        NavigationLink(value: link) { reading }
          .buttonStyle(CardButtonStyle())
      } else {
        reading
      }
      // The scale and its note side by side, or one above the other at the
      // largest text sizes.
      let layout =
        typeSize.isAccessibilitySize
        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
        : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
      layout {
        if line.target != nil {
          Text(line.scale)
        } else if let setTarget {
          Button(action: setTarget) {
            Text("Set a target with Coach \(Image(systemName: "arrow.right"))")
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(Theme.accent)
          }
          .buttonStyle(.plain)
        }
        if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
        accessory
      }
      .font(.caption2.weight(.medium))
      .foregroundStyle(Theme.inkSecondary)
      .padding(.top, line.target == nil ? 10 : 7)
    }
  }

  /// The kicker, the number and the meter: what the link opens.
  private var reading: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        CardLabel(title: line.title, key: line.tint)
        Spacer(minLength: 0)
        if link != nil { GoArrow() }
      }
      HStack(alignment: .firstTextBaseline, spacing: 5) {
        Text(line.number).folio(role).foregroundStyle(Theme.ink).contentTransition(.numericText())
        Text(line.unit).unit()
        Spacer(minLength: 6)
        Group {
          if let target = line.targetText, line.target != nil {
            Text("of \(Text(target).fontWeight(.semibold).foregroundStyle(Theme.ink))")
          } else {
            Text("logged today")
          }
        }
        .font(role == .hero ? .subheadline.monospacedDigit() : .footnote.monospacedDigit())
        .foregroundStyle(Theme.inkSecondary)
        .layoutPriority(1)
      }
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 6)
      if line.target != nil {
        IsotypeMeter(
          value: line.value, target: line.target, unit: line.perMark, tint: line.tint, markWidth: markWidth,
          height: meterHeight
        )
        .padding(.top, 12)
      }
    }
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(line.title)
    .accessibilityValue(line.spoken)
  }
}

extension LedgerColumn where Accessory == EmptyView {
  init(
    line: LedgerLine, role: Folio.Role = .ledger, markWidth: CGFloat = 5, meterHeight: CGFloat = 24,
    link: Trend? = nil, setTarget: (() -> Void)? = nil
  ) {
    self.init(
      line: line, role: role, markWidth: markWidth, meterHeight: meterHeight, link: link, setTarget: setTarget
    ) { EmptyView() }
  }
}

/// The day's energy, protein and water, set like a ledger: one hero number
/// over a ruler of marks, and a pair below. At the largest text sizes the
/// pair stacks.
struct Ledger: View {
  let energy: LedgerLine
  let protein: LedgerLine
  let water: LedgerLine
  /// Energy burned today, as printed ("205", "~205"), beside the scale.
  var burned: String?
  /// The chart the energy column opens.
  var energyLink: Trend?
  var setTarget: (() -> Void)?
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(spacing: 0) {
      Rectangle().fill(Theme.ink).frame(height: 2)
      LedgerColumn(
        line: energy, role: .hero, markWidth: 7, meterHeight: 32, link: energyLink,
        setTarget: offer(energy)
      ) {
        if let burned {
          HStack(spacing: 5) {
            Key(tint: Theme.activity)
            Text("Burned \(Text(burned).fontWeight(.semibold).foregroundStyle(Theme.ink)) kcal")
          }
          .accessibilityElement(children: .combine)
        } else if let over = over(energy) {
          Text(over)
        }
      }
      .padding(.vertical, 14)
      Rectangle().fill(Theme.rule).frame(height: 1)
      let stacked = typeSize >= .xxxLarge
      let layout =
        stacked
        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
        : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
      layout {
        LedgerColumn(
          line: protein, markWidth: stacked ? 9 : 5, meterHeight: stacked ? 34 : 24, setTarget: offer(protein)
        )
        .frame(maxWidth: .infinity)
        if !stacked {
          Rectangle().fill(Theme.rule).frame(width: 1)
        } else {
          Rectangle().fill(Theme.rule).frame(height: 1)
        }
        LedgerColumn(
          line: water, markWidth: stacked ? 12 : 8, meterHeight: stacked ? 34 : 24, setTarget: offer(water)
        )
        .frame(maxWidth: .infinity)
      }
      .fixedSize(horizontal: false, vertical: true)
      .padding(.vertical, 14)
      Rectangle().fill(Theme.rule).frame(height: 1)
    }
  }

  /// "Set a target with Coach" goes on the first line without a target only,
  /// since Coach sets them together.
  private func offer(_ line: LedgerLine) -> (() -> Void)? {
    let first = [energy, protein, water].first { $0.target == nil }
    return first?.title == line.title ? setTarget : nil
  }

  /// "250 above target", once the day has passed it: a record, not a verdict.
  private func over(_ line: LedgerLine) -> String? {
    guard let target = line.target, line.value > target else { return nil }
    return "\(Format.number(line.value - target)) above target"
  }
}

// MARK: Charts

/// A small chart of the last days on a zero baseline: bars for amounts, a
/// line for levels. Earlier days are neutral and the latest is in colour,
/// with day initials beneath when given, the latest in bold ink. Missing
/// days are left out rather than drawn as zero; among bars they keep a faint
/// stub, so the span of days stays visible. An average draws as a dotted
/// ink line.
struct Sparkline: View {
  enum Style { case bars, line }
  let values: [Double?]
  let tint: Color
  var style: Style = .bars
  /// One initial per value, oldest first ("S", "S", "M"...).
  var days: [String]?
  var average: Double?

  var body: some View {
    if let days, days.count == values.count {
      chart.chartXAxis {
        AxisMarks(values: values.indices.map(String.init)) { value in
          let index = value.as(String.self).flatMap(Int.init) ?? 0
          AxisValueLabel {
            Text(days[index])
              .font(.caption2.weight(index == values.count - 1 ? .bold : .medium))
              .foregroundStyle(index == values.count - 1 ? Theme.ink : Theme.inkSecondary)
          }
        }
      }
    } else {
      chart.chartXAxis(.hidden)
    }
  }

  private var chart: some View {
    let points = values.enumerated().compactMap { index, value in value.map { (index, $0) } }
    let days = values.indices.map(String.init)
    let stub = (points.map(\.1).max() ?? 1) * 0.05
    return Chart {
      if style == .bars {
        ForEach(values.indices.filter { values[$0] == nil }, id: \.self) { index in
          BarMark(x: .value("Day", String(index)), y: .value("Value", stub), width: .ratio(0.6))
            .foregroundStyle(Theme.track.opacity(0.6))
            .cornerRadius(Theme.Radius.mark)
        }
      }
      ForEach(points, id: \.0) { index, value in
        switch style {
        case .bars:
          BarMark(x: .value("Day", String(index)), y: .value("Value", value), width: .ratio(0.6))
            .foregroundStyle(index == values.count - 1 ? tint : Theme.track)
            .cornerRadius(Theme.Radius.mark)
        case .line:
          LineMark(x: .value("Day", String(index)), y: .value("Value", value))
            .foregroundStyle(tint)
            .interpolationMethod(.catmullRom)
            .lineStyle(StrokeStyle(lineWidth: 1.75, lineCap: .round))
          if index == points.last?.0 {
            PointMark(x: .value("Day", String(index)), y: .value("Value", value))
              .symbol {
                Circle()
                  .strokeBorder(tint, lineWidth: 2)
                  .background(Circle().fill(Theme.background))
                  .frame(width: 9, height: 9)
              }
          }
        }
      }
      if style == .bars {
        RuleMark(y: .value("Zero", 0))
          .foregroundStyle(Theme.rule)
          .lineStyle(StrokeStyle(lineWidth: 1))
      }
      if let average {
        RuleMark(y: .value("Average", average))
          .foregroundStyle(Theme.ink.opacity(0.7))
          .lineStyle(StrokeStyle(lineWidth: 1, dash: [1.5, 2.5]))
      }
    }
    .chartYAxis(.hidden)
    .chartXScale(domain: days)
    .chartYScale(domain: yDomain(points.map(\.1) + (average.map { [$0] } ?? [])))
    .accessibilityHidden(true)
  }

  private func yDomain(_ values: [Double]) -> ClosedRange<Double> {
    guard let low = values.min(), let high = values.max() else { return 0...1 }
    if style == .bars { return 0...max(high, 0.001) }
    let pad = max((high - low) * 0.25, abs(high) * 0.01, 0.5)
    return (low - pad)...(high + pad)
  }
}

/// One measurement in a grid of cells divided by hairlines: the kicker with
/// its key and an arrow when it opens, the value in the serif, a small chart
/// of recent days, and a note.
struct MetricCell<Chart: View>: View {
  let title: String
  let category: Category
  let value: String?
  var unit: String?
  var note: String?
  var empty = "No data yet"
  var opens = true
  /// Taller when the chart carries day initials under its bars.
  var chartHeight: CGFloat = 40
  @ViewBuilder var chart: Chart
  /// The chart grows a little with the text, so day initials keep room.
  @ScaledMetric(relativeTo: .caption2) private var growth: CGFloat = 1

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        CardLabel(title: title, key: category.tint)
        Spacer(minLength: 4)
        if opens { GoArrow() }
      }
      if let value {
        Measure(value: value, unit: unit)
          .contentTransition(.numericText())
          .padding(.top, 8)
      } else {
        Text(empty)
          .folio(.note)
          .foregroundStyle(Theme.inkSecondary)
          .padding(.top, 8)
          .frame(maxHeight: .infinity, alignment: .top)
      }
      chart.frame(height: chartHeight * min(growth, 1.8)).padding(.top, 12)
      if let note {
        Text(note)
          .font(.footnote)
          .foregroundStyle(Theme.inkSecondary)
          .lineLimit(2)
          .padding(.top, 6)
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .accessibilityElement(children: .combine)
  }
}

/// How the day's energy splits between protein, carbs and fat: one 12 pt
/// bar, protein in ink, carbs in the food colour and fat hatched in it, with
/// a legend of the grams below.
struct MacroSplit: View {
  let protein: Double
  let carbs: Double
  let fat: Double

  var body: some View {
    let parts = [
      ("Protein", protein, protein * 4, Theme.protein, false),
      ("Carbs", carbs, carbs * 4, Theme.carbs, false),
      ("Fat", fat, fat * 9, Theme.fat, true),
    ]
    let total = parts.map(\.2).reduce(0, +)
    VStack(alignment: .leading, spacing: 9) {
      GeometryReader { proxy in
        HStack(spacing: 3) {
          ForEach(parts, id: \.0) { part in
            let width = max(0, (proxy.size.width - 6) * (total > 0 ? part.2 / total : 1.0 / 3))
            Group {
              if total == 0 {
                RoundedRectangle(cornerRadius: Theme.Radius.key).fill(Theme.track)
              } else if part.4 {
                Hatch(tint: part.3)
              } else {
                RoundedRectangle(cornerRadius: Theme.Radius.key).fill(part.3)
              }
            }
            .frame(width: width)
          }
        }
      }
      .frame(height: 12)
      .animation(.spring(duration: 0.7), value: total)
      FlowLayout(spacing: 16, lineSpacing: 4) {
        ForEach(parts, id: \.0) { part in
          HStack(spacing: 6) {
            Key(tint: part.3, hatched: part.4)
            Text(part.0).foregroundStyle(Theme.inkSecondary)
            Text("\(Format.number(part.1)) g").fontWeight(.semibold).monospacedDigit().foregroundStyle(Theme.ink)
          }
          .font(.footnote)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "Protein \(Format.number(protein)) grams, carbs \(Format.number(carbs)) grams, fat \(Format.number(fat)) grams")
  }
}

/// A 1 to 5 scale from a check-in: the label in serif italic, the value as
/// a numeral and five pips.
struct ScaleRow: View {
  let label: String
  let value: Int?
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text(label).folio(.note).foregroundStyle(Theme.ink)
        Spacer(minLength: 8)
        if let value {
          HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text("\(value)").folio(.inline)
            Text("/5").unit()
          }
        } else {
          Text("Not yet").font(.footnote).foregroundStyle(Theme.inkSecondary)
        }
      }
      HStack(spacing: 4) {
        ForEach(1...5, id: \.self) { step in
          Capsule()
            .fill(step <= (value ?? 0) ? tint : Theme.track)
            .frame(height: 6)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(label) \(value.map { "\($0) of 5" } ?? "not recorded")")
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

private struct LedgerPreview: View {
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Ledger(
          energy: LedgerLine(
            title: "Energy", tint: Theme.calories, value: 980, target: 1900, perMark: 100, number: "980",
            unit: "kcal", targetText: "1,900", scale: "One mark = 100 kcal", spokenUnit: "kilocalories"),
          protein: LedgerLine(
            title: "Protein", tint: Theme.protein, value: 52, target: 130, perMark: 10, number: "52", unit: "g",
            targetText: "130 g", scale: "10 g a mark", spokenUnit: "grams"),
          water: LedgerLine(
            title: "Water", tint: Theme.water, value: 500, target: 2450, perMark: 250, number: "500", unit: "ml",
            targetText: "2.45 L", scale: "2 of 10 glasses", spokenUnit: "millilitres"),
          burned: "205")
        CheckInBlock(title: "Check in with Coach", detail: "Coach logs your day as you talk")
        FolioSection("Recovery", meta: "Seven days")
        Grid(horizontalSpacing: 16, verticalSpacing: 14) {
          GridRow {
            MetricCell(title: "Sleep", category: .sleep, value: "7 h 15 min", note: "Average 7 h 12 min") {
              Sparkline(
                values: [7.4, 6.6, 8.1, 7.0, 6.2, 7.8, 7.25], tint: Theme.sleep,
                days: ["S", "S", "M", "T", "W", "T", "F"], average: 7.19)
            }
            MetricCell(title: "Resting heart", category: .heart, value: "54", unit: "bpm", note: "HRV 60 ms") {
              Sparkline(values: [54, 56, 53, 55, 57, 53, 54], tint: Theme.heart, style: .line)
            }
          }
          GridRow {
            MetricCell(title: "Steps", category: .activity, value: nil, empty: "No steps yet today") {
              Sparkline(values: [9120, nil, 11800, 7300, 5200, 10400, nil], tint: Theme.activity)
            }
            VStack(spacing: 14) {
              ScaleRow(label: "Energy", value: 4, tint: Theme.feltEnergy)
              ScaleRow(label: "Soreness", value: nil, tint: Theme.soreness)
            }
          }
        }
        MacroSplit(protein: 52, carbs: 100, fat: 41)
      }
      .padding(20)
    }
    .background(Theme.background)
  }
}

#Preview("Ledger") { LedgerPreview() }
#Preview("Ledger, dark") { LedgerPreview().preferredColorScheme(.dark) }
#Preview("Ledger, AX3") { LedgerPreview().dynamicTypeSize(.accessibility3) }
