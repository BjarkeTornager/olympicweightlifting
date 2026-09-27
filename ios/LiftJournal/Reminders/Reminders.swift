import Foundation
import LiftAPI
import LiftStore
import Observation
import UserNotifications

/// The reminders the athlete chose, kept on this iPhone. All are off until
/// turned on in Profile.
struct ReminderSettings: Codable, Equatable {
  struct Time: Codable, Equatable {
    var on: Bool
    var hour: Int
    var minute: Int
  }

  var checkIn = Time(on: false, hour: 8, minute: 0)
  var water = false
  var catchUp = Time(on: false, hour: 20, minute: 0)
  var windDown = Time(on: false, hour: 22, minute: 30)

  var anyOn: Bool { checkIn.on || water || catchUp.on || windDown.on }

  static let key = "reminders"

  static func load(_ defaults: UserDefaults = .standard) -> Self {
    defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Self.self, from: $0) } ?? Self()
  }

  func save(_ defaults: UserDefaults = .standard) {
    defaults.set(try? JSONEncoder().encode(self), forKey: Self.key)
  }
}

/// What today's reminders need to know about the day, so one already taken
/// care of is skipped and the evening one names what is missing.
struct DaySnapshot: Equatable {
  var date: String
  var checkedIn: Bool
  var meals: Int
  var sleepRecorded: Bool
  /// The title of a workout still in progress.
  var workout: String?
  var waterMl: Int
  var waterTargetMl: Int
}

extension DaySnapshot {
  init(_ today: Today) {
    self.init(
      date: today.date,
      checkedIn: today.checkin?.energy != nil || today.checkin?.soreness != nil,
      meals: today.nutrition.meals.count,
      sleepRecorded: today.sleep.hours != nil,
      workout: today.activeWorkout?.title,
      waterMl: today.hydration.totalMl,
      waterTargetMl: today.hydration.targetMl)
  }
}

struct PlannedReminder: Equatable {
  enum Kind: String, CaseIterable {
    case checkIn = "check-in", water, catchUp = "catch-up", windDown = "wind-down"
  }

  let kind: Kind
  /// Year, month, day, hour and minute on this iPhone's calendar.
  let at: DateComponents
  let title: String
  let body: String

  var id: String {
    String(
      format: "%@%@.%04d-%02d-%02d.%02d%02d", Reminders.prefix, kind.rawValue, at.year ?? 0, at.month ?? 0,
      at.day ?? 0, at.hour ?? 0, at.minute ?? 0)
  }
}

/// The notifications for the coming week. Today's reflect what is already
/// logged; later days can't know yet and use general wording.
enum ReminderPlan {
  static let days = 7
  /// When water reminders come, and the share of the day's target that is on
  /// track by then. One comes only when the athlete is behind.
  static let water: [(hour: Int, share: Double)] = [(11, 0.35), (14, 0.6), (17, 0.8)]

  static func plan(
    _ settings: ReminderSettings, today: DaySnapshot?, now: Date, calendar: Calendar = .current
  ) -> [PlannedReminder] {
    let start = calendar.startOfDay(for: now)
    return (0..<days).flatMap { offset -> [PlannedReminder] in
      guard let day = calendar.date(byAdding: .day, value: offset, to: start) else { return [] }
      let known = offset == 0 && today?.date == JournalDay.string(day, calendar: calendar) ? today : nil
      var planned: [PlannedReminder] = []
      func add(_ kind: PlannedReminder.Kind, _ hour: Int, _ minute: Int, _ title: String, _ body: String) {
        var at = calendar.dateComponents([.year, .month, .day], from: day)
        at.hour = hour
        at.minute = minute
        guard let date = calendar.date(from: at), date > now else { return }
        planned.append(PlannedReminder(kind: kind, at: at, title: title, body: body))
      }

      if settings.checkIn.on, known?.checkedIn != true {
        add(
          .checkIn, settings.checkIn.hour, settings.checkIn.minute, "Good morning",
          "How did you sleep, and how do you feel? A quick check-in helps Coach plan your day.")
      }
      if settings.water {
        for (hour, share) in water {
          if let known {
            guard known.waterTargetMl > 0, Double(known.waterMl) < Double(known.waterTargetMl) * share else {
              continue
            }
            add(
              .water, hour, 0, "Time for some water",
              "You're at \(litres(known.waterMl)) of \(litres(known.waterTargetMl)) today. A glass now keeps you on track."
            )
          } else {
            add(.water, hour, 0, "Time for some water", "A glass now keeps you on track for today's target.")
          }
        }
      }
      if settings.catchUp.on, let body = catchUp(known) {
        add(.catchUp, settings.catchUp.hour, settings.catchUp.minute, "A moment for your journal", body)
      }
      if settings.windDown.on {
        add(
          .windDown, settings.windDown.hour, settings.windDown.minute, "Time to wind down",
          "Start getting ready for bed, to give yourself a full night's sleep.")
      }
      return planned
    }
  }

