import Charts
import LiftAPI
import LiftStore
import LiftTheme
import SwiftUI

/// The day as a printed page: the issue line and the date, a plain line on
/// what has been logged, the Ledger of energy, protein and water, the way
/// into a check-in, then recovery, body, food and drink and movement, each
/// opening a chart of recent days. The colophon closes the page.
struct TodayView: View {
  @Environment(AppModel.self) private var model
  @State private var healthNeedsAccess = false
  @AppStorage(FirstStepsCard.hiddenKey) private var firstStepsHidden = false
  /// The last seven days, for the small charts and the weekly sleep average.
  @State private var week: Components.Schemas.Trends?
  /// The first day of this journal on this iPhone, for the issue number
  /// when the server doesn't send the day the journal began.
  @State private var firstDay: Date?
  /// Scrolled past the masthead: the inline title takes over from it.
  @State private var scrolled = false

  init(week: Components.Schemas.Trends? = nil) {
    _week = State(initialValue: week)
  }

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
    // Follows the distance rather than whether it is past the masthead: as
    // the page reloads, a change to "past" could come before an older one.
    .onScrollGeometryChange(for: CGFloat.self) { geometry in
      geometry.contentOffset.y + geometry.contentInsets.top
    } action: { _, distance in
      let past = distance > 120
      if past != scrolled { withAnimation(.easeInOut(duration: 0.2)) { scrolled = past } }
    }
    .background(Theme.background)
    .navigationTitle("Today")
    .toolbarTitleDisplayMode(.inline)
    .navigationDestination(for: Trend.self) { TrendView(trend: $0) }
    .refreshable {
      await model.flush()
      await model.loadToday()
      await model.syncHealth(force: true)
    }
    .toolbar {
      // Taken out of the bar once scrolled, not only hidden, so the title
      // is centred and has room at every text size.
      if !scrolled {
        ToolbarItem(placement: .topBarLeading) { issueLine }
          .sharedBackgroundVisibility(.hidden)
      }
      ToolbarItem(placement: .principal) {
        Text("Today")
          .font(.system(.headline, design: .serif, weight: .medium))
          .foregroundStyle(Theme.ink)
          .opacity(scrolled ? 1 : 0)
          .accessibilityHidden(!scrolled)
      }
      ToolbarItem(placement: .topBarTrailing) { logMenu }
    }
    .sheet(isPresented: $model.showingCheckin) {
      CheckinSheet(existing: model.today?.checkin, body_: model.today?.body, sleep: model.today?.sleep)
    }
    .sensoryFeedback(.success, trigger: model.saves)
    // What was just saved, as a margin note under the bar.
    .toast($model.confirmation)
    .task(id: model.session?.accountID) {
      if let account = model.session?.accountID { firstDay = Issue.firstDay(account: account) }
    }
    .task(id: model.health.lastSync) {
      healthNeedsAccess = model.health.connected ? await HealthSync.shared.needsAccess() : false
    }
    .task(id: model.today?.revision) {
      // Offline, the charts keep the week they have.
      if let fresh = try? await model.client.getTrends(query: .init(date: JournalDay.string(.now), days: 7)).value() {
        week = fresh
      }
    }
  }

  private var day: Date { model.today.flatMap { JournalDay.date($0.date) } ?? .now }

  /// Which issue of the journal this day is.
  private var issue: Int? {
    Issue.first(journal: model.today?.journalStartDate, device: firstDay).map { Issue.number(first: $0, day: day) }
  }

  /// The running head beside the system's + button: the wordmark, then
  /// "Nº 13 · Week 40". The wordmark names the page, so the issue beside it
  /// is in sentence case rather than spaced capitals.
  private var issueLine: some View {
    let number = issue
    let prefix = number.map { "Nº \($0) · " } ?? ""
    return HStack(alignment: .firstTextBaseline, spacing: 9) {
      Wordmark()
      Text("\(prefix)Week \(Issue.week(day))").font(.footnote).foregroundStyle(Theme.inkSecondary)
    }
    .lineLimit(1)
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Lift Journal, \(number.map { "issue \($0), " } ?? "")week \(Issue.week(day))")
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

  // MARK: The last seven days

  private var weekDays: [Components.Schemas.TrendDay] { Array((week?.days ?? []).suffix(7)) }

  /// One series from the last seven days, oldest first.
  private func series(_ value: (Components.Schemas.TrendDay) -> Double?) -> [Double?] {
    weekDays.map(value)
  }

  /// One initial per day under the small charts ("S", "S", "M"...).
  private var initials: [String]? {
    let dates = weekDays.compactMap { JournalDay.date($0.date) }
    guard !dates.isEmpty, dates.count == weekDays.count else { return nil }
    return dates.map { $0.formatted(.dateTime.weekday(.narrow).locale(Format.locale)) }
  }

  /// The average of the nights before last night, from at least three.
  private func priorSleepAverage(_ today: Today) -> Double? {
    let before = weekDays.filter { $0.date != today.date }.compactMap(\.sleepHours)
    return before.count >= 3 ? before.reduce(0, +) / Double(before.count) : nil
  }

  // MARK: The page

  private func content(_ today: Today) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      if !model.refused.isEmpty || model.queued > 0 {
        QueueCard().padding(.bottom, Theme.Space.l)
      }
      Masthead(day: day, summary: DaySummary(today: today, sleepAverage: priorSleepAverage(today)).text)
      ledger(today).padding(.top, 22)
      Button {
        if model.voiceEnabled { model.startVoice() } else { model.tab = .coach }
      } label: {
        CheckInBlock(
          title: model.voiceEnabled ? "Check in with Coach" : "Write to Coach",
          detail: model.voiceEnabled ? "Coach logs your day as you talk" : "Coach logs your day as you write")
      }
      .buttonStyle(CardButtonStyle())
      .padding(.top, 18)
      if let firstSteps = firstStepsHidden ? nil : today.firstSteps {
        FirstStepsCard(steps: firstSteps) { firstStepsHidden = true }
          .padding(.top, Theme.Space.section)
      }
      recovery(today).padding(.top, Theme.Space.section)
      BodySection(
        body: today.body, weights: weekDays.map { (JournalDay.date($0.date), $0.bodyweight) }
      ) { model.showingCheckin = true }
      .padding(.top, Theme.Space.section)
      FoodSection(nutrition: today.nutrition, hydration: today.hydration, supplements: today.supplements)
        .padding(.top, Theme.Space.section)
      MovementSection(today: today).padding(.top, Theme.Space.section)
      Colophon(issue: issue, name: firstName)
        .padding(.top, Theme.Space.section)
    }
    .padding(.horizontal, Theme.Space.gutter)
    .padding(.top, 6)
    .padding(.bottom, Theme.Space.l)
  }

  private var firstName: String? {
    model.athleteName?.split(separator: " ").first.map(String.init)
  }

  private func ledger(_ today: Today) -> some View {
    let food = today.nutrition
    let water = today.hydration
    let positive = { (value: Double?) in value.flatMap { $0 > 0 ? $0 : nil } }
    let (amount, unit) = Format.litres(water.totalMl)
    let (target, targetUnit) = Format.litres(water.targetMl)
    let glasses = max(1, Int((Double(water.targetMl) / 250).rounded()))
    return Ledger(
      energy: LedgerLine(
        title: "Energy", tint: Theme.calories, value: food.calories, target: positive(food.targetCalories),
        perMark: 100, number: Format.number(food.calories), unit: "kcal",
        targetText: food.targetCalories.map(Format.number), scale: "One mark = 100 kcal",
        spokenUnit: "kilocalories"),
      protein: LedgerLine(
        title: "Protein", tint: Theme.protein, value: food.protein, target: positive(food.targetProtein),
        perMark: 10, number: Format.number(food.protein), unit: "g",
        targetText: food.targetProtein.map { "\(Format.number($0)) g" }, scale: "10 g a mark",
        spokenUnit: "grams"),
      water: LedgerLine(
        title: "Water", tint: Theme.water, value: Double(water.totalMl),
        target: water.targetMl > 0 ? Double(water.targetMl) : nil, perMark: 250, number: amount, unit: unit,
        targetText: "\(target) \(targetUnit)",
        scale: "\(Format.number(water.totalMl / 250)) of \(Format.number(glasses)) glasses",
        spokenUnit: "millilitres"),
      burned: Self.burned(today.burned),
      burnedContext: today.burned?.context,
      energyLink: .food
    ) {
      model.openCoach(.message("Help me set my goals"))
    }
  }

  /// Today's burned figures, line by line. A server from before the lines
  /// sends one figure, which is an estimate all the same.
  static func burned(_ burned: Components.Schemas.Burned?) -> [LedgerBurn] {
    guard let burned else { return [] }
    guard let lines = burned.lines else {
      return [.init(label: "Burned", text: "~\(Format.number(burned.kcal))", note: burned.note)]
    }
    return lines.map { .init(label: $0.label, text: $0.text, note: $0.note) }
  }

  /// Under the steps: Apple's active energy, which is its estimate, and
  /// "Yesterday" when the cell shows yesterday's because today has nothing
  /// from Apple Health yet. The server holds the figure within range and
  /// flags one unusually high, as the Ledger does.
  static func stepsNote(_ today: Today) -> String? {
    guard let vitals = today.vitals else { return nil }
    let energy = vitals.activeEnergyKcal.map {
      "~\(Format.number((Double($0) / 10).rounded() * 10)) kcal active"
        + (vitals.activeEnergyUnusual == true ? ", unusually high" : "")
    }
    let parts = [vitals.date == today.date ? nil : "Yesterday", energy].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  // MARK: Recovery

  private func recovery(_ today: Today) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      FolioSection("Recovery", meta: "Seven days")
      CellGrid {
        // With nothing recorded, sleep adds last night in the check-in
        // rather than opening an empty chart.
        if today.sleep.hours == nil {
          Button { model.showingCheckin = true } label: { sleepCell(today) }
        } else {
          NavigationLink(value: Trend.sleep) { sleepCell(today) }
        }
        NavigationLink(value: Trend.heart) {
          MetricCell(
            title: "Resting heart", category: .heart, value: today.vitals?.restingHeartRate.map(Format.number),
            unit: "bpm", note: today.vitals?.heartRateVariabilityMs.map { "HRV \(Format.number($0)) ms" },
            empty: model.health.connected ? "Nothing from Apple Health yet" : "Connect Apple Health",
            chartHeight: 58
          ) {
            Sparkline(values: series { $0.restingHeartRate.map(Double.init) }, tint: Category.heart.tint, style: .line)
              .padding(.vertical, 8)
          }
        }
        NavigationLink(value: Trend.activity) {
          MetricCell(
            title: "Steps", category: .activity, value: today.vitals?.steps.map(Format.number),
            note: Self.stepsNote(today),
            empty: model.health.connected ? "No steps yet today" : "Connect Apple Health", chartHeight: 58
          ) {
            Sparkline(values: series { $0.steps.map(Double.init) }, tint: Category.activity.tint, days: initials)
          }
        }
        Button { model.showingCheckin = true } label: {
          FeelCell(checkin: today.checkin)
        }
      }
      .buttonStyle(CardButtonStyle())
      .padding(.top, Theme.Space.s)
      // The first steps include connecting Apple Health.
      if model.health.available && !model.health.connected && (firstStepsHidden || today.firstSteps == nil) {
        NavigationLink {
          HealthView()
        } label: {
          NoteRow(title: "Connect Apple Health", detail: "Sleep, heart rate and workouts, without typing")
        }
        .buttonStyle(CardButtonStyle())
      } else if model.health.connected && healthNeedsAccess {
        NavigationLink {
          HealthView()
        } label: {
          NoteRow(
            title: "Allow new Apple Health data",
            detail: "Workout routes, and body fat from a smart scale, for you and Coach")
        }
        .buttonStyle(CardButtonStyle())
      }
    }
  }

  private func sleepCell(_ today: Today) -> some View {
    let average = today.sleep.nights > 1 ? today.sleep.averageHours : nil
    return MetricCell(
      title: "Sleep", category: .sleep, value: today.sleep.hours.map(Format.hours),
      note: average.map { "Average \(Format.hours($0))" }, empty: "Tap to add last night", chartHeight: 58
    ) {
      Sparkline(values: series { $0.sleepHours }, tint: Category.sleep.tint, days: initials, average: average)
    }
  }
}

