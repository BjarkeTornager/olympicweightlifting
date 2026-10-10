import Foundation
import LiftAPI
import LiftStore
import Testing

@testable import LiftJournal

@Suite("Today")
struct TodayTests {
  @Test("The standfirst lists what was logged, in plain words")
  func logged() {
    #expect(DaySummary(activities: ["running"], meals: 2).text == "A run and two meals so far.")
    #expect(DaySummary(meals: 1).text == "One meal so far.")
    #expect(DaySummary(activities: ["elliptical"]).text == "One elliptical session so far.")
    #expect(DaySummary(meals: 12).text == "12 meals so far.")
    #expect(
      DaySummary(activities: ["running", "walking", "running"], workouts: 1, checkedIn: true).text
        == "Two runs, a walk, a workout and a check-in so far.")
    #expect(DaySummary(activities: ["paddleboarding"]).text == "One activity so far.")
  }

  @Test("Every count reads naturally: none, one on its own, one in a list, and many")
  func counts() {
    let kinds: [(summary: (Int) -> DaySummary, one: String, many: String)] = [
      ({ DaySummary(activities: Array(repeating: "running", count: $0)) }, "One run so far.", "Three runs so far."),
      ({ DaySummary(activities: Array(repeating: "walking", count: $0)) }, "One walk so far.", "Three walks so far."),
      ({ DaySummary(activities: Array(repeating: "cycling", count: $0)) }, "One ride so far.", "Three rides so far."),
      ({ DaySummary(activities: Array(repeating: "swimming", count: $0)) }, "One swim so far.", "Three swims so far."),
      (
        { DaySummary(activities: Array(repeating: "rowing", count: $0)) }, "One rowing session so far.",
        "Three rowing sessions so far."
      ),
      ({ DaySummary(activities: Array(repeating: "hiking", count: $0)) }, "One hike so far.", "Three hikes so far."),
      (
        { DaySummary(activities: Array(repeating: "elliptical", count: $0)) }, "One elliptical session so far.",
        "Three elliptical sessions so far."
      ),
      (
        { DaySummary(activities: Array(repeating: "paddleboarding", count: $0)) }, "One activity so far.",
        "Three activities so far."
      ),
      ({ DaySummary(workouts: $0) }, "One workout so far.", "Three workouts so far."),
      ({ DaySummary(meals: $0) }, "One meal so far.", "Three meals so far."),
    ]
    for (summary, one, many) in kinds {
      // Nothing logged and no sleep to compare: no standfirst at all.
      #expect(summary(0).text == nil)
      #expect(summary(1).text == one)
      #expect(summary(3).text == many)
    }
    #expect(DaySummary(checkedIn: true).text == "One check-in so far.")
    // In a list, one of a kind takes "a" or "an".
    #expect(
      DaySummary(activities: ["elliptical"], meals: 1, checkedIn: true).text
        == "An elliptical session, a meal and a check-in so far.")
    #expect(DaySummary(workouts: 1, meals: 12).text == "A workout and 12 meals so far.")
    #expect(
      DaySummary(meals: 1, sleepHours: 7.25, sleepAverage: 7.2).text
        == "One meal so far. Sleep was close to your weekly average.")
  }

  @Test("Sleep is compared with the athlete's own week, to about 15 minutes: within them reads as close")
  func sleep() {
    #expect(DaySummary(sleepHours: 7.25, sleepAverage: 7.2).text == "Sleep was close to your weekly average.")
    #expect(DaySummary(sleepHours: 7.45, sleepAverage: 7.2).text == "Sleep was close to your weekly average.")
    // 21 minutes rounds to 15.
    #expect(DaySummary(sleepHours: 7.55, sleepAverage: 7.2).text == "Sleep was close to your weekly average.")
    #expect(
      DaySummary(sleepHours: 7.6, sleepAverage: 7.2).text == "Sleep was about 30 min longer than your weekly average.")
    #expect(
      DaySummary(sleepHours: 7.9, sleepAverage: 7.2).text == "Sleep was about 45 min longer than your weekly average.")
    #expect(
      DaySummary(meals: 2, sleepHours: 6.2, sleepAverage: 7.2).text
        == "Two meals so far. Sleep was about 1 h shorter than your weekly average.")
    #expect(
      DaySummary(sleepHours: 5.9, sleepAverage: 7.2).text
        == "Sleep was about 1 h 15 min shorter than your weekly average.")
    // Without a week to compare with, sleep is not mentioned.
    #expect(DaySummary(sleepHours: 7.5, sleepAverage: nil).text == nil)
  }

  @Test("Coach's note on short sleep, once hidden, stays away for a week")
  func sleepNote() {
    let saved = SleepNote.hide("sleep-short", today: "2026-10-04")
    #expect(saved == "sleep-short 2026-10-04")
    #expect(SleepNote.hidden("sleep-short", saved: saved, today: "2026-10-04"))
    #expect(SleepNote.hidden("sleep-short", saved: saved, today: "2026-10-10"))
    #expect(!SleepNote.hidden("sleep-short", saved: saved, today: "2026-10-11"))
    // Not before it was hidden, not another note, and not from nothing.
    #expect(!SleepNote.hidden("sleep-short", saved: saved, today: "2026-10-03"))
    #expect(!SleepNote.hidden("sleep-other", saved: saved, today: "2026-10-05"))
    #expect(!SleepNote.hidden("sleep-short", saved: "", today: "2026-10-05"))
  }

  @Test("It fits two lines: the minutes go first, then the sleep sentence")
  func length() {
    let long = DaySummary(activities: ["running"], meals: 1, checkedIn: true, sleepHours: 7.5, sleepAverage: 7)
    #expect(long.text == "A run, a meal and a check-in so far. Sleep was longer than your weekly average.")
    let longer = DaySummary(
      activities: ["running", "walking", "cycling", "swimming"], workouts: 2, meals: 3, checkedIn: true,
      sleepHours: 7.5, sleepAverage: 6)
    #expect(longer.text == "A run, a walk, a ride, a swim, two workouts, three meals and a check-in so far.")
  }

  @Test("It never speaks of targets, gaps or deficits, and says nothing when nothing is logged")
  func tone() {
    #expect(DaySummary().text == nil)
    let days = [
      DaySummary(meals: 1, sleepHours: 4, sleepAverage: 8),
      DaySummary(activities: ["walking"], sleepHours: 9, sleepAverage: 7),
      DaySummary(workouts: 1, checkedIn: true, sleepHours: 7, sleepAverage: 7.1),
      DaySummary(sleepHours: 5.5, sleepAverage: 7.5),
    ]
    for text in days.compactMap(\.text) {
      for word in ["target", "goal", "deficit", "behind", "missing", "only", "should", "Coach", "yet"] {
        #expect(!text.localizedCaseInsensitiveContains(word), "\(text)")
      }
    }
  }

  @Test("From Today's record: a workout in progress counts once, and a check-in needs a feeling")
  func fromToday() throws {
    var today = try #require(PreviewData.today)
    today.activities = [
      .init(
        id: "a", activity: "running", title: "Morning Run", date: today.date, durationSeconds: 2040,
        durationText: "34 min", fromAppleHealth: true)
    ]
    today.strengthToday = [.init(id: "w", title: "Snatch", date: today.date, exercises: 3, loggedSets: 6)]
    today.activeWorkout = .init(id: "w", title: "Snatch", date: today.date, exercises: 3, loggedSets: 6)
    today.checkin = .init(bodyweight: 70.4, notes: "")
    let summary = DaySummary(today: today, sleepAverage: nil)
    #expect(summary.workouts == 1)
    #expect(!summary.checkedIn)
    #expect(summary.meals == today.nutrition.meals.count)
  }

  @Test("Burned shows each figure on its own line with its source, and an older server's one figure as an estimate")
  func burned() throws {
    let json = #"""
      {"kcal": 610, "source": "apple-health", "estimated": true, "note": "Active energy from Apple Health, so far",
       "lines": [
         {"label": "Active energy", "kcal": 610, "text": "~610", "note": "Apple Health, so far"},
         {"label": "Training", "kcal": 530, "text": "~530", "note": "Estimated"}],
       "context": "Doesn't include the energy your body uses at rest."}
      """#
    let burned = try JSONDecoder().decode(Components.Schemas.Burned.self, from: Data(json.utf8))
    #expect(
      TodayView.burned(burned) == [
        .init(label: "Active energy", text: "~610", note: "Apple Health, so far"),
        .init(label: "Training", text: "~530", note: "Estimated"),
      ])
    let older = try JSONDecoder().decode(
      Components.Schemas.Burned.self,
      from: Data(#"{"kcal": 540, "source": "apple-health", "estimated": false, "note": "Active energy from Apple Health"}"#.utf8))
    #expect(TodayView.burned(older) == [.init(label: "Burned", text: "~540", note: "Active energy from Apple Health")])
    #expect(TodayView.burned(nil).isEmpty)
  }

  @Test("The steps cell says Yesterday when it shows yesterday's, and marks active energy as an estimate, flagged when unusually high")
  func stepsNote() throws {
    var today = try #require(PreviewData.today)
    today.vitals = .init(date: today.date, steps: 9120, activeEnergyKcal: 612)
    #expect(TodayView.stepsNote(today) == "~610 kcal active")
    today.vitals = .init(date: "2026-09-25", steps: 11200, activeEnergyKcal: 704)
    #expect(TodayView.stepsNote(today) == "Yesterday · ~700 kcal active")
    today.vitals = .init(date: today.date, steps: 9120, activeEnergyKcal: 10000, activeEnergyUnusual: true)
    #expect(TodayView.stepsNote(today) == "~10,000 kcal active, unusually high")
    today.vitals = .init(date: "2026-09-25", steps: 11200)
    #expect(TodayView.stepsNote(today) == "Yesterday")
    today.vitals = nil
    #expect(TodayView.stepsNote(today) == nil)
  }

  @Test("Today's colophon and Profile name the athlete from one source: the display name, else the account's")
  func athleteName() throws {
    let model = AppModel()
    model.session = .init(token: "t", accountID: "a", name: "Maja Jensen", email: "maja@example.test")
    #expect(model.athleteName == "Maja Jensen")
    var today = try #require(PreviewData.today)
    today.name = "Maja"
    model.today = today
    #expect(model.athleteName == "Maja")
    // A display name cleared on the website falls back to the account's.
    today.name = "  "
    model.today = today
    #expect(model.athleteName == "Maja Jensen")
  }

  @Test("Drinks of one name and size share a line, in the order first drunk, and unnamed ones go by their kind")
  func drinkLines() {
    func drink(_ id: String, _ ml: Int, _ kind: String = "water", _ name: String = "") -> Components.Schemas.Drink {
      .init(id: id, ml: ml, kind: kind, name: name, at: "2026-10-03T0\(id):00:00Z")
    }
    let lines = DrinkLine.lines([
      drink("1", 250), drink("2", 200, "sparkling water"), drink("3", 250), drink("4", 500),
      drink("5", 250, "tea", "Green tea"), drink("6", 250),
    ])
    #expect(lines.map(\.name) == ["Water", "Sparkling water", "Water", "Green tea"])
    #expect(lines.map(\.amount) == ["3 × 250 ml", "200 ml", "500 ml", "250 ml"])
    // The line stays put as its latest glass is deleted.
    #expect(lines[0].id == "1")
    #expect(lines[0].latest.id == "6")
    #expect(DrinkLine.lines([]).isEmpty)
    // A usual size Coach saved without a volume is "about", on its own line.
    var glass = drink("7", 250)
    glass.estimated = true
    let mixed = DrinkLine.lines([drink("1", 250), glass, glass])
    #expect(mixed.map(\.amount) == ["250 ml", "2 × about 250 ml"])
  }

  @Test("Each day of the journal is an issue, and weeks are ISO weeks")
  func issue() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let first = try #require(calendar.date(from: DateComponents(year: 2026, month: 9, day: 20, hour: 22)))
    let day = try #require(calendar.date(from: DateComponents(year: 2026, month: 10, day: 2, hour: 7)))
    #expect(Issue.number(first: first, day: day, calendar: calendar) == 13)
    #expect(Issue.number(first: first, day: first, calendar: calendar) == 1)
    #expect(Issue.number(first: day, day: first, calendar: calendar) == 1)
    #expect(Issue.week(day) == 40)
    // 2026 has 53 ISO weeks, so New Year's Day 2027 is still in its last.
    let newYear = try #require(calendar.date(from: DateComponents(year: 2027, month: 1, day: 1, hour: 12)))
    #expect(Issue.week(newYear) == 53)
  }

  @Test("The issue number counts from the day the journal began, or this iPhone's first day from an older server")
  func issueStart() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let installed = try #require(calendar.date(from: DateComponents(year: 2026, month: 10, day: 1, hour: 9)))
    let day = try #require(calendar.date(from: DateComponents(year: 2026, month: 10, day: 3, hour: 7)))
    // A new install doesn't start the count again: the journal began earlier.
    let first = try #require(Issue.first(journal: "2026-09-20", device: installed, calendar: calendar))
    #expect(Issue.number(first: first, day: day, calendar: calendar) == 14)
    // A server from before the field, or one that can't read it.
    #expect(Issue.first(journal: nil, device: installed, calendar: calendar) == installed)
    #expect(Issue.first(journal: "soon", device: installed, calendar: calendar) == installed)
    #expect(Issue.first(journal: nil, device: nil) == nil)
    // From Today's response.
    var today = try #require(PreviewData.today)
    today.journalStartDate = "2026-09-20"
    #expect(Issue.first(journal: today.journalStartDate, device: installed, calendar: calendar) == first)
  }

  @Test("The Journal's register fills a mark when something in that area was logged that day")
  func register() {
    let day = Components.Schemas.TrendDay(
      date: "2026-10-02", sleepHours: 7.2, sleepFromAppleHealth: true, waterMl: 0, calories: 420, cardioMinutes: 0,
      strengthSessions: 1)
    let logged = WeekRegister.Area.allCases.filter { $0.logged(day, checkins: []) }
    #expect(logged == [.sleep, .food, .movement])
    #expect(WeekRegister.Area.feeling.logged(day, checkins: ["2026-10-02"]))
    let empty = Components.Schemas.TrendDay(
      date: "2026-10-01", sleepFromAppleHealth: false, cardioMinutes: 0, strengthSessions: 0)
    #expect(WeekRegister.Area.allCases.allSatisfy { !$0.logged(empty, checkins: ["2026-10-02"]) })
  }

  @Test("Numbers are written the same way on every iPhone, as the server writes them")
  func numbers() {
    #expect(Format.number(1900) == "1,900")
    #expect(Format.number(1899.6) == "1,900")
    #expect(Format.decimal(70.4) == "70.4")
    #expect(Format.decimal(70) == "70")
    // An amount drunk to one decimal, a target in quarter litres to two.
    #expect(Format.litres(2420) == ("2.4", "L"))
    #expect(Format.litres(2450, digits: 2) == ("2.45", "L"))
    // A whole quarter litre drunk reads as the target does when it is
    // reached: 2.25 L, not 2.2 next to "about 2.25 L".
    #expect(Format.litres(2250) == ("2.25", "L"))
    #expect(Format.litres(3250) == ("3.25", "L"))
    #expect(Format.litres(2240) == ("2.2", "L"))
    #expect(Format.litres(2500) == ("2.5", "L"))
    #expect(Format.litres(2000) == ("2", "L"))
    #expect(Format.litres(500) == ("500", "ml"))
    #expect(Format.count(2) == "two")
    #expect(Format.count(12) == "12")
  }

  @Test("Account marks the drinks targets as estimated while no weight is known, and says so")
  func drinksTargets() {
    func water(estimated: Bool, hidden: Bool? = nil, rest: Int? = 2000, lifting: Int? = 2750)
      -> Components.Schemas.Hydration
    {
      .init(
        totalMl: 0, targetMl: hidden == true ? 0 : 2000, estimatedTarget: estimated, drinks: [],
        targetHidden: hidden, restDayTargetMl: rest, liftingDayTargetMl: lifting)
    }
    #expect(DrinksTargets.line(water(estimated: true)) == "2 L rest · 2.75 L lifting, estimated")
    #expect(DrinksTargets.basis(water(estimated: true)) == "a general estimate until your weight is known")
    #expect(DrinksTargets.line(water(estimated: false)) == "2 L rest · 2.75 L lifting")
    #expect(DrinksTargets.basis(water(estimated: false)) == "an estimate from your weight and the day's training")
    #expect(DrinksTargets.line(water(estimated: true, rest: nil, lifting: nil)) == "2 L a day, estimated")
    #expect(DrinksTargets.line(water(estimated: true, hidden: true)) == "Hidden on Today")
  }

  @Test("Energy says where the day stands in the server's words, and from an older server only past the target")
  func energyStatus() {
    let remaining = Components.Schemas.NutrientProgress(
      target: "about 1,900 kcal", status: "About 450 kcal remaining")
    #expect(TodayView.energyStatus(remaining, value: 1450, target: 1900) == "About 450 kcal remaining")
    // Over a target below the estimated minimum, nothing is said.
    #expect(TodayView.energyStatus(.init(target: "about 1,300 kcal"), value: 1500, target: 1300) == nil)
    #expect(TodayView.energyStatus(nil, value: 2150, target: 1900) == "250 above target")
    #expect(TodayView.energyStatus(nil, value: 1800, target: 1900) == nil)
  }

  @Test("Glasses count to the nearest 250 ml, and the target is at least one")
  func glasses() {
    #expect(TodayView.glassesScale(totalMl: 740, targetMl: 2250) == "3 of 9 glasses")
    #expect(TodayView.glassesScale(totalMl: 1120, targetMl: 2850) == "4 of 11 glasses")
    #expect(TodayView.glassesScale(totalMl: 100, targetMl: 0) == "0 of 1 glasses")
  }

  @Test("Carbs and fat read as ranges with where the day stands, and not at all from an older server")
  func ranges() throws {
    var food = try #require(PreviewData.today).nutrition
    #expect(FoodSection.ranges(food).isEmpty)
    food.carbsProgress = .init(target: "about 240 to 295 g", status: "In range")
    food.fatProgress = .init(target: "about 55 to 80 g")
    #expect(FoodSection.ranges(food) == ["Carbs about 240 to 295 g · In range", "Fat about 55 to 80 g"])
    #expect(FoodSection.sentence("about 2,400 kcal") == "About 2,400 kcal")
  }

  @Test("Averages leave out today until it is over, and food until it is marked complete")
  func trendAverages() {
    let today = "2026-10-10"
    func day(_ date: String, kcal: Double, water: Int, steps: Int) -> Components.Schemas.TrendDay {
      .init(
        date: date, sleepFromAppleHealth: false, steps: steps, waterMl: water, calories: kcal, cardioMinutes: 0,
        strengthSessions: 0)
    }
    var days = [
      day("2026-10-08", kcal: 2000, water: 2000, steps: 8000),
      day("2026-10-09", kcal: 1800, water: 1800, steps: 10000),
      day(today, kcal: 400, water: 250, steps: 900),
    ]
    let average = { (trend: Trend, value: (Components.Schemas.TrendDay) -> Double?) in
      TrendView.average(TrendView.counted(days, trend: trend, today: today), value)
    }
    #expect(average(.food, \.calories) == 1900)
    #expect(average(.water) { $0.waterMl.map(Double.init) } == 1900)
    #expect(average(.activity) { $0.steps.map(Double.init) } == 9000)
    // Last night's sleep and resting heart rate are whole by morning.
    #expect(TrendView.counted(days, trend: .sleep, today: today).count == 3)
    // Marked complete, today's food counts.
    days[2].foodComplete = true
    #expect(average(.food, \.calories) == 1400)
    #expect(average(.water) { $0.waterMl.map(Double.init) } == 1900)
  }

  @Test("A target of 0 is no target: no Account row, no line in Trends, no meter on Today")
  func zeroTarget() {
    #expect(Format.target(1900) == 1900)
    #expect(Format.target(0) == nil)
    #expect(Format.target(-5) == nil)
    #expect(Format.target(nil) == nil)
  }
}
