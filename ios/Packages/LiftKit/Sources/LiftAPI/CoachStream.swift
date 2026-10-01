import Foundation

/// What the app shows while Coach works on a message.
public enum CoachEvent: Sendable, Equatable {
  /// A short description of the current step, such as "Reading your journal".
  case step(String)
  /// The reply so far.
  case reply(String)
  /// A chart, table or other visual Coach just made, shown before the reply
  /// is finished.
  case visual(Components.Schemas.CoachVisual)
  /// The turn is complete and saved on the server.
  case finished
}

public struct CoachFailure: LocalizedError, Sendable {
  public let message: String
  public let status: Int
  /// The connection ended before the reply, as when the app is suspended:
  /// Coach may still be working, and the saved turn tells.
  public var interrupted = false
  public var errorDescription: String? { message }

  public init(message: String, status: Int, interrupted: Bool = false) {
    self.message = message
    self.status = status
    self.interrupted = interrupted
  }

  /// Whether an error means the connection was lost rather than Coach or
  /// the server refusing: the turn may still finish on the server.
  public static func isInterruption(_ error: any Error) -> Bool {
    if let failure = error as? CoachFailure { return failure.interrupted }
    guard let url = error as? URLError else { return false }
    return [
      .networkConnectionLost, .notConnectedToInternet, .timedOut, .cannotConnectToHost,
      .dataNotAllowed, .internationalRoamingOff, .callIsActive, .backgroundSessionWasDisconnected,
    ].contains(url.code)
  }
}

/// Runs one Coach turn over the AG-UI event stream at `/api/agent/run`. The
/// server owns history, tools and the journal; the app sends only the new
/// message. The durable result (reply and saves) is read afterwards from
/// `/api/v1/coach`, so an interrupted stream loses nothing: the server keeps
/// working when the app is suspended mid-reply (X-Coach-Background), and
/// Stop cancels it with `cancel(id:)`.
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

  /// Stops a run on the server; it would otherwise carry on in the
  /// background. Best effort: the run may already have finished.
  public func cancel(id: UUID) async {
    var request = URLRequest(url: LiftServer.origin.appending(path: "api/agent/run/cancel"))
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    LiftHeaders.apply(to: &request, token: token, account: account)
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id.uuidString.lowercased()])
    _ = try? await LiftServer.session().data(for: request)
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
    // Carry on if the connection closes; only cancel(id:) stops the run.
    request.setValue("1", forHTTPHeaderField: "X-Coach-Background")
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
      case "CUSTOM":
        if let visual = Self.visual(fromCustom: payload) { emit(.visual(visual)) }
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
        status: 0, interrupted: true)
    }
  }
}

extension CoachStream {
  /// A `coach.visual` event's visual, in the shape `/api/v1/coach` returns:
  /// the server sends `{id, content}`, and the app's type has the content's
  /// fields beside the id. Nil for other events, or a visual this build
  /// can't read.
  static func visual(fromCustom payload: String) -> Components.Schemas.CoachVisual? {
    guard let event = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any],
      event["name"] as? String == "coach.visual",
      let value = event["value"] as? [String: Any],
      let id = value["id"] as? String,
      var flat = value["content"] as? [String: Any]
    else { return nil }
    flat["id"] = id
    guard let data = try? JSONSerialization.data(withJSONObject: flat) else { return nil }
    return try? JSONDecoder().decode(Components.Schemas.CoachVisual.self, from: data)
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