/// The date set like a magazine's front page, "Friday, / 2 October", with
/// the day's standfirst below.
private struct Masthead: View {
  let day: Date
  let summary: String?
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: -4) {
        Text("\(day.formatted(.dateTime.weekday(.wide).locale(Format.locale))),")
        Text(day.formatted(.dateTime.day().month(.wide).locale(Format.locale))).italic()
      }
      .folio(.masthead)
      .foregroundStyle(Theme.ink)
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isHeader)
      if let summary {
        Paragraph(summary, language: .english)
          .folio(.standfirst)
          .foregroundStyle(Theme.ink)
          // Two lines, as written; at the largest sizes it may run on
          // rather than be cut short.
          .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 14)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A new journal's three steps to a full day: Apple Health brings sleep and
/// movement, a meal brings food, and goals give the Ledger its targets.
/// The server sends them for two weeks, until all are done; they can be hidden.
struct FirstStepsCard: View {
  static let hiddenKey = "firstStepsHidden"
  @Environment(AppModel.self) private var model
  let steps: Components.Schemas.FirstSteps
  let hide: () -> Void

  var body: some View {
    let health = steps.appleHealth || model.health.connected
    VStack(alignment: .leading, spacing: 0) {
      Rectangle().fill(Theme.ink).frame(height: 1)
      HStack(alignment: .firstTextBaseline) {
        Text("Get started").foregroundStyle(Theme.ink).kicker()
        Spacer(minLength: 0)
        Button("Hide Get started", systemImage: "xmark", action: hide)
          .labelStyle(.iconOnly)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(Theme.inkSecondary)
          .frame(width: 44, height: 44)
          .contentShape(.rect)
      }
      Text("Three steps, and your days fill in.")
        .folio(.note)
        .foregroundStyle(Theme.inkSecondary)
      NavigationLink {
        HealthView()
      } label: {
        StepRow(
          done: health, tint: Theme.heart, title: "Connect Apple Health",
          detail: "Sleep, steps and workouts arrive by themselves")
      }
      .allowsHitTesting(!health)
      .padding(.top, 8)
      Hairline()
      Button {
        model.openCoach(.mealPhoto)
      } label: {
        StepRow(
          done: steps.meal, tint: Category.food.tint, title: "Log your first meal",
          detail: "Take a photo and Coach works out the rest")
      }
      .allowsHitTesting(!steps.meal)
      Hairline()
      Button {
        model.openCoach(.message("Help me set my goals"))
      } label: {
        StepRow(
          done: steps.goals, tint: Theme.ink, title: "Set your goals",
          detail: "Coach turns your weight and goal into daily targets")
      }
      .allowsHitTesting(!steps.goals)
    }
    .buttonStyle(.plain)
  }
}

