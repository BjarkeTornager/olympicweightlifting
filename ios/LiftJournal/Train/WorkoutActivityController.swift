import ActivityKit
import Foundation
import LiftAPI
import LiftActivity
import UserNotifications

/// Keeps the workout Live Activity (lock screen and Dynamic Island) and the
/// "rest over" notification in step with Train. The system draws the
/// countdown, so nothing needs to run while the phone is locked.
enum WorkoutActivityController {
  static let restAlertID = "rest-over"

  /// Changes are applied in order, one at a time, so a quick log-then-finish
  /// can't leave a stale activity behind.
  private static var queue: Task<Void, Never>?

  static func sync(_ workout: WorkoutDetail?, restStarted: Date?, restEnds: Date?) {
    guard let workout else {
      end()
      return
    }
    let attributes = WorkoutActivityAttributes(workoutID: workout.id, title: workout.title)
    let state = contentState(workout, restStarted: restStarted, restEnds: restEnds)
    enqueue { await show(attributes, state) }
  }

  /// The rest still running on the lock screen for this workout, so a
  /// relaunched app picks it up rather than clearing it.
  static func rest(for workoutID: String) -> (started: Date?, ends: Date)? {
    let activity = Activity<WorkoutActivityAttributes>.activities.first {
      $0.attributes.workoutID == workoutID && $0.activityState == .active
    }
    guard let state = activity?.content.state, let ends = state.restEnds, ends > .now else { return nil }
    return (state.restStarted, ends)
  }

  /// The workout is finished, discarded or gone: take it off the lock screen.
  static func end() {
    cancelRestAlert()
    enqueue { await endAll(except: nil) }
  }

  private static func enqueue(_ work: @escaping @Sendable () async -> Void) {
    let previous = queue
    queue = Task {
      await previous?.value
      await work()
    }
  }

  private nonisolated static func show(
    _ attributes: WorkoutActivityAttributes, _ state: WorkoutActivityAttributes.ContentState
  ) async {
    // Once rest is over the activity goes stale and shows "Rest over".
    let content = ActivityContent(state: state, staleDate: state.restEnds)
    let current = Activity<WorkoutActivityAttributes>.activities.first {
      $0.attributes.workoutID == attributes.workoutID && $0.activityState == .active
    }
    await endAll(except: current?.id)
    if let current {
      await current.update(content)
    } else if ActivityAuthorizationInfo().areActivitiesEnabled {
      _ = try? Activity.request(attributes: attributes, content: content)
    }
  }

  private nonisolated static func endAll(except id: String?) async {
    for activity in Activity<WorkoutActivityAttributes>.activities where activity.id != id {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  static func contentState(_ workout: WorkoutDetail, restStarted: Date?, restEnds: Date?)
    -> WorkoutActivityAttributes.ContentState
  {
    let sets = workout.exercises.flatMap(\.sets)
    let logged = sets.filter(\.logged).count
    var exercise = workout.exercises.last?.name ?? workout.title
    var next = "All planned sets logged"
    if let current = workout.exercises.first(where: { $0.sets.contains { !$0.logged } }),
      let index = current.sets.firstIndex(where: { !$0.logged })
    {
      let set = current.sets[index]
      let weight = set.weight.map { Format.decimal($0) + " kg" }
      let reps = set.reps.map { $0 == 1 ? "1 rep" : "\($0) reps" }
      let target = switch (weight, set.reps) {
      case let (weight?, count?): "\(weight) × \(count)"
      case let (weight?, nil): weight
      case (nil, _): reps ?? "Choose load"
      }
      exercise = current.name
      next = "Set \(index + 1) of \(current.sets.count) · \(target)"
    }
    return .init(
      exercise: exercise, next: next, loggedSets: logged, totalSets: sets.count, restEnds: restEnds,
      restStarted: restStarted)
  }

  // MARK: Rest over

  /// A notification when rest ends, for when the phone is in a pocket. Asks
  /// for permission the first time a rest starts.
  static func scheduleRestAlert(at date: Date, for workout: WorkoutDetail) {
    let state = contentState(workout, restStarted: nil, restEnds: date)
    let next = "\(state.exercise): \(state.next)"
    Task {
      let center = UNUserNotificationCenter.current()
      center.removePendingNotificationRequests(withIdentifiers: [restAlertID])
      if await center.notificationSettings().authorizationStatus == .notDetermined {
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
      }
      let content = UNMutableNotificationContent()
      content.title = "Rest over"
      content.body = next
      content.sound = .default
      let trigger = UNTimeIntervalNotificationTrigger(
        timeInterval: max(1, date.timeIntervalSinceNow), repeats: false)
      try? await center.add(UNNotificationRequest(identifier: restAlertID, content: content, trigger: trigger))
    }
  }

  static func cancelRestAlert() {
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [restAlertID])
  }
}
