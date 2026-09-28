import LiftAPI
import LiftStore
import LiftTheme
import SwiftUI

/// The day at a glance: the day's targets as rings, then recovery, body,
/// nutrition and training, each card opening a chart of recent days.
struct TodayView: View {
  @Environment(AppModel.self) private var model
  @State private var healthNeedsAccess = false
  /// The last seven days, for the small charts on each card.
  @State private var week: Components.Schemas.Trends?

  var body: some View {
    @Bindable var model = model
    ScrollView {
      if let today = model.today {
        content(today)
      } else if model.loadingToday {
        ProgressView().frame(maxWidth: .infinity).padding(.top, 120)
      } else {
        ContentUnavailableView(
          "Today isn't available", systemImage: "wifi.slash",
          description: Text(model.todayError ?? "Pull down to try again."))
        .padding(.top, 80)
      }
    }
    .background(Theme.background)
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
    }
    .sheet(isPresented: $model.showingCheckin) { CheckinSheet(existing: model.today?.checkin, body_: model.today?.body) }
    .sensoryFeedback(.success, trigger: model.saves)
    .task(id: model.health.lastSync) {
      healthNeedsAccess = model.health.connected ? await HealthSync.shared.needsAccess() : false
    }
    .task(id: model.today?.revision) {
      week = try? await model.client.getTrends(query: .init(date: JournalDay.string(.now), days: 7)).value()
    }
  }

  private var logMenu: some View {
    Menu {
      Button("250 ml Water", systemImage: "drop.fill") { Task { await model.logDrink(ml: 250) } }
      Button("500 ml Water", systemImage: "drop.fill") { Task { await model.logDrink(ml: 500) } }
      Button("Check In", systemImage: "face.smiling") { model.showingCheckin = true }
      Divider()
      if model.voiceEnabled {
        Button("Talk to Coach", systemImage: "waveform") { model.startVoice() }
      }
      Button("Write to Coach", systemImage: "text.bubble") { model.tab = .coach }
    } label: {
      Label("Log", systemImage: "plus")
    }
  }

  /// One series from the last seven days, oldest first.
  private func series(_ value: (Components.Schemas.TrendDay) -> Double?) -> [Double?] {
    (week?.days ?? []).suffix(7).map(value)
  }

  private func content(_ today: Today) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      if !model.refused.isEmpty || model.queued > 0 {
        QueueCard()
      }
      DayHero(today: today)
      if model.health.available && !model.health.connected {
        HealthPrompt(
          symbol: "heart.fill", title: "Connect Apple Health",
          detail: "Sleep, heart rate and workouts, without typing")
      } else if model.health.connected && healthNeedsAccess {
        HealthPrompt(
          symbol: "heart.text.square.fill", title: "Allow new Apple Health data",
          detail: "Workout routes, and body fat from a smart scale, for you and Coach")
      }

      SectionHeading("Recovery").padding(.horizontal, 4).padding(.top, 10)
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
        NavigationLink(value: Trend.sleep) {
          MetricTile(
            title: "Sleep", category: .sleep, value: today.sleep.hours.map(Format.hours), note: sleepNote(today),
            empty: "Nothing recorded last night"
          ) {
            Sparkline(values: series { $0.sleepHours }, tint: Category.sleep.tint)
          }
        }
        NavigationLink(value: Trend.heart) {
          MetricTile(
            title: "Resting Heart", category: .heart, value: today.vitals?.restingHeartRate.map(String.init), unit: "bpm",
            note: today.vitals?.heartRateVariabilityMs.map { "HRV \(Format.number($0)) ms" },
            empty: model.health.connected ? "Nothing from Apple Health yet" : "Connect Apple Health"
          ) {
            Sparkline(values: series { $0.restingHeartRate.map(Double.init) }, tint: Category.heart.tint, style: .line)
          }
        }
        NavigationLink(value: Trend.activity) {
          MetricTile(
            title: "Steps", category: .activity, value: today.vitals?.steps.map { $0.formatted() },
            note: today.vitals?.activeEnergyKcal.map { "\($0.formatted()) kcal active" },
            empty: model.health.connected ? "No steps yet today" : "Connect Apple Health",
            symbol: "figure.walk"
          ) {
            Sparkline(values: series { $0.steps.map(Double.init) }, tint: Category.activity.tint)
          }
        }
        Button { model.showingCheckin = true } label: {
          FeelTile(checkin: today.checkin)
        }
      }
      .buttonStyle(CardButtonStyle())

      SectionHeading("Body").padding(.horizontal, 4).padding(.top, 10)
      NavigationLink(value: Trend.body) {
        BodyCard(body: today.body, weights: series { $0.bodyweight })
      }
      .buttonStyle(CardButtonStyle())

      SectionHeading("Nutrition").padding(.horizontal, 4).padding(.top, 10)
      NutritionCard(nutrition: today.nutrition, hydration: today.hydration)

      SectionHeading("Training").padding(.horizontal, 4).padding(.top, 10)
      TrainingCard(today: today)
      Text(
        "\(today.sessionsThisWeek) \(today.sessionsThisWeek == 1 ? "session" : "sessions") in the last seven days. Workouts from Apple Health appear here by themselves."
      )
      .font(.footnote)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 4)
    }
    .padding(.horizontal, 16)
    .padding(.bottom, 24)
  }

  private func sleepNote(_ today: Today) -> String? {
    guard let average = today.sleep.averageHours, today.sleep.nights > 1 else { return nil }
    return "Avg \(Format.hours(average))"
  }
}