/// One first step: the key of its area until done, then a check mark.
private struct StepRow: View {
  let done: Bool
  let tint: Color
  let title: String
  let detail: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Group {
        if done {
          Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(Theme.success)
        } else {
          Key(tint: tint).alignmentGuide(.firstTextBaseline) { $0[.bottom] }
        }
      }
      .frame(width: 14)
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(done ? Theme.inkSecondary : Theme.ink)
        if !done {
          Text(detail).font(.footnote).foregroundStyle(Theme.inkSecondary)
        }
      }
      .multilineTextAlignment(.leading)
      Spacer(minLength: 0)
      if !done { GoArrow(tint: Theme.accent) }
    }
    .padding(.vertical, 12)
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
    .accessibilityValue(done ? "Done" : "")
  }
}

/// Energy and soreness from today's check-in; opens the check-in.
private struct FeelCell: View {
  let checkin: Components.Schemas.Checkin?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        CardLabel(title: "How you feel", key: Category.checkin.tint)
        Spacer(minLength: 4)
        GoArrow()
      }
      if let checkin, checkin.energy != nil || checkin.soreness != nil {
        ScaleRow(label: "Energy", value: checkin.energy, tint: Theme.feltEnergy).padding(.top, 12)
        ScaleRow(label: "Soreness", value: checkin.soreness, tint: Theme.soreness).padding(.top, 14)
      } else {
        Text("Not checked in yet")
          .folio(.note)
          .foregroundStyle(Theme.inkSecondary)
          .padding(.top, 8)
        ActionText("Check in").padding(.top, 6)
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .multilineTextAlignment(.leading)
    .contentShape(.rect)
  }
}

