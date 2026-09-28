import Foundation
import Testing

@testable import LiftJournal

@Suite("Reminders")
struct ReminderTests {
  let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
    return calendar
  }()

  var all: ReminderSettings {
    var settings = ReminderSettings()
    settings.checkIn.on = true
    settings.water = true
    settings.catchUp.on = true
    settings.windDown.on = true
    return settings
  }

  func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
    calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
  }

  func day(
    checkedIn: Bool = false, meals: Int = 0, sleep: Bool = false, workout: String? = nil, water: Int = 0
  ) -> DaySnapshot {
    DaySnapshot(
      date: "2026-09-28", checkedIn: checkedIn, meals: meals, sleepRecorded: sleep, workout: workout,
      waterMl: water, waterTargetMl: 3000)
  }

  func today(_ plan: [PlannedReminder]) -> [PlannedReminder] {
    plan.filter { $0.at.day == 28 }
  }

  @Test("Nothing is scheduled until a reminder is turned on")
  func off() {
    #expect(ReminderPlan.plan(ReminderSettings(), today: nil, now: at(28, 7), calendar: calendar).isEmpty)
  }

  @Test("A week ahead, each at its time, none in the past, all with their own identifier")
  func week() {
    let plan = ReminderPlan.plan(all, today: nil, now: at(28, 7), calendar: calendar)
    #expect(plan.count == 7 * 6)
    #expect(Set(plan.map(\.id)).count == plan.count)
    #expect(plan.count < 64, "iOS keeps at most 64 pending notifications")
    #expect(today(plan).map { "\($0.kind.rawValue) \($0.at.hour!):\($0.at.minute!)" } == [
      "check-in 8:0", "water 11:0", "water 14:0", "water 17:0", "catch-up 20:0", "wind-down 22:30",
    ])
    let later = ReminderPlan.plan(all, today: nil, now: at(28, 12), calendar: calendar)
    #expect(today(later).map(\.kind) == [.water, .water, .catchUp, .windDown])
  }

  @Test("Today's reminders are skipped once taken care of")
  func skipped() {
    let done = day(checkedIn: true, meals: 3, sleep: true, water: 2500)
    let plan = today(ReminderPlan.plan(all, today: done, now: at(28, 7), calendar: calendar))
    #expect(plan.map(\.kind) == [.windDown])
    // Later days can't know yet and are all there.
    #expect(ReminderPlan.plan(all, today: done, now: at(28, 7), calendar: calendar).count == 1 + 6 * 6)
  }

  @Test("Water comes only when behind the day's pace, and says where you are")
  func water() {
    let plan = today(ReminderPlan.plan(all, today: day(water: 2000), now: at(28, 7), calendar: calendar))
    let water = plan.filter { $0.kind == .water }
    #expect(water.map(\.at.hour) == [17], "2 L is on track at 11 and 14, not at 17")
    #expect(water.first?.body.contains("of 3 L") == true)
  }

  @Test("The evening reminder names what is missing")
  func catchUp() {
    #expect(ReminderPlan.catchUp(day(meals: 2, sleep: true)) == nil)
    let meals = ReminderPlan.catchUp(day(sleep: true))
    #expect(meals?.hasPrefix("Not logged yet: today's meals.") == true)
    let both = ReminderPlan.catchUp(day())
    #expect(both?.contains("today's meals and last night's sleep") == true)
    let workout = ReminderPlan.catchUp(day(meals: 1, sleep: true, workout: "Snatch + Back Squat"))
    #expect(workout == "Snatch + Back Squat is still open. Finish it in Train.")
    #expect(ReminderPlan.catchUp(nil)?.contains("Anything you'd like to add") == true)
  }

  @Test("Yesterday's snapshot doesn't settle today's reminders")
  func staleSnapshot() {
    var yesterday = day(checkedIn: true, meals: 3, sleep: true, water: 3000)
    yesterday.date = "2026-09-27"
    let plan = today(ReminderPlan.plan(all, today: yesterday, now: at(28, 7), calendar: calendar))
    #expect(plan.count == 6)
  }

  @Test("A tapped reminder's completion handler runs on the main thread, once, wherever it's called from")
  func completionOnMainThread() async {
    let calls = await withCheckedContinuation { (continuation: CheckedContinuation<[Bool], Never>) in
      let log = CallLog()
      let done = MainThreadCompletion {
        log.append(Thread.isMainThread)
        continuation.resume(returning: log.values)
      }
      // As the compiler's bridge did: from a background thread, twice.
      DispatchQueue.global().async {
        log.append(Thread.isMainThread)
        done.call()
        done.call()
      }
    }
    // Called from a background thread; the handler ran on the main one.
    #expect(calls == [false, true])
  }

  @Test("Settings survive a relaunch")
  func settings() throws {
    let defaults = try #require(UserDefaults(suiteName: "reminder-tests"))
    defer { defaults.removePersistentDomain(forName: "reminder-tests") }
    var settings = all
    settings.catchUp.hour = 21
    settings.save(defaults)
    #expect(ReminderSettings.load(defaults) == settings)
  }
}

private final class CallLog: @unchecked Sendable {
  private let lock = NSLock()
  private var calls: [Bool] = []
  func append(_ value: Bool) {
    lock.lock()
    calls.append(value)
    lock.unlock()
  }
  var values: [Bool] {
    lock.lock()
    defer { lock.unlock() }
    return calls
  }
}
