import Foundation
import LiftAPI
import Testing

@testable import LiftJournal

@Suite("Today")
struct TodayTests {
  @Test("The standfirst lists what was logged, in plain words")
  func logged() {
    #expect(DaySummary(activities: ["running"], meals: 2).text == "A run and two meals so far.")
    #expect(DaySummary(meals: 1).text == "A meal so far.")
    #expect(DaySummary(activities: ["elliptical"]).text == "An elliptical session so far.")
    #expect(DaySummary(meals: 12).text == "12 meals so far.")
    #expect(
      DaySummary(activities: ["running", "walking", "running"], workouts: 1, checkedIn: true).text
        == "Two runs, a walk, a workout and a check-in so far.")
    #expect(DaySummary(activities: ["paddleboarding"]).text == "An activity so far.")
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
}