// MARK: Body

/// Weight in the serif with its change over the week, a chart of the week's
/// readings, and body fat and lean mass below. Missing values are written
/// out: an action when there is one, a sentence when there is not.
private struct BodySection: View {
  let body_: Components.Schemas.Body?
  /// The week's readings, oldest first.
  let weights: [(day: Date?, kg: Double?)]
  let checkIn: () -> Void
  /// The chart grows with the text, as Recovery's do, so its two labelled
  /// hairlines keep apart.
  @ScaledMetric(relativeTo: .caption2) private var chartGrowth: CGFloat = 1

  init(body: Components.Schemas.Body?, weights: [(Date?, Double?)], checkIn: @escaping () -> Void) {
    body_ = body
    self.weights = weights.map { (day: $0.0, kg: $0.1) }
    self.checkIn = checkIn
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      FolioSection("Body", meta: Format.focus(body_?.focus))
      // Body fat can come from a smart scale through Apple Health while
      // weight only comes from a check-in in the last 30 days, so either may
      // be missing.
      if body_?.bodyweight != nil || body_?.bodyFatPercent != nil {
        if let kg = body_?.bodyweight {
          NavigationLink(value: Trend.body) { weight(kg) }
            .buttonStyle(CardButtonStyle())
            .padding(.top, 16)
        } else {
          VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: Trend.body) { weightLabel.contentShape(.rect) }
              .buttonStyle(CardButtonStyle())
            Button(action: checkIn) { ActionText("Add your weight in a check-in") }
              .buttonStyle(.plain)
          }
          .padding(.top, 16)
        }
        CellGrid(columns: goal == nil ? 2 : 3) {
          bodyFat
          leanMass
          if let goal {
            VStack(alignment: .leading, spacing: 6) {
              Text("Goal").label()
              Measure(value: goal.0, unit: goal.1, role: .inline).foregroundStyle(Theme.ink)
            }
            .accessibilityElement(children: .combine)
          }
        }
        .overlay(alignment: .top) { Hairline() }
        .padding(.top, 16)
      } else {
        VStack(alignment: .leading, spacing: 8) {
          Paragraph("Add your weight in a check-in to follow your progress.", language: .english)
            .folio(.note)
            .foregroundStyle(Theme.inkSecondary)
          Button(action: checkIn) { ActionText("Check in") }
            .buttonStyle(.plain)
        }
        .padding(.top, 14)
      }
    }
  }

  /// The first and latest readings of the week, when there are two.
  private var change: (kg: Double, since: Date)? {
    let readings = weights.compactMap { item in item.kg.flatMap { kg in item.day.map { (kg, $0) } } }
    guard let first = readings.first, let last = readings.last, readings.count > 1 else { return nil }
    return (last.0 - first.0, first.1)
  }

  private var goal: (String, String)? {
    if let kg = body_?.targetWeightKg { return (Format.decimal(kg), "kg") }
    if let percent = body_?.targetBodyFatPercent { return (Format.decimal(percent), "%") }
    return nil
  }

  /// The label over the weight, with the arrow to the chart.
  private var weightLabel: some View {
    HStack {
      CardLabel(title: "Weight", key: Theme.body)
      Spacer(minLength: 0)
      GoArrow()
    }
  }

  private func weight(_ kg: Double) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      weightLabel
      HStack(alignment: .lastTextBaseline) {
        Measure(value: Format.decimal(kg), unit: "kg", role: .display).foregroundStyle(Theme.ink)
        Spacer(minLength: 12)
        if let change {
          VStack(alignment: .trailing, spacing: 2) {
            Measure(value: signed(change.kg), unit: "kg", role: .inline).foregroundStyle(Theme.ink)
            Text("since \(change.since.formatted(.dateTime.weekday(.wide).locale(Format.locale)))")
              .font(.footnote)
              .foregroundStyle(Theme.inkSecondary)
          }
          .accessibilityElement(children: .combine)
        } else if let weekly = body_?.weeklyWeightChangeKg {
          VStack(alignment: .trailing, spacing: 2) {
            Measure(value: signed(weekly), unit: "kg", role: .inline).foregroundStyle(Theme.ink)
            Text("a week").font(.footnote).foregroundStyle(Theme.inkSecondary)
          }
          .accessibilityElement(children: .combine)
        }
      }
      .padding(.top, 10)
      let points = weights.enumerated().compactMap { index, item in item.kg.map { (index, $0) } }
      if points.count > 1 {
        WeightChart(points: points, days: weights.map(\.day), count: weights.count)
          .frame(height: 92 * min(chartGrowth, 1.8))
          .padding(.top, 18)
      }
    }
    .contentShape(.rect)
  }

  private var bodyFat: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Body fat").label()
      if let percent = body_?.bodyFatPercent {
        Measure(value: Format.decimal(percent), unit: "%", role: .inline).foregroundStyle(Theme.ink)
      } else {
        Button(action: checkIn) { ActionText("Add in a check-in") }
          .buttonStyle(.plain)
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var leanMass: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Lean mass").label()
      if let lean = body_?.leanMassKg {
        Measure(value: Format.decimal(lean), unit: "kg", role: .inline).foregroundStyle(Theme.ink)
      } else {
        Text(body_?.bodyFatPercent == nil ? "Shown once body fat is in" : "Shown once weight is in")
          .folio(.note)
          .foregroundStyle(Theme.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .combine)
  }

  /// "−0.5" with a true minus, "+0.3".
  private func signed(_ kg: Double) -> String {
    let value = Format.decimal(abs(kg))
    return kg < 0 ? "−\(value)" : kg > 0 ? "+\(value)" : value
  }
}

