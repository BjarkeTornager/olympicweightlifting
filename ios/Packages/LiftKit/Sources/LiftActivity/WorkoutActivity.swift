import ActivityKit
import Foundation

/// The workout in progress, shown on the lock screen and in the Dynamic
/// Island: what is next, how far along the session is, and the rest timer.
/// The countdown is drawn by the system from `restEnds`, so it keeps running
/// with the app in the background and needs no updates while it ticks.
public struct WorkoutActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    /// The exercise with the next set to do, or the last one when all are done.
    public var exercise: String
    /// The next set, such as "Set 3 of 5 · 70 kg × 2".
    public var next: String
    public var loggedSets: Int
    public var totalSets: Int
    /// When the rest in progress ends; nil when not resting.
    public var restEnds: Date?
    /// When the rest began, for the progress bar.
    public var restStarted: Date?

    public init(
      exercise: String, next: String, loggedSets: Int, totalSets: Int, restEnds: Date? = nil,
      restStarted: Date? = nil
    ) {
      self.exercise = exercise
      self.next = next
      self.loggedSets = loggedSets
      self.totalSets = totalSets
      self.restEnds = restEnds
      self.restStarted = restStarted
    }

    /// Resting right now, as of `date`.
    public func resting(at date: Date = .now) -> Bool {
      restEnds.map { $0 > date } ?? false
    }
  }

  /// Which journal workout this is, so a different one starts a new activity.
  public var workoutID: String
  public var title: String

  public init(workoutID: String, title: String) {
    self.workoutID = workoutID
    self.title = title
  }
}