  /// What the evening reminder says, or nil when nothing is missing.
  static func catchUp(_ day: DaySnapshot?) -> String? {
    guard let day else { return "Anything you'd like to add today? A photo or a sentence to Coach is enough." }
    let missing = [day.meals == 0 ? "today's meals" : nil, day.sleepRecorded ? nil : "last night's sleep"]
      .compactMap { $0 }
    var sentences: [String] = []
    if !missing.isEmpty {
      sentences.append("Not logged yet: \(ListFormatter.localizedString(byJoining: missing)).")
    }
    if let workout = day.workout {
      sentences.append("\(workout) is still open. Finish it in Train.")
    }
    if !missing.isEmpty {
      sentences.append("A photo or a sentence to Coach is enough.")
    }
    return sentences.isEmpty ? nil : sentences.joined(separator: " ")
  }

  private static func litres(_ ml: Int) -> String {
    let (value, unit) = Format.litres(ml)
    return "\(value) \(unit)"
  }
}

/// Schedules the reminders as notifications on this iPhone and carries out
/// their buttons. Rescheduled whenever Today loads, including after Apple
/// Health wakes the app, so a reminder for something already done is dropped.
@MainActor @Observable
final class Reminders: NSObject {
  static let shared = Reminders()
  nonisolated static let prefix = "reminder."

  enum Route { case checkIn, today, coach, voice }

  private(set) var settings = ReminderSettings.load()
  /// Set while the app runs, so a notification's action goes through it.
  @ObservationIgnored weak var model: AppModel?
  /// A notification opened before the app was ready for it.
  @ObservationIgnored private var pendingRoute: Route?

  private enum Action {
    static let logWater = "log-water"
    static let talk = "talk"
  }

  /// Registered at every launch, before launching finishes, so a tap on a
  /// notification that launched the app is delivered.
  func register() {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    let talk = UNNotificationAction(
      identifier: Action.talk, title: "Talk to Coach", options: [.foreground],
      icon: UNNotificationActionIcon(systemImageName: "waveform"))
    let water = UNNotificationAction(
      identifier: Action.logWater, title: "Log 250 ml", options: [.authenticationRequired],
      icon: UNNotificationActionIcon(systemImageName: "drop.fill"))
    center.setNotificationCategories([
      UNNotificationCategory(
        identifier: PlannedReminder.Kind.checkIn.rawValue, actions: [talk], intentIdentifiers: []),
      UNNotificationCategory(identifier: PlannedReminder.Kind.water.rawValue, actions: [water], intentIdentifiers: []),
      UNNotificationCategory(
        identifier: PlannedReminder.Kind.catchUp.rawValue, actions: [talk], intentIdentifiers: []),
    ])
  }

  /// Saves new settings, asks for permission the first time one is turned
  /// on, and reschedules. Returns the notification permission.
  func change(_ new: ReminderSettings, today: Today?) async -> UNAuthorizationStatus {
    settings = new
    new.save()
    let center = UNUserNotificationCenter.current()
    if new.anyOn, await center.notificationSettings().authorizationStatus == .notDetermined {
      _ = try? await center.requestAuthorization(options: [.alert, .sound])
    }
    await update(today: today)
    return await center.notificationSettings().authorizationStatus
  }