/// The week's weight as a line over a soft ground, with two labelled
/// hairlines and the first and last day named beneath.
private struct WeightChart: View {
  /// Day index and kilograms, for the days with a reading.
  let points: [(Int, Double)]
  let days: [Date?]
  let count: Int

  var body: some View {
    let values = points.map(\.1)
    let low = values.min() ?? 0
    let high = values.max() ?? 1
    let pad = max((high - low) * 0.25, 0.2)
    let domain = (low - pad)...(high + pad)
    let lines = gridlines(domain)
    let ends = [points.first?.0, points.last?.0].compactMap { $0 }
    Chart {
      ForEach(points, id: \.0) { index, kg in
        AreaMark(x: .value("Day", index), yStart: .value("Floor", domain.lowerBound), yEnd: .value("kg", kg))
          .foregroundStyle(Theme.track.opacity(0.55))
          .interpolationMethod(.catmullRom)
        LineMark(x: .value("Day", index), y: .value("kg", kg))
          .foregroundStyle(Theme.body)
          .interpolationMethod(.catmullRom)
          .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
      }
      if let last = points.last {
        PointMark(x: .value("Day", last.0), y: .value("kg", last.1))
          .symbol {
            Circle()
              .strokeBorder(Theme.body, lineWidth: 2)
              .background(Circle().fill(Theme.background))
              .frame(width: 10, height: 10)
          }
      }
    }
    .chartXScale(domain: (points.first?.0 ?? 0)...(points.last?.0 ?? max(count - 1, 1)))
    .chartYScale(domain: domain)
    .chartYAxis {
      AxisMarks(position: .trailing, values: lines) { value in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1)).foregroundStyle(Theme.rule)
        // Clear of the ring on the latest reading at the trailing edge.
        AxisValueLabel(horizontalSpacing: 9) {
          if let kg = value.as(Double.self) {
            Text(kg.formatted(.number.precision(.fractionLength(1)).locale(Format.locale)))
              .font(.caption2.weight(.medium).monospacedDigit())
              .foregroundStyle(Theme.inkSecondary)
          }
        }
      }
    }
    .chartXAxis {
      AxisMarks(values: ends) { value in
        AxisValueLabel(anchor: value.index == 0 ? .topLeading : .topTrailing) {
          if let index = value.as(Int.self), let day = days[safe: index] ?? nil {
            Text(day.formatted(.dateTime.weekday(.abbreviated).day().locale(Format.locale)))
              .font(.caption2.weight(.medium).monospacedDigit())
              .foregroundStyle(Theme.inkSecondary)
          }
        }
      }
    }
    .accessibilityHidden(true)
  }

  /// Two round values inside the range, for the labelled hairlines.
  private func gridlines(_ domain: ClosedRange<Double>) -> [Double] {
    let span = domain.upperBound - domain.lowerBound
    let step = [0.5, 1, 2, 5, 10].first { span / $0 <= 3 } ?? 20
    var lines: [Double] = []
    var value = (domain.lowerBound / step).rounded(.up) * step
    while value < domain.upperBound {
      lines.append(value)
      value += step
    }
    return Array(lines.suffix(2))
  }
}

extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

// MARK: Food and drink

