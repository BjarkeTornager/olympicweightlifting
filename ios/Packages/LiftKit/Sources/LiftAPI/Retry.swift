import Foundation
import OpenAPIRuntime

/// Mobile connections drop: a handover between masts or a weak signal cuts
/// an upload off halfway ("The network connection was lost").
public enum Retry {
  /// The URL error behind a failure, unwrapping the generated client's
  /// ClientError, or nil when the failure wasn't the connection.
  public static func urlError(_ error: any Error) -> URLError? {
    if let url = error as? URLError { return url }
    if let client = error as? ClientError { return urlError(client.underlyingError) }
    return nil
  }

  /// A connection that dropped or stalled, which is worth trying again.
  public static func isDroppedConnection(_ error: any Error) -> Bool {
    guard let code = urlError(error)?.code else { return false }
    return [.networkConnectionLost, .timedOut, .cannotConnectToHost, .notConnectedToInternet].contains(code)
  }

  /// Runs the request again after a dropped connection, up to `attempts`
  /// times in all, waiting a little longer each time. Only for requests the
  /// server treats as idempotent, such as an upload with a fixed ID.
  public static func droppedConnections<T: Sendable>(
    attempts: Int = 3,
    wait: Duration = .milliseconds(800),
    _ operation: @Sendable () async throws -> T
  ) async throws -> T {
    var attempt = 1
    while true {
      do {
        return try await operation()
      } catch where attempt < attempts && isDroppedConnection(error) {
        try await Task.sleep(for: wait * attempt)
        attempt += 1
      }
    }
  }
}
