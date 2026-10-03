import Foundation

/// Whether a Coach reply cut off by a dropped connection is read on, and
/// when. Only a reply whose events carried SSE ids can be (the server's
/// COACH_TURN_EVENTS switch is on): it's read on at once, then after waits
/// that double up to 8 seconds, until ten tries in a row have brought
/// nothing. Without ids, or once the tries run out, the app waits for the
/// saved turn, as it always has.
public struct CoachReconnect: Sendable {
  public enum Next: Sendable, Equatable {
    /// Read on from the last event read, after this long.
    case readOn(after: Duration)
    /// Wait for the saved turn instead.
    case waitForSaved
    /// Not a dropped connection: the failure stands.
    case fail
  }

  static let waits: [Duration] = [.zero, .seconds(1), .seconds(2), .seconds(4), .seconds(8)]
  static let tries = 10

  /// Tries in a row since an event last arrived.
  public private(set) var failed = 0
  /// Reading on has begun: a connection that can't be made is tried again.
  private var readingOn = false

  public init() {}

  /// What to do after a stream, the run's own or one reading on, ended
  /// with `error`.
  public mutating func next(after error: any Error) -> Next {
    let failure = error as? CoachFailure
    let dropped =
      failure?.resumable == true
      || (readingOn && (failure?.connection != nil || Retry.urlError(error) != nil))
    if dropped {
      guard failed < Self.tries else { return .waitForSaved }
      readingOn = true
      failed += 1
      return .readOn(after: Self.waits[min(failed, Self.waits.count) - 1])
    }
    // The server ended the stream without the run's last event, or refused
    // to read on, or the events carried no ids: the saved turn tells.
    if CoachFailure.isInterruption(error) { return .waitForSaved }
    return .fail
  }

  /// An event arrived, or the app came back to the foreground: the next
  /// try goes at once, with all ten to come.
  public mutating func restart() {
    failed = 0
  }
}