  /// Replaces the scheduled reminders with the coming week's plan.
  func update(today: Today?) async {
    let center = UNUserNotificationCenter.current()
    let allowed: Set<UNAuthorizationStatus> = [.authorized, .provisional, .ephemeral]
    var plan: [PlannedReminder] = []
    if settings.anyOn, await Credentials.shared.current() != nil,
      allowed.contains(await center.notificationSettings().authorizationStatus)
    {
      plan = ReminderPlan.plan(settings, today: today.map(DaySnapshot.init), now: .now)
    }
    let keep = Set(plan.map(\.id))
    let pending = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix(Self.prefix) }
    center.removePendingNotificationRequests(
      withIdentifiers: pending.map(\.identifier).filter { !keep.contains($0) })
    // Today reloads after every save: only what changed is scheduled again.
    let scheduled = Dictionary(
      pending.map { ($0.identifier, $0.content.body) }, uniquingKeysWith: { first, _ in first })
    for reminder in plan where scheduled[reminder.id] != reminder.body {
      let content = UNMutableNotificationContent()
      content.title = reminder.title
      content.body = reminder.body
      content.sound = .default
      content.categoryIdentifier = reminder.kind.rawValue
      content.threadIdentifier = "reminders"
      // The same identifier replaces the earlier version, with today's text.
      try? await center.add(
        UNNotificationRequest(
          identifier: reminder.id, content: content,
          trigger: UNCalendarNotificationTrigger(dateMatching: reminder.at, repeats: false)))
    }
  }

  /// Turns every reminder off and removes them, on signing out: whoever signs
  /// in next chooses their own.
  func reset() {
    settings = ReminderSettings()
    UserDefaults.standard.removeObject(forKey: ReminderSettings.key)
    let center = UNUserNotificationCenter.current()
    Task {
      let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
      center.removePendingNotificationRequests(withIdentifiers: ids)
      center.removeAllDeliveredNotifications()
    }
  }

  /// After Apple Health woke the app in the background: today's state from
  /// the server, then the reminders again. Left as they are if it can't load.
  nonisolated static func refresh(client: Client) async {
    guard let today = try? await client.getToday(query: .init(date: JournalDay.string(.now))).value() else { return }
    await shared.update(today: today)
  }

  /// A route from a notification opened while the app was starting.
  func takeRoute() -> Route? {
    defer { pendingRoute = nil }
    return pendingRoute
  }

  private func respond(kind: String, action: String) async {
    switch action {
    case Action.logWater:
      await logWater()
      return
    case Action.talk:
      go(.voice)
      return
    default:
      break
    }
    switch PlannedReminder.Kind(rawValue: kind) {
    case .checkIn: go(.checkIn)
    case .water: go(.today)
    case .catchUp: go(.coach)
    case .windDown, nil: break
    }
  }

  private func go(_ route: Route) {
    if let model, model.phase == .signedIn {
      model.follow(route)
    } else {
      pendingRoute = route
    }
  }

  /// Logs water from the notification. With the app running it goes through
  /// the app; launched in the background, straight into the account's queue.
  private func logWater() async {
    if let model, model.phase == .signedIn {
      await model.logDrink(ml: 250)
      return
    }
    guard let session = await Credentials.shared.current() else { return }
    let client = LiftServer.client(credentials: Credentials.shared)
    _ = await Outbox(account: session.accountID).submit(AppModel.drink(ml: 250), client: client)
    await Self.refresh(client: client)
  }
}

extension Reminders: UNUserNotificationCenterDelegate {
  /// Reminders show while the app is open; the rest alert doesn't, as the
  /// workout screen shows the timer.
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    notification.request.identifier.hasPrefix(Reminders.prefix) ? [.banner, .list, .sound] : []
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let request = response.notification.request
    guard request.identifier.hasPrefix(Reminders.prefix) else { return }
    let kind = request.content.categoryIdentifier
    let action = response.actionIdentifier
    await respond(kind: kind, action: action)
  }
}