/// Opens Apple Health settings from Today.
private struct HealthPrompt: View {
  let symbol: String
  let title: String
  let detail: String

  var body: some View {
    NavigationLink {
      HealthView()
    } label: {
      HStack(spacing: 12) {
        IconBadge(symbol: symbol, tint: Theme.heart, size: 36)
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.headline).foregroundStyle(Color.primary)
          Text(detail).font(.subheadline).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
      }
      .card()
    }
    .buttonStyle(CardButtonStyle())
  }
}

// MARK: Cards

/// The day's targets as rings, how the athlete is recovering, and the way
/// into a spoken check-in.
struct DayHero: View {
  @Environment(AppModel.self) private var model
  let today: Today

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 8) {
        TargetRing(
          title: "Energy", value: Format.number(today.nutrition.calories),
          target: today.nutrition.targetCalories.map { "of \(Format.number($0))" } ?? "kcal",
          progress: progress(today.nutrition.calories, today.nutrition.targetCalories), tint: Theme.calories)
        TargetRing(
          title: "Protein", value: "\(Format.number(today.nutrition.protein)) g",
          target: today.nutrition.targetProtein.map { "of \(Format.number($0)) g" } ?? "today",
          progress: progress(today.nutrition.protein, today.nutrition.targetProtein), tint: Theme.protein)
        TargetRing(
          title: "Water", value: litres(today.hydration.totalMl), target: "of \(litres(today.hydration.targetMl))",
          progress: Double(today.hydration.totalMl) / Double(max(1, today.hydration.targetMl)), tint: Theme.water)
      }
      BurnedLine(burned: today.burned)
      Button {
        if model.voiceEnabled { model.startVoice() } else { model.tab = .coach }
      } label: {
        HStack(spacing: 12) {
          Image(systemName: model.voiceEnabled ? "waveform" : "text.bubble.fill")
            .font(.headline)
            .foregroundStyle(Theme.onAccent)
            .frame(width: 36, height: 36)
            .background(Theme.accent, in: .circle)
          VStack(alignment: .leading, spacing: 1) {
            Text(model.voiceEnabled ? "Check in with Coach" : "Write to Coach")
              .font(.subheadline.weight(.semibold)).foregroundStyle(Color.primary)
            Text("Coach logs your day as you talk")
              .font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 0)
          Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
        }
        .padding(10)
        .background(Theme.fill, in: .rect(cornerRadius: 16, style: .continuous))
      }
      .buttonStyle(CardButtonStyle())
    }
    .card()
  }

  private func progress(_ value: Double, _ target: Double?) -> Double {
    guard let target, target > 0 else { return value > 0 ? 1 : 0 }
    return value / target
  }

  private func litres(_ ml: Int) -> String {
    let (value, unit) = Format.litres(ml)
    return "\(value) \(unit)"
  }
}

