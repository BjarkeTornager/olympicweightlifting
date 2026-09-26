import LiftAPI
import LiftStore
import SwiftUI

struct TodayView: View {
  @Environment(AppModel.self) private var model
  @State private var showingAccount = false
  @State private var showingCheckin = false

  var body: some View {
    List {
      if let today = model.today {
        content(today)
      } else if model.loadingToday {
        ProgressView("Opening your journal")
          .frame(maxWidth: .infinity)
          .listRowBackground(Color.clear)
      } else {
        ContentUnavailableView(
          "Today isn't available", systemImage: "wifi.slash",
          description: Text(model.todayError ?? "Pull down to try again."))
      }
    }
    .navigationTitle("Today")
    .navigationSubtitle(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
    .refreshable {
      await model.flush()
      await model.loadToday()
      await model.syncHealth(force: true)
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Account", systemImage: "person.crop.circle") { showingAccount = true }
      }
    }
    .sheet(isPresented: $showingAccount) { AccountView() }
    .sheet(isPresented: $showingCheckin) {
      CheckinSheet(existing: model.today?.checkin)
    }
  }

  @ViewBuilder
  private func content(_ today: Today) -> some View {
    if !model.refused.isEmpty || model.queued > 0 {
      QueueSection()
    }
    if let next = today.priorities.first {
      Section {
        VStack(alignment: .leading, spacing: 6) {
          Text(next.category.capitalized)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.tint)
          Text(next.title).font(.headline)
          Text(next.reason).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
      }
    }
    RecoverySection(today: today, showCheckin: { showingCheckin = true })
    HydrationSection(hydration: today.hydration)
    FoodSection(nutrition: today.nutrition)
    TrainingSection(today: today)
    Section {
      EmptyView()
    } footer: {
      if let updated = model.todayUpdated {
        Text("Updated \(updated.formatted(.relative(presentation: .named)))")
      } else if model.todayError != nil {
        Text("Showing your last saved copy. \(model.todayError ?? "")")
      }
    }
  }
}

// MARK: Sleep, heart and check-in

struct RecoverySection: View {
  @Environment(AppModel.self) private var model
  let today: Today
  let showCheckin: () -> Void

  var body: some View {
    Section("Recovery") {
      HStack {
        Label {
          VStack(alignment: .leading, spacing: 2) {
            Text("Sleep")
            if let average = today.sleep.averageHours, today.sleep.nights > 1 {
              Text("\(hours(average)) average over \(today.sleep.nights) nights")
                .font(.caption).foregroundStyle(.secondary)
            }
          }
        } icon: {
          Image(systemName: "bed.double.fill").foregroundStyle(.indigo)
        }
        Spacer()
        if let text = today.sleep.text {
          VStack(alignment: .trailing, spacing: 2) {
            Text(text).font(.headline.monospacedDigit())
            if today.sleep.fromAppleHealth { AppleHealthBadge() }
          }
        } else {
          Text("Not recorded").foregroundStyle(.secondary)
        }
      }
      if let vitals = today.vitals {
        HStack(spacing: 0) {
          Stat(value: vitals.restingHeartRate.map { "\($0)" }, unit: "bpm", label: "Resting heart rate")
          Stat(value: vitals.heartRateVariabilityMs.map { "\(Int($0.rounded()))" }, unit: "ms", label: "HRV")
          Stat(value: vitals.steps.map { $0.formatted() }, unit: nil, label: "Steps")
        }
        .padding(.vertical, 4)
      } else if !model.health.connected && model.health.available {
        NavigationLink {
          HealthView()
        } label: {
          Label("Connect Apple Health for sleep, heart rate and workouts", systemImage: "heart.fill")
            .foregroundStyle(.pink)
        }
      }
      Button(action: showCheckin) {
        HStack {
          Label("How do you feel?", systemImage: "face.smiling")
          Spacer()
          if let checkin = today.checkin {
            Text(checkinSummary(checkin)).foregroundStyle(.secondary).font(.subheadline)
          } else {
            Text("Check in").foregroundStyle(.tint)
          }
        }
      }
      .foregroundStyle(.primary)
    }
  }

  private func hours(_ value: Double) -> String {
    let minutes = Int((value * 60).rounded())
    return "\(minutes / 60) h \(minutes % 60) min"
  }

  private func checkinSummary(_ c: Components.Schemas.Checkin) -> String {
    [
      c.energy.map { "Energy \($0)/5" },
      c.soreness.map { "Soreness \($0)/5" },
      c.bodyweight.map { "\($0.formatted()) kg" },
    ].compactMap { $0 }.joined(separator: " · ")
  }
}

struct Stat: View {
  let value: String?
  let unit: String?
  let label: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(alignment: .firstTextBaseline, spacing: 2) {
        Text(value ?? "–").font(.title3.bold().monospacedDigit())
        if let unit, value != nil { Text(unit).font(.caption).foregroundStyle(.secondary) }
      }
      Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

struct AppleHealthBadge: View {
  var body: some View {
    Label("Apple Health", systemImage: "heart.fill")
      .font(.caption2)
      .foregroundStyle(.pink)
      .labelStyle(.titleAndIcon)
  }
}

// MARK: Water

struct HydrationSection: View {
  @Environment(AppModel.self) private var model
  let hydration: Components.Schemas.Hydration

