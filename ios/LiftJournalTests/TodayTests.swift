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

  @Test("Sleep is compared with the athlete's own week: within 15 minutes reads as close")
  func sleep() {
    #expect(DaySummary(sleepHours: 7.25, sleepAverage: 7.2).text == "Sleep was close to your weekly average.")
    #expect(DaySummary(sleepHours: 7.45, sleepAverage: 7.2).text == "Sleep was close to your weekly average.")
    #expect(
      DaySummary(sleepHours: 7.9, sleepAverage: 7.2).text == "Sleep was 42 min longer than your weekly average.")
    #expect(
      DaySummary(meals: 2, sleepHours: 6.2, sleepAverage: 7.2).text
        == "Two meals so far. Sleep was 1 h shorter than your weekly average.")
    // Without a week to compare with, sleep is not mentioned.
    #expect(DaySummary(sleepHours: 7.5, sleepAverage: nil).text == nil)
  }

  @Test("It fits two lines: the minutes go first, then the sleep sentence")
  func length() {
    let long = DaySummary(activities: ["running"], meals: 1, checkedIn: true, sleepHours: 7.5, sleepAverage: 7.18)
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
    #expect(Format.litres(2450) == ("2.45", "L"))
    #expect(Format.litres(500) == ("500", "ml"))
    #expect(Format.count(2) == "two")
    #expect(Format.count(12) == "12")
  }

  @Test("A target of 0 is no target: no Account row, no line in Trends, no meter on Today")
  func zeroTarget() {
    #expect(Format.target(1900) == 1900)
    #expect(Format.target(0) == nil)
    #expect(Format.target(-5) == nil)
    #expect(Format.target(nil) == nil)
  }
}
