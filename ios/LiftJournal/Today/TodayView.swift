import LiftAPI
import LiftStore
import SwiftUI

/// The day at a glance, in the style of the Health app's Summary: one card
/// per kind of record, each opening a chart of recent days.
struct TodayView: View {
  @Environment(AppModel.self) private var model
  @State private var showingAccount = false
  @State private var showingCheckin = false
  @State private var healthNeedsAccess = false

  var body: some View {
    List {
      if let today = model.today {
        content(today)
      } else if model.loadingToday {
        ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
      } else {
        ContentUnavailableView(
          "Today isn't available", systemImage: "wifi.slash",
          description: Text(model.todayError ?? "Pull down to try again."))
      }
    }
    .navigationTitle("Today")
    .navigationSubtitle(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
    .navigationDestination(for: Trend.self) { TrendView(trend: $0) }
    .refreshable {
      await model.flush()
      await model.loadToday()
      await model.syncHealth(force: true)
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) { logMenu }
      ToolbarSpacer(.fixed, placement: .topBarTrailing)
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          showingAccount = true
        } label: {
          Avatar(name: model.session?.name ?? "")
        }
        .accessibilityLabel("Account")
      }
    }
    .sheet(isPresented: $showingAccount) { AccountView() }
    .sheet(isPresented: $showingCheckin) { CheckinSheet(existing: model.today?.checkin, body_: model.today?.body) }
    .sensoryFeedback(.success, trigger: model.saves)
    .task(id: model.health.lastSync) {
      healthNeedsAccess = model.health.connected ? await HealthSync.shared.needsAccess() : false
    }
  }

  private var logMenu: some View {
    Menu {
      Button("250 ml Water", systemImage: "drop.fill") { Task { await model.logDrink(ml: 250) } }
      Button("500 ml Water", systemImage: "drop.fill") { Task { await model.logDrink(ml: 500) } }
      Button("Check In", systemImage: "face.smiling") { showingCheckin = true }
      Divider()
      if model.voiceEnabled {
        Button("Talk to Coach", systemImage: "waveform") { model.startVoice() }
      }
      Button("Write to Coach", systemImage: "text.bubble") { model.tab = .coach }
    } label: {
      Label("Log", systemImage: "plus")
    }
  }

  @ViewBuilder
  private func content(_ today: Today) -> some View {
    if !model.refused.isEmpty || model.queued > 0 {
      QueueSection()
    }
    if model.voiceEnabled {
      Section {
        VoiceCheckinRow(reason: today.priorities.first?.title)
      }
    } else if let next = today.priorities.first {
      Section {
        VStack(alignment: .leading, spacing: 4) {
          Text(next.title).font(.headline)
          Text(next.reason).font(.subheadline).foregroundStyle(.secondary)
        }
      }
    }
    Section {
      if model.health.available && !model.health.connected {
        NavigationLink {
          HealthView()
        } label: {
          HStack(spacing: 12) {
            IconBadge(symbol: "heart.fill", tint: .pink)
            VStack(alignment: .leading, spacing: 2) {
              Text("Connect Apple Health")
              Text("Sleep, heart rate and workouts, without typing")
                .font(.subheadline).foregroundStyle(.secondary)
            }
          }
        }
      } else if model.health.connected && healthNeedsAccess {
        NavigationLink {
          HealthView()
        } label: {
          HStack(spacing: 12) {
            IconBadge(symbol: "heart.text.square.fill", tint: .pink)
            VStack(alignment: .leading, spacing: 2) {
              Text("Allow new Apple Health data")
              Text("Workout routes, and body fat from a smart scale, for you and Coach")
                .font(.subheadline).foregroundStyle(.secondary)
            }
          }
        }
      }
      NavigationLink(value: Trend.sleep) { SleepCard(today: today) }
      NavigationLink(value: Trend.heart) { HeartCard(today: today) }
      NavigationLink(value: Trend.activity) { ActivityCard(today: today) }
      CheckinCard(checkin: today.checkin) { showingCheckin = true }
    } header: {
      Text("Recovery")
    }
    .headerProminence(.increased)
    Section {
      NavigationLink(value: Trend.body) { BodyCard(body: today.body) }
    } header: {
      Text("Body")
    }
    .headerProminence(.increased)
    Section {
      NavigationLink(value: Trend.water) { WaterCard(hydration: today.hydration) }
      ForEach(today.hydration.drinks.reversed(), id: \.id) { drink in
        LabeledContent(drink.name.isEmpty ? drink.kind.capitalized : drink.name) {
          Text("\(drink.ml) ml").monospacedDigit()
        }
        .swipeActions {
          Button("Delete", systemImage: "trash", role: .destructive) {
            Task { await model.removeDrink(id: drink.id) }
          }
        }
      }
      NavigationLink(value: Trend.food) { FoodCard(nutrition: today.nutrition) }
    } header: {
      Text("Nutrition")
    }
    .headerProminence(.increased)
    Section {
      TrainingCard(today: today)
      ForEach(today.activities, id: \.id) { activity in
        if activity.hasRoute == true {
          NavigationLink {
            ActivityRouteView(id: activity.id, title: activity.title)
          } label: {
            ActivityRow(activity: activity)
          }
        } else {
          ActivityRow(activity: activity)
        }
      }
    } header: {
      Text("Training")
    } footer: {
      Text(
        "\(today.sessionsThisWeek) sessions in the last seven days. Workouts from Apple Health appear here by themselves."
      )
    }
    .headerProminence(.increased)
  }
}