/// Food set like a menu: the total and how it splits, then each meal with
/// its kind in the margin. Then drinks and supplements, one tap to add,
/// with what was logged set as lines like the meals.
struct FoodSection: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dynamicTypeSize) private var typeSize
  let nutrition: Components.Schemas.Nutrition
  let hydration: Components.Schemas.Hydration
  /// Absent from servers older than supplement tracking.
  var supplements: Components.Schemas.Supplements?
  @ScaledMetric(relativeTo: .footnote) private var kindColumn: CGFloat = 72

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      FolioSection(
        "Food & drink",
        meta: nutrition.meals.isEmpty
          ? nil : "\(Format.number(nutrition.meals.count)) \(nutrition.meals.count == 1 ? "meal" : "meals")")
      food.padding(.vertical, 16)
      Hairline()
      drinks.padding(.vertical, 16)
      if let supplements {
        Hairline()
        SupplementsStrip(supplements: supplements).padding(.vertical, 16)
      }
    }
  }

  private var food: some View {
    VStack(alignment: .leading, spacing: 0) {
      NavigationLink(value: Trend.food) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          CardLabel(title: "Food", key: Category.food.tint)
          Spacer(minLength: 8)
          Measure(value: Format.number(nutrition.calories), unit: "kcal", role: .inline).foregroundStyle(Theme.ink)
          GoArrow()
        }
        .contentShape(.rect)
      }
      .buttonStyle(CardButtonStyle())
      MacroSplit(protein: nutrition.protein, carbs: nutrition.carbs, fat: nutrition.fat)
        .padding(.top, 14)
      if nutrition.meals.isEmpty {
        Paragraph("Nothing logged yet. Tell Coach what you ate, or send a photo.", language: .english)
          .folio(.note)
          .foregroundStyle(Theme.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 14)
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(nutrition.meals.enumerated()), id: \.element.id) { index, meal in
            if index > 0 { Hairline() }
            mealRow(meal).padding(.vertical, 10)
          }
        }
        .padding(.top, 12)
      }
    }
  }

  @ViewBuilder
  private func mealRow(_ meal: Components.Schemas.Meal) -> some View {
    let kind = Text(Self.kind(meal._type)).label()
    let dish = Text(LineBreaks.title(meal.name, size: typeSize)).folio(.entry).foregroundStyle(Theme.ink)
      .fixedSize(horizontal: false, vertical: true)
    let energy = Text("\(Format.number(meal.calories)) kcal")
      .font(.subheadline.monospacedDigit())
      .foregroundStyle(Theme.inkSecondary)
    Group {
      if typeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 4) {
          HStack(alignment: .firstTextBaseline) {
            kind
            Spacer(minLength: 8)
            energy
          }
          dish
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          // One line, so a kind is never broken inside the word.
          kind.lineLimit(1).minimumScaleFactor(0.8).frame(width: kindColumn, alignment: .leading)
          dish
          Spacer(minLength: 8)
          energy
        }
      }
    }
    .accessibilityElement(children: .combine)
  }

  /// A meal's kind as the server names it ("breakfast"), in sentence case.
  static func kind(_ type: String) -> String {
    type.prefix(1).uppercased() + type.dropFirst()
  }

  private var drinks: some View {
    VStack(alignment: .leading, spacing: 12) {
      NavigationLink(value: Trend.water) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          CardLabel(title: "Drinks", key: Category.water.tint)
          Spacer(minLength: 8)
          let (value, unit) = Format.litres(hydration.totalMl)
          Measure(value: value, unit: unit, role: .inline).foregroundStyle(Theme.ink)
          GoArrow()
        }
        .contentShape(.rect)
      }
      .buttonStyle(CardButtonStyle())
      FlowLayout {
        ForEach([250, 500], id: \.self) { ml in
          Button {
            Task { await model.logDrink(ml: ml) }
          } label: {
            Chip(title: "\(ml) ml")
          }
          .buttonStyle(CardButtonStyle())
          .accessibilityLabel("Add \(ml) ml of water")
        }
      }
      LoggedLines(items: DrinkLine.lines(hydration.drinks), id: \.id) { line in
        LoggedLine(name: line.name, amount: line.amount)
          .contextMenu {
            // The latest of them, so the line keeps its place.
            Button(line.drinks.count > 1 ? "Delete one" : "Delete", systemImage: "trash", role: .destructive) {
              Task { await model.removeDrink(id: line.latest.id) }
            }
          }
      }
    }
  }
}

/// The day's drinks of one name and size as one line of the ledger, so ten
/// quick glasses read "Water, 10 × 250 ml" rather than ten lines of the
/// same. The lines keep the order of each one's first drink.
struct DrinkLine {
  let name: String
  /// Oldest first, as the day's drinks come.
  let drinks: [Components.Schemas.Drink]

  /// The first drink's, which stays as later ones are deleted.
  var id: String { drinks[0].id }
  var latest: Components.Schemas.Drink { drinks[drinks.count - 1] }
  var amount: String {
    drinks.count > 1 ? "\(drinks.count) × \(drinks[0].ml) ml" : "\(drinks[0].ml) ml"
  }

  static func lines(_ drinks: [Components.Schemas.Drink]) -> [DrinkLine] {
    var lines: [DrinkLine] = []
    for drink in drinks {
      // Unnamed, a drink goes by its kind, in sentence case: "Sparkling water".
      let name = drink.name.isEmpty ? drink.kind.prefix(1).uppercased() + drink.kind.dropFirst() : drink.name
      if let index = lines.firstIndex(where: { $0.name == name && $0.drinks[0].ml == drink.ml }) {
        lines[index] = DrinkLine(name: name, drinks: lines[index].drinks + [drink])
      } else {
        lines.append(DrinkLine(name: name, drinks: [drink]))
      }
    }
    return lines
  }
}