  var body: some View {
    Section {
      VStack(alignment: .leading, spacing: 10) {
        HStack(alignment: .firstTextBaseline) {
          Text(litres(hydration.totalMl)).font(.title2.bold().monospacedDigit())
          Text("of \(litres(hydration.targetMl))\(hydration.estimatedTarget ? " (estimate)" : "")")
            .foregroundStyle(.secondary)
        }
        ProgressView(value: min(1, Double(hydration.totalMl) / Double(max(1, hydration.targetMl))))
          .tint(.cyan)
        HStack {
          ForEach([250, 500], id: \.self) { ml in
            Button("+\(ml) ml") { Task { await model.logDrink(ml: ml) } }
              .buttonStyle(.bordered)
              .tint(.cyan)
          }
        }
        .padding(.top, 2)
      }
      .padding(.vertical, 4)
      ForEach(hydration.drinks.reversed(), id: \.id) { drink in
        HStack {
          Text(drink.name.isEmpty ? drink.kind.capitalized : drink.name)
          Spacer()
          Text("\(drink.ml) ml").foregroundStyle(.secondary).monospacedDigit()
        }
        .swipeActions {
          Button("Delete", role: .destructive) { Task { await model.removeDrink(id: drink.id) } }
        }
      }
    } header: {
      Label("Water", systemImage: "drop.fill")
    }
  }

  private func litres(_ ml: Int) -> String {
    ml < 1000
      ? "\(ml) ml"
      : (Double(ml) / 1000).formatted(.number.precision(.fractionLength(0...2))) + " L"
  }
}

// MARK: Food

struct FoodSection: View {
  @Environment(AppModel.self) private var model
  let nutrition: Components.Schemas.Nutrition

  var body: some View {
    Section {
      HStack(spacing: 0) {
        Stat(value: Int(nutrition.calories.rounded()).formatted(), unit: target(nutrition.targetCalories, "kcal"), label: "Energy")
        Stat(value: Int(nutrition.protein.rounded()).formatted(), unit: target(nutrition.targetProtein, "g"), label: "Protein")
      }
      .padding(.vertical, 4)
      ForEach(nutrition.meals, id: \.id) { meal in
        HStack {
          VStack(alignment: .leading) {
            Text(meal.name)
            Text(meal._type.capitalized).font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Text("\(Int(meal.calories.rounded())) kcal").foregroundStyle(.secondary).monospacedDigit()
        }
      }
      Button {
        model.tab = .coach
      } label: {
        Label("Log food with Coach", systemImage: "camera")
      }
    } header: {
      Label("Food", systemImage: "fork.knife")
    }
  }

  private func target(_ value: Double?, _ unit: String) -> String {
    value.map { "/ \(Int($0.rounded())) \(unit)" } ?? unit
  }
}

// MARK: Training

struct TrainingSection: View {
  @Environment(AppModel.self) private var model
  let today: Today

  var body: some View {
    Section {
      if let active = today.activeWorkout {
        VStack(alignment: .leading, spacing: 4) {
          Text("In progress").font(.caption.weight(.semibold)).foregroundStyle(.orange)
          Text(active.title).font(.headline)
          Text("\(active.loggedSets) sets logged across \(active.exercises) exercises")
            .font(.subheadline).foregroundStyle(.secondary)
        }
      } else if let next = today.nextSession {
        VStack(alignment: .leading, spacing: 4) {
          Text("Next · \(next.programName) \(next.position) of \(next.count)")
            .font(.caption.weight(.semibold)).foregroundStyle(.tint)
          Text(next.title).font(.headline)
          Text("\(next.exercises) exercises").font(.subheadline).foregroundStyle(.secondary)
        }
      }
      ForEach(today.strengthToday, id: \.id) { session in
        Label {
          VStack(alignment: .leading) {
            Text(session.title)
            Text("\(session.loggedSets) sets").font(.caption).foregroundStyle(.secondary)
          }
        } icon: {
          Image(systemName: "figure.strengthtraining.olympic")
        }
      }
      ForEach(today.activities, id: \.id) { activity in
        ActivityRow(activity: activity)
      }
      if today.activeWorkout == nil && today.strengthToday.isEmpty && today.activities.isEmpty {
        Text("Nothing recorded yet today. Workouts from Apple Health appear here automatically.")
          .font(.subheadline).foregroundStyle(.secondary)
      }
    } header: {
      Label("Training", systemImage: "figure.run")
    } footer: {
      Text("\(today.sessionsThisWeek) sessions in the last seven days")
    }
  }
}

struct ActivityRow: View {
  let activity: Components.Schemas.Activity

  var body: some View {
    HStack(alignment: .top) {
      Image(systemName: ActivityRow.symbol(activity.activity))
        .foregroundStyle(.green)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 2) {
        Text(activity.title)
        Text(details).font(.caption).foregroundStyle(.secondary)
        if activity.fromAppleHealth { AppleHealthBadge() }
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var details: String {
    [
      activity.durationText,
      activity.distanceKm.map { $0.formatted(.number.precision(.fractionLength(0...2))) + " km" },
      activity.averageHeartRate.map { "\($0) bpm avg" },
      activity.caloriesKcal.map { "\(Int($0.rounded())) kcal" },
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