/// Calories burned today: Apple Health's active energy, or the training
/// total with estimates marked. Shown beside food, never offset against it.
struct BurnedLine: View {
  let burned: Components.Schemas.Burned?

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "flame.fill")
        .font(.subheadline)
        .foregroundStyle(Theme.calories)
      VStack(alignment: .leading, spacing: 1) {
        Text("Burned").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        Text(burned?.note ?? "From training and Apple Health")
          .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
      }
      Spacer(minLength: 8)
      if let burned {
        Text("\(burned.estimated ? "~" : "")\(burned.kcal.formatted()) kcal")
          .font(.subheadline.weight(.semibold).monospacedDigit())
      } else {
        Text("Nothing yet").font(.subheadline).foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// Energy and soreness from today's check-in; opens the check-in.
struct FeelTile: View {
  let checkin: Components.Schemas.Checkin?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      CardLabel(title: "How You Feel", symbol: Category.checkin.symbol, tint: Category.checkin.tint)
      if let checkin, checkin.energy != nil || checkin.soreness != nil {
        scale("Energy", checkin.energy, Theme.feltEnergy)
        scale("Soreness", checkin.soreness, Theme.soreness)
      } else {
        Text("Tap to check in").font(.subheadline).foregroundStyle(.secondary)
        Spacer(minLength: 0)
        Label("Check in", systemImage: "plus.circle.fill")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.tint)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
    .card(padding: 14)
  }

  /// A 1–5 value as five dots.
  private func scale(_ label: String, _ value: Int?, _ tint: Color) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      HStack {
        Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        Spacer()
        Text(value.map { "\($0)/5" } ?? "–")
          .font(.system(.caption, design: .rounded, weight: .bold)).foregroundStyle(Color.primary)
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

/// Weight, body fat and lean mass, with the weekly trend and the goal.
struct BodyCard: View {
  let body_: Components.Schemas.Body?
  let weights: [Double?]

  init(body: Components.Schemas.Body?, weights: [Double?]) {
    body_ = body
    self.weights = weights
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 6) {
        CardLabel(title: "Weight & Body Fat", symbol: Category.body.symbol, tint: Category.body.tint)
        Spacer()
        if let focus = Format.focus(body_?.focus) {
          Text(focus)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.fill, in: .capsule)
            .foregroundStyle(.secondary)
        }
      }
      if let b = body_, b.bodyweight != nil || b.bodyFatPercent != nil {
        HStack(alignment: .bottom, spacing: 16) {
          VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
              Text(b.bodyweight.map { $0.formatted() } ?? "–")
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.primary)
              Text("kg").font(.system(.subheadline, design: .rounded, weight: .semibold)).foregroundStyle(.secondary)
            }
            if let change = b.weeklyWeightChangeKg {
              Label(
                "\(change > 0 ? "+" : "")\(change.formatted(.number.precision(.fractionLength(0...2)))) kg a week",
                systemImage: change > 0 ? "arrow.up.right" : "arrow.down.right"
              )
              .font(.caption.weight(.semibold))
              .foregroundStyle(.secondary)
            }
          }
          Sparkline(values: weights, tint: Category.body.tint, style: .line)
            .frame(height: 54)
        }
        HStack {
          MiniValue(value: b.bodyFatPercent.map { $0.formatted() }, unit: "%", label: "Body fat")
          MiniValue(value: b.leanMassKg.map { $0.formatted() }, unit: "kg", label: "Lean mass")
          if let goal = b.targetWeightKg {
            MiniValue(value: goal.formatted(), unit: "kg", label: "Goal")
          } else if let goal = b.targetBodyFatPercent {
            MiniValue(value: goal.formatted(), unit: "%", label: "Goal")
          }
        }
      } else {
        Text("Add your weight and body fat in a check-in to follow your progress.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .card()
    .accessibilityElement(children: .combine)
  }

}

/// Macros against their targets, the day's meals and drinks, and one-tap
/// water.
struct NutritionCard: View {
  @Environment(AppModel.self) private var model
  let nutrition: Components.Schemas.Nutrition
  let hydration: Components.Schemas.Hydration

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      NavigationLink(value: Trend.food) {
        VStack(alignment: .leading, spacing: 12) {
          HStack(spacing: 6) {
            CardLabel(title: "Food", symbol: Category.food.symbol, tint: Category.food.tint)
            Spacer()
            Text("\(Format.number(nutrition.calories)) kcal")
              .font(.system(.subheadline, design: .rounded, weight: .bold)).foregroundStyle(Color.primary)
            Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
          }
          MacroSplit(protein: nutrition.protein, carbs: nutrition.carbs ?? 0, fat: nutrition.fat ?? 0)
          if nutrition.meals.isEmpty {
            Text("No meals yet. Tell Coach what you ate, or send a photo.")
              .font(.subheadline).foregroundStyle(.secondary)
          }
          ForEach(nutrition.meals, id: \.id) { meal in
            HStack(spacing: 10) {
              Text(meal._type.capitalized)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .leading)
              Text(meal.name).font(.subheadline).foregroundStyle(Color.primary).lineLimit(1)
              Spacer(minLength: 6)
              Text("\(Format.number(meal.calories)) kcal")
                .font(.system(.subheadline, design: .rounded)).foregroundStyle(.secondary).monospacedDigit()
            }
          }
        }
      }
      .buttonStyle(CardButtonStyle())
      Divider()
      NavigationLink(value: Trend.water) {
        HStack(spacing: 6) {
          CardLabel(title: "Drinks", symbol: Category.water.symbol, tint: Category.water.tint)
          Spacer()
          let (value, unit) = Format.litres(hydration.totalMl)
          Text("\(value) \(unit)")
            .font(.system(.subheadline, design: .rounded, weight: .bold)).foregroundStyle(Color.primary)
          Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
        }
      }
      .buttonStyle(CardButtonStyle())
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach([250, 500], id: \.self) { ml in
            Button {
              Task { await model.logDrink(ml: ml) }
            } label: {
              Label("\(ml) ml", systemImage: "plus")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Theme.fill, in: .capsule)
                .foregroundStyle(.tint)
            }
            .buttonStyle(CardButtonStyle())
          }
          ForEach(hydration.drinks.reversed(), id: \.id) { drink in
            Text("\(drink.name.isEmpty ? drink.kind.capitalized : drink.name) · \(drink.ml) ml")
              .font(.subheadline)
              .padding(.horizontal, 12).padding(.vertical, 7)
              .background(Theme.fill, in: .capsule)
              .contextMenu {
                Button("Delete", systemImage: "trash", role: .destructive) {
                  Task { await model.removeDrink(id: drink.id) }
                }
              }
          }
        }
      }
    }
    .card()
  }
}

