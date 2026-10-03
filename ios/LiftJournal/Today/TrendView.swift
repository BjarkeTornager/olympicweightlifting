import Charts
import LiftAPI
import LiftTheme
import SwiftUI

enum Trend: Hashable {
  case sleep, heart, activity, water, food, body

  var title: String {
    switch self {
    case .body: "Body"
    case .sleep: "Sleep"
    case .heart: "Heart"
    case .activity: "Activity"
    case .water: "Water"
    case .food: "Food"
    }
  }

  var category: Category {
    switch self {
    case .sleep: .sleep
    case .heart: .heart
    case .activity: .activity
    case .water: .water
    case .food: .food
    case .body: .body
    }
  }
}

/// Recent days for one part of Today, charted in Today's grammar: a zero
/// baseline, earlier days in the neutral track and today in the area's
/// pigment, a dotted ink average, and every day listed below with its value.
struct TrendView: View {
  @Environment(AppModel.self) private var model
  let trend: Trend
  @State private var range = 14
  @State private var trends: Components.Schemas.Trends?
  @State private var error: String?

  private var days: [Components.Schemas.TrendDay] { trends?.days ?? [] }

  var body: some View {
    List {
      Section {
        Picker("Range", selection: $range) {
          if trend == .body {
            Text("Month").tag(30)
            Text("2 Months").tag(60)
            Text("3 Months").tag(90)
          } else {
            Text("Week").tag(7)
            Text("2 Weeks").tag(14)
            Text("Month").tag(30)
          }
        }
        .pickerStyle(.segmented)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
      }
      Section {
        if trends == nil && error == nil {
          ProgressView().frame(maxWidth: .infinity, minHeight: 220)
        } else if let error {
          ContentUnavailableView("Couldn't load", systemImage: "chart.bar", description: Text(error))
        } else {
          VStack(alignment: .leading, spacing: 16) {
            headline
            let charts = trend == .body ? bodyCharts : 1
            if charts > 0 {
              chart.frame(height: charts > 1 ? 320 : 220)
            }
            if trend == .heart { HeartLegend() }
          }
          .padding(.vertical, 6)
        }
      }
      .themedRows()
      if trends != nil {
        Section("Days") {
          // Body is weighed now and then: list only the days with a reading.
          let listed = trend == .body ? days.filter { $0.bodyweight != nil || $0.bodyFatPercent != nil } : days
          ForEach(listed.reversed(), id: \.date) { day in
            LabeledContent(JournalView.heading(day.date)) {
              Text(value(day) ?? "Nothing logged")
                .monospacedDigit()
                .foregroundStyle(Theme.inkSecondary)
            }
          }
        }
        .themedRows()
      }
    }
    .themedList()
    .navigationTitle(trend.title)
    .navigationBarTitleDisplayMode(.large)
    .task(id: range) { await load() }
    .onAppear { if trend == .body && range < 30 { range = 90 } }
  }

  private func load() async {
    do {
      trends = try await model.client.getTrends(query: .init(date: JournalDay.string(.now), days: range)).value()
      error = nil
    } catch {
      self.error = await model.handle(error)
    }
  }

  private func date(_ day: Components.Schemas.TrendDay) -> Date {
    JournalDay.date(day.date) ?? .now
  }

  /// The latest day, drawn in the pigment when it is today.
  private func isToday(_ day: Components.Schemas.TrendDay) -> Bool {
    day.date == JournalDay.string(.now)
  }

  // MARK: Headline

  @ViewBuilder
  private var headline: some View {
    VStack(alignment: .leading, spacing: 8) {
      CardLabel(title: trend == .body ? "Latest" : "Average", key: trend.category.tint)
      switch trend {
      case .sleep:
        figure(average(\.sleepHours).map(Format.hours), nil)
      case .heart:
        HStack(alignment: .firstTextBaseline, spacing: 20) {
          figure(average { $0.restingHeartRate.map(Double.init) }.map(Format.number), "bpm resting")
          figure(average(\.heartRateVariabilityMs).map(Format.number), "ms HRV")
        }
      case .activity:
        figure(average { $0.steps.map(Double.init) }.map(Format.number), "steps")
      case .water:
        figure(average { $0.waterMl.map(Double.init) }.map(Format.number), "ml")
      case .food:
        figure(average(\.calories).map(Format.number), "kcal")
      case .body:
        HStack(alignment: .firstTextBaseline, spacing: 20) {
          figure(
            days.last(where: { $0.bodyweight != nil })?.bodyweight.map { Format.decimal($0) }, "kg",
            empty: "No weight in this range")
          figure(
            days.last(where: { $0.bodyFatPercent != nil })?.bodyFatPercent.map { Format.decimal($0) }, "% fat",
            empty: "No body fat in this range")
        }
      }
    }
  }

