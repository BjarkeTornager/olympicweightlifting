import Charts
import LiftAPI
import SwiftUI

enum Trend: Hashable {
  case sleep, heart, activity, water, food

  var title: String {
    switch self {
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
    }
  }
}

/// Recent days for one card on Today, charted the way the Health app does.
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
          Text("Week").tag(7)
          Text("2 Weeks").tag(14)
          Text("Month").tag(30)
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
          VStack(alignment: .leading, spacing: 12) {
            headline
            chart.frame(height: 220)
          }
          .padding(.vertical, 6)
        }
      }
      if trends != nil {
        Section("Days") {
          ForEach(days.reversed(), id: \.date) { day in
            LabeledContent(JournalView.heading(day.date)) {
              Text(value(day)).monospacedDigit()
            }
          }
        }
      }
    }
    .navigationTitle(trend.title)
    .navigationBarTitleDisplayMode(.large)
    .task(id: range) { await load() }
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

  // MARK: Headline

  @ViewBuilder
  private var headline: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Average").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        .textCase(.uppercase)
      switch trend {
      case .sleep:
        BigValue(value: average(\.sleepHours).map { Format.hours($0) } ?? "–")
      case .heart:
        HStack(spacing: 16) {
          BigValue(value: average { $0.restingHeartRate.map(Double.init) }.map(Format.number) ?? "–", unit: "bpm resting")
          BigValue(value: average(\.heartRateVariabilityMs).map(Format.number) ?? "–", unit: "ms HRV")
        }
      case .activity:
        BigValue(value: average { $0.steps.map(Double.init) }.map(Format.number) ?? "–", unit: "steps")
      case .water:
        BigValue(value: average { $0.waterMl.map(Double.init) }.map(Format.number) ?? "–", unit: "ml")
      case .food:
        BigValue(value: average(\.calories).map(Format.number) ?? "–", unit: "kcal")
      }
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
    let tint = trend.category.tint
    switch trend {
    case .sleep:
      Chart(days, id: \.date) { day in
        if let hours = day.sleepHours {
          BarMark(x: .value("Night", date(day), unit: .day), y: .value("Hours", hours))
            .foregroundStyle(tint.gradient)
            .cornerRadius(4)
        }
      }
      .chartYAxisLabel("hours")
    case .heart:
      Chart {
        ForEach(days, id: \.date) { day in
          if let resting = day.restingHeartRate {
            LineMark(x: .value("Day", date(day), unit: .day), y: .value("Value", resting))
              .foregroundStyle(by: .value("Measure", "Resting (bpm)"))
            PointMark(x: .value("Day", date(day), unit: .day), y: .value("Value", resting))
              .foregroundStyle(by: .value("Measure", "Resting (bpm)"))
          }
          if let hrv = day.heartRateVariabilityMs {
            LineMark(x: .value("Day", date(day), unit: .day), y: .value("Value", hrv))
              .foregroundStyle(by: .value("Measure", "HRV (ms)"))
              .lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 3]))
          }
        }
      }
      .chartForegroundStyleScale(["Resting (bpm)": tint, "HRV (ms)": Color.purple])
    case .activity:
      Chart(days, id: \.date) { day in
        if let steps = day.steps {
          BarMark(x: .value("Day", date(day), unit: .day), y: .value("Steps", steps))
            .foregroundStyle(tint.gradient)
            .cornerRadius(4)
        }
      }
    case .water:
      Chart {
        ForEach(days, id: \.date) { day in
          if let ml = day.waterMl {
            BarMark(x: .value("Day", date(day), unit: .day), y: .value("ml", ml))
              .foregroundStyle(tint.gradient)
              .cornerRadius(4)
          }
        }
        if let target = trends?.waterTargetMl {
          RuleMark(y: .value("Target", target))
            .foregroundStyle(.secondary)
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .annotation(position: .top, alignment: .leading) {
              Text("Target").font(.caption2).foregroundStyle(.secondary)
            }
        }
      }
    case .food:
      Chart {
        ForEach(days, id: \.date) { day in
          if let kcal = day.calories {
            BarMark(x: .value("Day", date(day), unit: .day), y: .value("kcal", kcal))
              .foregroundStyle(tint.gradient)
              .cornerRadius(4)
          }
        }
        if let target = trends?.targetCalories {
          RuleMark(y: .value("Target", target))
            .foregroundStyle(.secondary)
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .annotation(position: .top, alignment: .leading) {
              Text("Target").font(.caption2).foregroundStyle(.secondary)
            }
        }
      }
    }
  }

  private func value(_ day: Components.Schemas.TrendDay) -> String {
    switch trend {
    case .sleep:
      day.sleepHours.map(Format.hours) ?? "–"
    case .heart:
      [day.restingHeartRate.map { "\($0) bpm" }, day.heartRateVariabilityMs.map { "\(Format.number($0)) ms" }]
        .compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "–"
    case .activity:
      [day.steps.map { "\($0.formatted()) steps" }, day.cardioMinutes > 0 ? "\(day.cardioMinutes) min workouts" : nil]
        .compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "–"
    case .water:
      day.waterMl.map { "\($0.formatted()) ml" } ?? "–"
    case .food:
      [day.calories.map { "\(Format.number($0)) kcal" }, day.protein.map { "\(Format.number($0)) g protein" }]
        .compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "–"
    }
  }
}

extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