/// The workout in progress, today's sessions or the next one, and today's
/// other activities.
struct TrainingCard: View {
  @Environment(AppModel.self) private var model
  let today: Today

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Button {
        model.tab = .train
      } label: {
        HStack(spacing: 12) {
          IconBadge(symbol: Category.training.symbol, tint: Category.training.tint, size: 44)
          VStack(alignment: .leading, spacing: 2) {
            if let active = today.activeWorkout {
              Text("In progress").font(.caption.weight(.bold)).foregroundStyle(Theme.attention)
              Text(active.title).font(.headline).foregroundStyle(Color.primary)
              Text("\(active.loggedSets) sets across \(active.exercises) exercises")
                .font(.subheadline).foregroundStyle(.secondary)
            } else if let done = today.strengthToday.first {
              Text("Done today").font(.caption.weight(.bold)).foregroundStyle(Theme.success)
              Text(done.title).font(.headline).foregroundStyle(Color.primary)
              Text("\(done.loggedSets) sets").font(.subheadline).foregroundStyle(.secondary)
            } else if let next = today.nextSession {
              Text("Next · \(next.programName)").font(.caption.weight(.bold)).foregroundStyle(Category.training.tint)
              Text(next.title).font(.headline).foregroundStyle(Color.primary)
              Text("Session \(next.position) of \(next.count)").font(.subheadline).foregroundStyle(.secondary)
            } else {
              Text("No strength session planned").font(.subheadline).foregroundStyle(.secondary)
            }
          }
          Spacer(minLength: 0)
          Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
      }
      .buttonStyle(CardButtonStyle())
      .accessibilityHint("Opens Train")
      ForEach(today.activities, id: \.id) { activity in
        Divider()
        if activity.hasRoute == true {
          NavigationLink {
            ActivityRouteView(id: activity.id, title: activity.title)
          } label: {
            ActivityRow(activity: activity)
          }
          .buttonStyle(CardButtonStyle())
        } else {
          ActivityRow(activity: activity)
        }
      }
    }
    .card()
  }
}

struct ActivityRow: View {
  let activity: Components.Schemas.Activity

  var body: some View {
    HStack(spacing: 12) {
      IconBadge(symbol: ActivityRow.symbol(activity.activity), tint: Category.activity.tint, size: 44)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 4) {
          Text(activity.title).font(.headline).foregroundStyle(Color.primary)
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
      Spacer(minLength: 0)
      if activity.hasRoute == true {
        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
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

/// Changes waiting to sync, and any the server refused.
struct QueueCard: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if model.queued > 0 {
        Label(
          "\(model.queued) \(model.queued == 1 ? "change" : "changes") waiting to sync",
          systemImage: "icloud.and.arrow.up")
        .font(.subheadline.weight(.semibold))
      }
      ForEach(model.refused) { item in
        VStack(alignment: .leading, spacing: 4) {
          Label("Not saved", systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.attention)
          Text(item.refusal ?? "").font(.subheadline)
          Button("Dismiss", role: .destructive) { Task { await model.discardRefused(item) } }
            .font(.footnote.weight(.semibold))
        }
      }
    }
    .card()
  }
}