  /// A value in the serif, or a sentence when there is none, naming the
  /// measure when there are two.
  @ViewBuilder
  private func figure(
    _ value: String?, _ unit: String?, empty: String = "Nothing logged in this range"
  ) -> some View {
    if let value {
      BigValue(value: value, unit: unit).foregroundStyle(Theme.ink)
    } else {
      Text(empty).folio(.note).foregroundStyle(Theme.inkSecondary)
    }
  }

  private func average(_ value: (Components.Schemas.TrendDay) -> Double?) -> Double? {
    let values = days.compactMap(value)
    return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
  }

  private func average(_ key: KeyPath<Components.Schemas.TrendDay, Double?>) -> Double? {
    average { $0[keyPath: key] }
  }

  // MARK: Chart

  @ViewBuilder
  private var chart: some View {
    switch trend {
    case .sleep:
      bars(\.sleepHours, unit: "hours", average: average(\.sleepHours))
    case .activity:
      bars({ $0.steps.map(Double.init) }, unit: "steps", average: average { $0.steps.map(Double.init) })
    case .water:
      bars({ $0.waterMl.map(Double.init) }, unit: "ml", target: trends.map { Double($0.waterTargetMl) })
    case .food:
      bars(\.calories, unit: "kcal", target: trends?.targetCalories)
    case .heart:
      Chart {
        ForEach(days, id: \.date) { day in
          if let resting = day.restingHeartRate {
            LineMark(
              x: .value("Day", date(day), unit: .day), y: .value("Value", resting), series: .value("Measure", "Resting"))
              .foregroundStyle(Theme.heart)
              .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
            if isToday(day) {
              PointMark(x: .value("Day", date(day), unit: .day), y: .value("Value", resting))
                .foregroundStyle(Theme.heart)
            }
          }
          if let hrv = day.heartRateVariabilityMs {
            LineMark(
              x: .value("Day", date(day), unit: .day), y: .value("Value", hrv), series: .value("Measure", "HRV"))
              .foregroundStyle(Theme.heart)
              .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, dash: [4, 3]))
          }
        }
      }
      .chartYScale(domain: .automatic(includesZero: false))
      .chartXAxis { dayAxis }
      .chartYAxis { valueAxis }
      .chartLegend(.hidden)
    case .body:
      // Weight and body fat on their own scales, one above the other. One
      // with no reading in the range is left out; the headline says so.
      VStack(spacing: 12) {
        let weights = days.filter { $0.bodyweight != nil }
        let fat = days.filter { $0.bodyFatPercent != nil }
        if !weights.isEmpty { line(weights, \.bodyweight, unit: "kg", tint: Theme.body) }
        if !fat.isEmpty { line(fat, \.bodyFatPercent, unit: "% body fat", tint: Theme.bodyFat) }
      }
    }
  }

  /// How many of weight and body fat have a reading in the range.
  private var bodyCharts: Int {
    [days.contains { $0.bodyweight != nil }, days.contains { $0.bodyFatPercent != nil }].filter { $0 }.count
  }

  /// Bars on a zero baseline: earlier days in the track, today in the
  /// pigment, with a dotted average or target.
  private func bars(
    _ value: @escaping (Components.Schemas.TrendDay) -> Double?, unit: String, average: Double? = nil,
    target: Double? = nil
  ) -> some View {
    let tint = trend.category.tint
    return Chart {
      ForEach(days, id: \.date) { day in
        if let amount = value(day) {
          BarMark(x: .value("Day", date(day), unit: .day), y: .value(unit, amount))
            .foregroundStyle(isToday(day) ? tint : Theme.track)
            .cornerRadius(Theme.Radius.mark)
        }
      }
      RuleMark(y: .value("Zero", 0)).foregroundStyle(Theme.rule).lineStyle(StrokeStyle(lineWidth: 1))
      if let line = target ?? average {
        RuleMark(y: .value(target == nil ? "Average" : "Target", line))
          .foregroundStyle(Theme.ink.opacity(0.7))
          .lineStyle(StrokeStyle(lineWidth: 1, dash: [1.5, 2.5]))
          .annotation(position: .top, alignment: .leading) {
            Text(target == nil ? "Average" : "Target")
              .font(.caption2.weight(.medium))
              .foregroundStyle(Theme.inkSecondary)
          }
      }
    }
    .chartXAxis { dayAxis }
    .chartYAxis { valueAxis }
    .chartYAxisLabel(unit)
  }

  private func line(
    _ readings: [Components.Schemas.TrendDay], _ key: KeyPath<Components.Schemas.TrendDay, Double?>, unit: String,
    tint: Color
  ) -> some View {
    Chart(readings, id: \.date) { day in
      LineMark(x: .value("Day", date(day), unit: .day), y: .value(unit, day[keyPath: key] ?? 0))
        .foregroundStyle(tint)
        .interpolationMethod(.catmullRom)
        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
      PointMark(x: .value("Day", date(day), unit: .day), y: .value(unit, day[keyPath: key] ?? 0))
        .foregroundStyle(tint)
        .symbolSize(day.date == readings.last?.date ? 40 : 14)
    }
    .chartYScale(domain: .automatic(includesZero: false))
    .chartXAxis { dayAxis }
    .chartYAxis { valueAxis }
    .chartYAxisLabel(unit)
  }

  /// Day initials for a week, today's in bold ink; dates for longer ranges.
  private var dayAxis: some AxisContent {
    AxisMarks(values: .stride(by: .day, count: range <= 7 ? 1 : 7)) { value in
      AxisValueLabel {
        if let day = value.as(Date.self) {
          let today = Calendar.current.isDateInToday(day)
          Text(
            day.formatted(
              range <= 7
                ? .dateTime.weekday(.narrow).locale(Format.locale)
                : .dateTime.day().month(.abbreviated).locale(Format.locale))
          )
          .font(.caption2.weight(today ? .bold : .medium).monospacedDigit())
          .foregroundStyle(today ? Theme.ink : Theme.inkSecondary)
        }
      }
    }
  }

  /// Values written as the headline and the days are ("3,000", "70.5"),
  /// whatever the iPhone's region; weight and body fat to one decimal.
  private var valueAxis: some AxisContent {
    AxisMarks(position: .trailing) { value in
      AxisGridLine(stroke: StrokeStyle(lineWidth: 1)).foregroundStyle(Theme.rule)
      AxisValueLabel {
        if let number = value.as(Double.self) {
          Text(
            trend == .body
              ? number.formatted(.number.precision(.fractionLength(1)).locale(Format.locale))
              : number.formatted(.number.locale(Format.locale))
          )
          .font(.caption2.monospacedDigit())
          .foregroundStyle(Theme.inkSecondary)
        }
      }
    }
  }

  private func value(_ day: Components.Schemas.TrendDay) -> String? {
    let parts: [String?] =
      switch trend {
      case .sleep:
        [day.sleepHours.map(Format.hours)]
      case .heart:
        [day.restingHeartRate.map { "\($0) bpm" }, day.heartRateVariabilityMs.map { "\(Format.number($0)) ms" }]
      case .activity:
        [
          day.steps.map { "\(Format.number($0)) steps" },
          day.cardioMinutes > 0 ? "\(day.cardioMinutes) min workouts" : nil,
        ]
      case .water:
        [day.waterMl.map { "\(Format.number($0)) ml" }]
      case .food:
        [day.calories.map { "\(Format.number($0)) kcal" }, day.protein.map { "\(Format.number($0)) g protein" }]
      case .body:
        [day.bodyweight.map { "\(Format.decimal($0)) kg" }, day.bodyFatPercent.map { "\(Format.decimal($0))% fat" }]
      }
    return parts.compactMap { $0 }.joined(separator: " · ").nonEmpty
  }
}

/// Resting heart rate is a solid line and variability a dashed one, both in
/// the body's pigment, so the key shows the strokes.
private struct HeartLegend: View {
  var body: some View {
    HStack(spacing: 16) {
      stroke(dash: [], "Resting (bpm)")
      stroke(dash: [4, 3], "HRV (ms)")
    }
    .font(.footnote)
    .foregroundStyle(Theme.inkSecondary)
    .accessibilityHidden(true)
  }

  private func stroke(dash: [CGFloat], _ title: String) -> some View {
    HStack(spacing: 6) {
      Path { path in
        path.move(to: CGPoint(x: 0, y: 1))
        path.addLine(to: CGPoint(x: 18, y: 1))
      }
      .stroke(Theme.heart, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: dash))
      .frame(width: 18, height: 2)
      Text(title)
    }
  }
}

extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
