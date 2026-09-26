import Foundation

/// What the app shows while Coach works on a message.
public enum CoachEvent: Sendable, Equatable {
  /// A short description of the current step, such as "Reading your journal".
  case step(String)
  /// The reply so far.
  case reply(String)
  /// The turn is complete and saved on the server.
  case finished
}

public struct CoachFailure: LocalizedError, Sendable {
  public let message: String
  public let status: Int
  public var errorDescription: String? { message }
}

/// Runs one Coach turn over the AG-UI event stream at `/api/agent/run`. The
/// server owns history, tools and the journal; the app sends only the new
/// message. The durable result (reply and saves) is read afterwards from
/// `/api/v1/coach`, so an interrupted stream loses nothing.
public struct CoachStream: Sendable {
  public let token: String
  public let account: String

  public init(token: String, account: String) {
    self.token = token
    self.account = account
  }

  public func run(
    id: UUID, message: String, revision: Int, photoIDs: [UUID]
  ) -> AsyncThrowingStream<CoachEvent, any Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          try await stream(id: id, message: message, revision: revision, photoIDs: photoIDs) {
            continuation.yield($0)
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  private func stream(
    id: UUID, message: String, revision: Int, photoIDs: [UUID],
    emit: (CoachEvent) -> Void
  ) async throws {
    let runID = id.uuidString.lowercased()
    let body: [String: Any] = [
      "threadId": "coach",
      "runId": runID,
      "messages": [["id": runID, "role": "user", "content": message]],
      "state": [String: Any](),
      "tools": [Any](),
      "context": [Any](),
      "forwardedProps": [
        "revision": revision,
        "timezone": TimeZone.current.identifier,
        "photoIds": photoIDs.map { $0.uuidString.lowercased() },
        "submittedAt": ISO8601DateFormatter().string(from: .now),
      ],
    ]
    var request = URLRequest(url: LiftServer.origin.appending(path: "api/agent/run"))
    request.httpMethod = "POST"
    request.timeoutInterval = 180
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    LiftHeaders.apply(to: &request, token: token, account: account)
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (bytes, response) = try await LiftServer.session().bytes(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else {
      var data = Data()
      for try await byte in bytes.prefix(20_000) { data.append(byte) }
      let error = (try? JSONDecoder().decode(ErrorMessage.self, from: data))?.error
      throw CoachFailure(
        message: error ?? "Coach could not connect. Your message is kept.", status: status)
    }
    var reply = ""
    var finished = false
    for try await line in bytes.lines {
      try Task.checkCancellation()
      guard line.hasPrefix("data:") else { continue }
      let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
      guard payload.utf8.count < 2_000_000,
        let event = try? JSONDecoder().decode(AGUIEvent.self, from: Data(payload.utf8))
      else { continue }
      switch event.type {
      case "STEP_STARTED":
        if let step = event.stepName { emit(.step(step)) }
      case "TEXT_MESSAGE_START":
        reply = ""
        emit(.step("Writing"))
      case "TEXT_MESSAGE_CONTENT":
        reply += event.delta ?? ""
        emit(.reply(reply))
      case "RUN_ERROR":
        throw CoachFailure(
          message: event.message ?? "Coach could not finish. Your message is kept.", status: 0)
      case "RUN_FINISHED":
        finished = true
        emit(.finished)
      default:
        continue
      }
    }
    if !finished {
      throw CoachFailure(
        message: "The connection ended before Coach finished. Refresh to see what was saved.",
        status: 0)
    }
  }
}

private struct AGUIEvent: Decodable {
  let type: String
  let stepName: String?
  let delta: String?
  let message: String?
}

private struct ErrorMessage: Decodable {
  let error: String
}