// MARK: Cards

/// Starts a spoken check-in, the quickest way to fill in the day.
struct VoiceCheckinRow: View {
  @Environment(AppModel.self) private var model
  let reason: String?

  var body: some View {
    Button {
      model.startVoice()
    } label: {
      HStack(spacing: 14) {
        Image(systemName: "waveform")
          .font(.title2.weight(.semibold))
          .foregroundStyle(.white)
          .frame(width: 48, height: 48)
          .background(
            LinearGradient(colors: [.purple, .indigo], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: .circle)
        VStack(alignment: .leading, spacing: 2) {
          Text("Check In by Voice").font(.headline).foregroundStyle(Color.primary)
          Text(reason ?? "Coach asks about what's missing today.")
            .font(.subheadline).foregroundStyle(Color.secondary)
            .lineLimit(2)
        }
      }
      .padding(.vertical, 4)
    }
    .tint(.primary)
    .accessibilityHint("Starts a spoken conversation with Coach")
  }
}

struct SleepCard: View {
  let today: Today

  var body: some View {
    SummaryCard(
      title: "Sleep", category: .sleep, caption: today.sleep.hours != nil ? "Last night" : nil
    ) {
      if let hours = today.sleep.hours {
        let minutes = Int((hours * 60).rounded())
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          BigValue(value: "\(minutes / 60)", unit: "h")
          BigValue(value: "\(minutes % 60)", unit: "min")
          Spacer()
          if today.sleep.fromAppleHealth { AppleHealthMark() }
        }
        if let average = today.sleep.averageHours, today.sleep.nights > 1 {
          Text("\(Format.hours(average)) on average over \(today.sleep.nights) nights")
            .font(.footnote).foregroundStyle(.secondary)
        }
      } else {
        Text("No sleep recorded for last night").foregroundStyle(.secondary)
      }
    }
  }
}

struct HeartCard: View {
  @Environment(AppModel.self) private var model
  let today: Today

  var body: some View {
    SummaryCard(title: "Heart", category: .heart) {
      if let vitals = today.vitals,
        vitals.restingHeartRate != nil || vitals.heartRateVariabilityMs != nil
      {
        HStack {
          MiniValue(value: vitals.restingHeartRate.map(String.init), unit: "bpm", label: "Resting")
          MiniValue(
            value: vitals.heartRateVariabilityMs.map { Format.number($0) }, unit: "ms",
            label: "Variability")
          MiniValue(value: vitals.averageHeartRate.map(String.init), unit: "bpm", label: "Average")
        }
      } else if model.health.connected {
        Text("No heart rate from Apple Health yet today").foregroundStyle(.secondary)
      } else {
        Text("Connect Apple Health to see your heart rate").foregroundStyle(.secondary)
      }
    }
  }
}