/// What has been logged under drinks or supplements, set as lines of a
/// ledger in the order taken, as the meals are, with a hairline between
/// them. Nothing when there is nothing.
private struct LoggedLines<Item, ID: Hashable, Line: View>: View {
  let items: [Item]
  let id: KeyPath<Item, ID>
  @ViewBuilder let line: (Item) -> Line

  var body: some View {
    if !items.isEmpty {
      let key = (\(offset: Int, element: Item).element).appending(path: id)
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(items.enumerated()), id: key) { index, item in
          if index > 0 { Hairline() }
          line(item)
        }
      }
    }
  }
}

/// One line of the ledger, as the meals above it are set: the name in the
/// serif, which wraps with its last two words together, and the amount, if
/// there is one, aligned on the right. At the largest text sizes the amount
/// goes under the name.
private struct LoggedLine: View {
  let name: String
  let amount: String
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let title = Text(LineBreaks.title(name, size: typeSize)).folio(.entry).foregroundStyle(Theme.ink)
      .fixedSize(horizontal: false, vertical: true)
    let amount = amount.isEmpty
      ? nil : Text(amount).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.inkSecondary)
    Group {
      if typeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 4) {
          title
          amount
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          title
          Spacer(minLength: 8)
          amount?.fixedSize()
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 10)
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }
}

/// Vitamins and supplements: usual ones are one tap, anything else is a name
/// and an optional amount. Long-press a taken one to delete it.
struct SupplementsStrip: View {
  @Environment(AppModel.self) private var model
  let supplements: Components.Schemas.Supplements
  @State private var adding = false
  @State private var name = ""
  @State private var amount = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      // The count moves under the label when both don't fit on one line.
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          CardLabel(title: "Supplements", key: Category.food.tint).fixedSize()
          Spacer()
          count
        }
        VStack(alignment: .leading, spacing: 4) {
          CardLabel(title: "Supplements", key: Category.food.tint)
          count
        }
      }
      FlowLayout {
        ForEach(supplements.usual, id: \.name) { usual in
          Button {
            Task { await model.logSupplement(name: usual.name, amount: usual.amount) }
          } label: {
            Chip(title: label(usual.name, usual.amount))
          }
          .buttonStyle(CardButtonStyle())
        }
        Button {
          name = ""
          amount = ""
          adding = true
        } label: {
          Chip(title: supplements.usual.isEmpty ? "Add supplement" : "Other")
        }
        .buttonStyle(CardButtonStyle())
      }
      LoggedLines(items: supplements.taken, id: \.id) { taken in
        LoggedLine(name: taken.name, amount: taken.amount)
          .contextMenu {
            Button("Delete", systemImage: "trash", role: .destructive) {
              Task { await model.removeSupplement(id: taken.id) }
            }
          }
      }
    }
    .alert("Add supplement", isPresented: $adding) {
      TextField("Name, e.g. Vitamin D", text: $name)
      TextField("Amount (optional), e.g. 1000 IU", text: $amount)
      Button("Cancel", role: .cancel) {}
      Button("Save") {
        let name = name.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        Task { await model.logSupplement(name: String(name.prefix(80)), amount: String(amount.prefix(40))) }
      }
    }
  }

  private var count: some View {
    Text(supplements.taken.isEmpty ? "None yet" : "\(Format.number(supplements.taken.count)) taken")
      .font(.subheadline.monospacedDigit())
      .foregroundStyle(Theme.inkSecondary)
  }

  private func label(_ name: String, _ amount: String) -> String {
    amount.isEmpty ? name : "\(name) \(amount)"
  }
}

// MARK: Movement

/// The workout in progress, today's sessions and activities, and the next
/// session, set as entries with their place in the day in the margin.
struct MovementSection: View {
  @Environment(AppModel.self) private var model
  let today: Today