struct ActivityCard: View {
  @Environment(AppModel.self) private var model
  let today: Today

  var body: some View {
    SummaryCard(title: "Activity", category: .activity) {
      if let vitals = today.vitals, vitals.steps != nil || vitals.activeEnergyKcal != nil {
        HStack {
          MiniValue(value: vitals.steps.map { $0.formatted() }, label: "Steps")
          MiniValue(
            value: vitals.activeEnergyKcal.map { $0.formatted() }, unit: "kcal", label: "Active energy")
          Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
        }
      } else if !model.health.connected {
        Text("Connect Apple Health for steps and workouts").foregroundStyle(.secondary)
      } else {
        Text("No steps recorded yet today").foregroundStyle(.secondary)
      }
    }
  }
}

struct CheckinCard: View {
  let checkin: Components.Schemas.Checkin?
  let open: () -> Void

  var body: some View {
    Button(action: open) {
      SummaryCard(title: "How You Feel", category: .checkin) {
        if let checkin {
          HStack {
            MiniValue(value: checkin.energy.map { "\($0)" }, unit: "/5", label: "Energy")
            MiniValue(value: checkin.soreness.map { "\($0)" }, unit: "/5", label: "Soreness")
            MiniValue(value: checkin.bodyweight.map { $0.formatted() }, unit: "kg", label: "Weight")
          }
        } else {
          Text("Tap to check in").foregroundStyle(Color.secondary)
        }
      }
    }
    .tint(.primary)
  }
}

/// Weight, body fat and lean mass, with the goal's focus and the weekly trend.
struct BodyCard: View {
  let body_: Components.Schemas.Body?

  init(body: Components.Schemas.Body?) { body_ = body }

  var body: some View {
    SummaryCard(title: "Weight & Body Fat", category: .body, caption: focus) {
      if let b = body_, b.bodyweight != nil || b.bodyFatPercent != nil {
        HStack {
          MiniValue(value: b.bodyweight.map { $0.formatted() }, unit: "kg", label: "Weight")
          MiniValue(value: b.bodyFatPercent.map { $0.formatted() }, unit: "%", label: "Body fat")
          MiniValue(value: b.leanMassKg.map { $0.formatted() }, unit: "kg", label: "Lean mass")
        }
        if let line = trendLine(b) {
          Text(line).font(.footnote).foregroundStyle(.secondary)
        }
      } else {
        Text("Add your weight and body fat in a check-in to follow your progress.")
          .foregroundStyle(.secondary)
      }
    }
  }

  private var focus: String? {
    switch body_?.focus {
    case "lose_fat": "Losing fat"
    case "build_muscle": "Building muscle"
    case "recomposition": "Recomposition"
    case "maintain": "Maintaining"
    default: nil
    }
  }

  private func trendLine(_ b: Components.Schemas.Body) -> String? {
    var parts: [String] = []
    if let change = b.weeklyWeightChangeKg {
      let sign = change > 0 ? "+" : ""
      parts.append("\(sign)\(change.formatted(.number.precision(.fractionLength(0...2)))) kg a week")
    }
    if let target = b.targetWeightKg { parts.append("goal \(target.formatted()) kg") }
    if let fat = b.targetBodyFatPercent { parts.append("\(fat.formatted())% body fat") }
    if b.bodyFatFromAppleHealth == true { parts.append("body fat from Apple Health") }
    guard let line = parts.first.map({ _ in parts.joined(separator: " · ") }) else { return nil }
    return line.prefix(1).uppercased() + line.dropFirst()
  }
}

struct WaterCard: View {
  @Environment(AppModel.self) private var model
  let hydration: Components.Schemas.Hydration

  var body: some View {
    SummaryCard(title: "Water", category: .water) {
      let (value, unit) = Format.litres(hydration.totalMl)
      let (target, targetUnit) = Format.litres(hydration.targetMl)
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 4) {
          BigValue(value: value, unit: unit)
          Text("of \(target) \(targetUnit)\(hydration.estimatedTarget ? " (estimate)" : "")")
            .font(.footnote).foregroundStyle(.secondary)
        }
        Spacer()
        Gauge(value: min(1, Double(hydration.totalMl) / Double(max(1, hydration.targetMl)))) {
          Image(systemName: "drop.fill")
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(.cyan)
      }
      HStack(spacing: 8) {
        ForEach([250, 500], id: \.self) { ml in
          Button("+\(ml) ml") { Task { await model.logDrink(ml: ml) } }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .tint(.cyan)
        }
      }
    }
  }
}

struct FoodCard: View {
  let nutrition: Components.Schemas.Nutrition

  var body: some View {
    SummaryCard(
      title: "Food", category: .food,
      caption: "\(nutrition.meals.count) \(nutrition.meals.count == 1 ? "meal" : "meals")"
    ) {
      HStack {
        MiniValue(
          value: Format.number(nutrition.calories),
          unit: nutrition.targetCalories.map { "/ \(Format.number($0)) kcal" } ?? "kcal",
          label: "Energy")
        MiniValue(
          value: Format.number(nutrition.protein),
          unit: nutrition.targetProtein.map { "/ \(Format.number($0)) g" } ?? "g", label: "Protein")
      }
      ForEach(nutrition.meals, id: \.id) { meal in
        HStack {
          Text(meal.name).font(.subheadline)
          Spacer()
          Text("\(Format.number(meal.calories)) kcal")
            .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
        }
      }
    }
  }
}

struct TrainingCard: View {
  let today: Today

  var body: some View {
    SummaryCard(title: "Strength", category: .training) {
      if let active = today.activeWorkout {
        Text(active.title).font(.headline)
        Text("In progress · \(active.loggedSets) sets across \(active.exercises) exercises")
          .font(.subheadline).foregroundStyle(.orange)
      } else if !today.strengthToday.isEmpty {
        ForEach(today.strengthToday, id: \.id) { session in
          Text(session.title).font(.headline)
          Text("\(session.loggedSets) sets").font(.subheadline).foregroundStyle(.secondary)
        }
      } else if let next = today.nextSession {
        Text(next.title).font(.headline)
        Text("Next in \(next.programName) · \(next.position) of \(next.count)")
          .font(.subheadline).foregroundStyle(.secondary)
      } else {
        Text("No strength session planned").foregroundStyle(.secondary)
      }
    }
  }
}

struct ActivityRow: View {
  let activity: Components.Schemas.Activity

  var body: some View {
    HStack(spacing: 12) {
      IconBadge(symbol: ActivityRow.symbol(activity.activity), tint: .green)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 4) {
          Text(activity.title)
          if activity.fromAppleHealth { AppleHealthMark() }
        }
        Text(details).font(.subheadline).foregroundStyle(.secondary)
        if let route = activity.routeText {
          Text("\(Image(systemName: "map")) \(route)")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var details: String {
    [
      activity.durationText,
      activity.distanceKm.map { $0.formatted(.number.precision(.fractionLength(0...2))) + " km" },
      activity.averageHeartRate.map { "\($0) bpm" },
      activity.caloriesKcal.map { "\(Format.number($0)) kcal" },
    ].compactMap { $0 }.joined(separator: " · ")
  }

  static func symbol(_ kind: String) -> String {
    switch kind {
    case "running": "figure.run"
    case "walking": "figure.walk"
    case "cycling": "figure.outdoor.cycle"
    case "swimming": "figure.pool.swim"
    case "rowing": "figure.rower"
    case "hiking": "figure.hiking"
    case "elliptical": "figure.elliptical"
    default: "figure.mixed.cardio"
    }
  }
}

// MARK: Queue

struct QueueSection: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Section {
      if model.queued > 0 {
        Label(
          "\(model.queued) \(model.queued == 1 ? "change" : "changes") waiting to sync",
          systemImage: "icloud.and.arrow.up")
      }
      ForEach(model.refused) { item in
        VStack(alignment: .leading, spacing: 4) {
          Label("Not saved", systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.orange)
          Text(item.refusal ?? "").font(.subheadline)
        }
        .swipeActions {
          Button("Dismiss", role: .destructive) { Task { await model.discardRefused(item) } }
        }
      }
    }
  }
}