  var body: some View {
    let done = today.strengthToday.filter { $0.id != today.activeWorkout?.id }
    let next = today.activeWorkout == nil && done.isEmpty ? today.nextSession : nil
    VStack(alignment: .leading, spacing: 0) {
      FolioSection("Movement", meta: "\(Format.number(today.sessionsThisWeek)) this week")
      VStack(alignment: .leading, spacing: 0) {
        if let active = today.activeWorkout {
          Button { model.tab = .train } label: {
            let sets = "\(active.loggedSets) \(active.loggedSets == 1 ? "set" : "sets")"
            let exercises = "\(active.exercises) \(active.exercises == 1 ? "exercise" : "exercises")"
            EntryRow(lead: .word("Now"), title: active.title, meta: "\(sets) across \(exercises)", opens: true)
          }
          .accessibilityHint("Opens Train")
          Hairline()
        }
        ForEach(done, id: \.id) { session in
          NavigationLink {
            SessionView(id: session.id)
          } label: {
            EntryRow(
              lead: .word("Done"), title: session.title,
              meta: "\(session.loggedSets) \(session.loggedSets == 1 ? "set" : "sets")", opens: true)
          }
          Hairline()
        }
        ForEach(today.activities, id: \.id) { activity in
          let row = EntryRow(
            lead: .word("Done"), title: activity.title, meta: Self.details(activity), note: activity.routeText,
            source: activity.fromAppleHealth ? "From Apple Health" : nil, sourceTint: Theme.activity,
            opens: activity.hasRoute == true)
          if activity.hasRoute == true {
            NavigationLink {
              ActivityRouteView(id: activity.id, title: activity.title)
            } label: {
              row
            }
          } else {
            row
          }
          Hairline()
        }
        if let next {
          Button { model.tab = .train } label: {
            EntryRow(
              lead: .word("Next"), title: next.title,
              meta: "\(next.programName) · session \(next.position) of \(next.count)", opens: true)
          }
          .accessibilityHint("Opens Train")
          Hairline()
        }
        // Without a programme, Train is one tap away even after a walk
        // has come in from Apple Health.
        if today.activeWorkout == nil && done.isEmpty && next == nil {
          Button { model.tab = .train } label: {
            VStack(alignment: .leading, spacing: 6) {
              if today.activities.isEmpty {
                Text("Nothing recorded yet.").folio(.note).foregroundStyle(Theme.inkSecondary)
              }
              ActionText("Start a workout")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 14)
            .contentShape(.rect)
          }
        }
      }
      .buttonStyle(CardButtonStyle())
      .padding(.top, 4)
      Paragraph(footnote, language: .english)
        .folio(.note)
        .foregroundStyle(Theme.inkSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 10)
    }
  }

  private var footnote: String {
    let count = today.sessionsThisWeek
    let number = Format.count(count)
    let capital = number.prefix(1).uppercased() + number.dropFirst()
    let sessions = count > 0 ? "\(capital) \(count == 1 ? "session" : "sessions") in the last seven days. " : ""
    return sessions + "Workouts from Apple Health appear here by themselves."
  }

  static func details(_ activity: Components.Schemas.Activity) -> String {
    [
      activity.durationText,
      activity.distanceKm.map { Format.decimal($0, digits: 2) + " km" },
      activity.averageHeartRate.map { "\($0) bpm" },
      activity.caloriesText ?? activity.caloriesKcal.map { "~\(Format.number($0)) kcal" },
    ].compactMap { $0 }.joined(separator: " · ")
  }
}

// MARK: Colophon

/// The foot of the page: the mark and the issue, private to its owner. After
/// 21:00 the halves meet and the day reads as closed. The mark grows with
/// the text and stands on the first line's baseline, as in the wordmark.
private struct Colophon: View {
  let issue: Int?
  let name: String?
  @ScaledMetric(relativeTo: .body) private var side: CGFloat = 20
  @ScaledMetric(relativeTo: .body) private var closedSide: CGFloat = 26

  var body: some View {
    TimelineView(.everyMinute) { context in
      let closed = Calendar.current.component(.hour, from: context.date) >= 21
      VStack(alignment: .leading, spacing: 8) {
        Hairline()
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          BrandMark(gap: closed ? 0 : 40, lift: closed ? 0 : 136)
            .frame(width: closed ? closedSide : side, height: closed ? closedSide : side)
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - $0.height * 0.1 }
          if closed {
            Text("The day, closed").folio(.standfirst).foregroundStyle(Theme.ink)
          } else {
            line
          }
        }
        .padding(.top, 10)
        if closed { line }
      }
      .accessibilityElement(children: .combine)
    }
  }

  /// The wordmark, then "Nº 13 · Private to Maja": beside it, or under it
  /// when the two don't fit one line.
  private var line: some View {
    let parts = [issue.map { "Nº \($0)" }, "Private to \(name ?? "you")"]
    let note = Text(parts.compactMap { $0 }.joined(separator: " · "))
      .font(.caption)
      .foregroundStyle(Theme.inkSecondary)
    return ViewThatFits(in: .horizontal) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Wordmark(mark: false)
        note
      }
      VStack(alignment: .leading, spacing: 2) {
        Wordmark(mark: false)
        note.fixedSize(horizontal: false, vertical: true)
      }
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
        .foregroundStyle(Theme.ink)
      }
      ForEach(model.refused) { item in
        VStack(alignment: .leading, spacing: 6) {
          Label("Not saved", systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.attention)
          Text(item.refusal ?? "").font(.subheadline).foregroundStyle(Theme.ink)
          Button("Dismiss", role: .destructive) { Task { await model.discardRefused(item) } }
            .buttonStyle(SecondaryButtonStyle(height: 36))
        }
      }
    }
    .card()
  }
}

#if DEBUG
  private struct TodayPreview: View {
    @State private var model: AppModel = {
      let model = AppModel()
      model.today = PreviewData.today
      return model
    }()

    var body: some View {
      NavigationStack { TodayView(week: PreviewData.week) }.environment(model)
    }
  }

  #Preview("Today") { TodayPreview() }
  #Preview("Today, dark") { TodayPreview().preferredColorScheme(.dark) }
  #Preview("Today, AX3") { TodayPreview().dynamicTypeSize(.accessibility3) }
#endif
