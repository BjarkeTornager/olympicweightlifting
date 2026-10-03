import Foundation
import Synchronization

/// What the app shows while Coach works on a message.
public enum CoachEvent: Sendable, Equatable {
  /// A short description of the current step, such as "Reading your journal".
  case step(String)
  /// The reply so far.
  case reply(String)
  /// A chart, table or other visual Coach just made, shown before the reply
  /// is finished.
  case visual(Components.Schemas.CoachVisual)
  /// A crash cut the reply short and the server is writing it again from
  /// the start (coach.reset): what was shown of it goes.
  case reset
  /// The turn is complete and saved on the server.
  case finished
}

public struct CoachFailure: LocalizedError, Sendable {
  public let message: String
  public let status: Int
  /// The connection ended before the reply, as when the app is suspended:
  /// Coach may still be working, and the saved turn tells.
  public var interrupted = false
  /// The connection error that kept the request from leaving the phone (no
  /// connection, or the server couldn't be found): nothing reached Coach,
  /// so sending it again is safe.
  public var connection: URLError.Code?
  /// How long the server asked the app to wait before trying again (429).
  public var retryAfter: Double?
  /// The connection dropped mid-reply after events that carried SSE ids
  /// (the server's COACH_TURN_EVENTS switch is on): `resume` reads the rest
  /// on from the last one.
  public var resumable = false
  public var errorDescription: String? { message }

  public init(
    message: String, status: Int, interrupted: Bool = false, connection: URLError.Code? = nil,
    retryAfter: Double? = nil, resumable: Bool = false
  ) {
    self.message = message
    self.status = status
    self.interrupted = interrupted
    self.connection = connection
    self.retryAfter = retryAfter
    self.resumable = resumable
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

  /// Connection errors that mean a request never reached the server. Lost
  /// connections and timeouts aren't among them: the server may have it.
  public static let unreachableCodes: Set<URLError.Code> = [
    .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .dataNotAllowed,
    .internationalRoamingOff, .callIsActive,
  ]

  /// Whether an error means the request never reached the server, for a
  /// Coach run or any other request (such as a photo upload).
  public static func isUnreachable(_ error: any Error) -> Bool {
    guard let code = connectionCode(error) else { return false }
    return unreachableCodes.contains(code)
  }

  /// Whether the phone itself has no connection, rather than the server
  /// being out of reach.
  public static func isOffline(_ error: any Error) -> Bool {
    guard let code = connectionCode(error) else { return false }
    return [.notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff, .callIsActive].contains(code)
  }

  private static func connectionCode(_ error: any Error) -> URLError.Code? {
    if let failure = error as? CoachFailure { return failure.connection }
    return Retry.urlError(error)?.code
  }
}

/// Runs one Coach turn over the AG-UI event stream at `/api/agent/run`. The
/// server owns history, tools and the journal; the app sends only the new
/// message. The durable result (reply and saves) is read afterwards from
/// `/api/v1/coach`, so an interrupted stream loses nothing: the server keeps
/// working when the app is suspended mid-reply (X-Coach-Background), and
/// Stop cancels it with `cancel(id:)`. With the server's COACH_TURN_EVENTS
/// switch on, each event comes with an SSE id, and `resume` reads a reply
/// cut off by a dropped connection on from the last one.
public struct CoachStream: Sendable {
  public let token: String
  public let account: String

  public init(token: String, account: String) {
    self.token = token
    self.account = account
  }

  static let cutOff = "The connection ended before Coach finished. Refresh to see what was saved."

  /// `language` ("en" or "da") is the one chosen in Profile; Coach writes
  /// every reply in it.
  /// `submittedAt` is when the athlete sent it, so a message that waited in
  /// the app's queue keeps the day and time it was meant for.
  /// `progress` keeps what has been read, for `resume`.
  public func run(
    id: UUID, message: String, revision: Int, photoIDs: [UUID], language: String? = nil,
    submittedAt: Date = .now, progress: Progress = Progress()
  ) -> AsyncThrowingStream<CoachEvent, any Error> {
    events { emit in
      try await stream(
        id: id, message: message, revision: revision, photoIDs: photoIDs, language: language,
        submittedAt: submittedAt, progress: progress, emit: emit)
    }
  }

  /// Reads a reply on after its connection dropped, from the last event
  /// `progress` read: GET /api/agent/run?turnId=<id>&after=<last id> sends
  /// the events after it, then the rest as they come. Only for a run whose
  /// events carried ids (`progress.resumable`). It never starts or retries
  /// the run. A refusal (switched off since, or no such turn yet) is an
  /// interruption: the saved turn tells.
  public func resume(id: UUID, progress: Progress) -> AsyncThrowingStream<CoachEvent, any Error> {
    events { emit in
      let url = LiftServer.origin.appending(path: "api/agent/run").appending(queryItems: [
        URLQueryItem(name: "turnId", value: id.uuidString.lowercased()),
        URLQueryItem(name: "after", value: String(progress.lastEventID ?? 0)),
      ])
      var request = URLRequest(url: url)
      // The server sends a keep-alive every 10 seconds: a connection quiet
      // for longer than this has dropped.
      request.timeoutInterval = 30
      request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
      LiftHeaders.apply(to: &request, token: token, account: account)
      let (bytes, response) = try await LiftServer.session().bytes(for: request)
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard status == 200 else {
        bytes.task.cancel()
        throw CoachFailure(message: Self.cutOff, status: status, interrupted: true)
      }
      progress.connected(bytes.task)
      try await Self.read(bytes.lines, into: progress, emit: emit)
    }
  }

  private func events(
    _ body: @escaping @Sendable (_ emit: (CoachEvent) -> Void) async throws -> Void
  ) -> AsyncThrowingStream<CoachEvent, any Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          try await body { continuation.yield($0) }
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
    id: UUID, message: String, revision: Int, photoIDs: [UUID], language: String?,
    submittedAt: Date, progress: Progress, emit: (CoachEvent) -> Void
  ) async throws {
    let runID = id.uuidString.lowercased()
    var body: [String: Any] = [
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
        // To the millisecond: two messages queued in the same second keep
        // their order in the thread.
        "submittedAt": Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(submittedAt),
      ],
    ]
    if let language, var props = body["forwardedProps"] as? [String: Any] {
      props["language"] = language
      body["forwardedProps"] = props
    }
    var request = URLRequest(url: LiftServer.origin.appending(path: "api/agent/run"))
    request.httpMethod = "POST"
    request.timeoutInterval = 180
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    // Carry on if the connection closes; only cancel(id:) stops the run.
    request.setValue("1", forHTTPHeaderField: "X-Coach-Background")
    LiftHeaders.apply(to: &request, token: token, account: account)
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let bytes: URLSession.AsyncBytes
    let response: URLResponse
    do {
      (bytes, response) = try await LiftServer.session().bytes(for: request)
    } catch let url as URLError where CoachFailure.unreachableCodes.contains(url.code) {
      // Nothing reached the server: an ordinary failure, not a dropped reply.
      throw CoachFailure(
        message: "Coach couldn't be reached. Your message is kept.", status: 0, connection: url.code)
    }
    let http = response as? HTTPURLResponse
    let status = http?.statusCode ?? 0
    guard status == 200 else {
      var data = Data()
      for try await byte in bytes.prefix(20_000) { data.append(byte) }
      let error = (try? JSONDecoder().decode(ErrorMessage.self, from: data))?.error
      throw CoachFailure(
        message: error ?? "Coach could not connect. Your message is kept.", status: status,
        retryAfter: http?.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init))
    }
    progress.connected(bytes.task)
    try await Self.read(bytes.lines, into: progress, emit: emit)
  }

  /// Reads the event stream into `progress` line by line until it ends. A
  /// connection that drops after events with ids throws a resumable
  /// failure; without ids, the connection's own error, as it always has.
  static func read<Lines: AsyncSequence>(
    _ lines: Lines, into progress: Progress, emit: (CoachEvent) -> Void
  ) async throws where Lines.Element == String {
    defer { progress.disconnected() }
    do {
      for try await line in lines {
        try Task.checkCancellation()
        if let event = try progress.read(line) { emit(event) }
      }
    } catch is URLError where progress.resumable && !Task.isCancelled {
      throw CoachFailure(message: cutOff, status: 0, interrupted: true, resumable: true)
    }
    try progress.end()
  }

  /// What a run's stream has read, kept as it reads, so a reply cut off by
  /// a dropped connection is read on from where it was (`resume`). The app
  /// holds it too, to end a connection that has gone quiet.
  public final class Progress: Sendable {
    private struct State {
      var reader = Reader()
      /// When the connection last brought anything, keep-alives included.
      var heard = ContinuousClock.now
      var connection: URLSessionTask?
    }
    private let state = Mutex(State())

    public init() {}

    /// Whether the events carried SSE ids (the server's COACH_TURN_EVENTS
    /// switch is on): only then can the reply be read on.
    public var resumable: Bool { lastEventID != nil }
    /// The SSE id of the last event read.
    public var lastEventID: Int? { state.withLock { $0.reader.lastID } }

    /// Ends the connection when nothing has come for `quiet`, not even the
    /// keep-alive the server sends every 10 seconds, as may happen while
    /// the app is suspended: it reads as dropped, and the reply is read on.
    /// Only with ids, so a reply is never cut off without a way to read on.
    /// True when it ended one.
    @discardableResult
    public func dropIfQuiet(for quiet: Duration, now: ContinuousClock.Instant = .now) -> Bool {
      let connection = state.withLock { current -> URLSessionTask? in
        guard current.reader.lastID != nil, now - current.heard > quiet else { return nil }
        return current.connection
      }
      connection?.cancel()
      return connection != nil
    }

    func connected(_ connection: URLSessionTask) {
      state.withLock {
        $0.connection = connection
        $0.heard = .now
      }
    }

    func disconnected() {
      state.withLock { $0.connection = nil }
    }

    func read(_ line: String) throws -> CoachEvent? {
      try state.withLock {
        $0.heard = .now
        return try $0.reader.read(line)
      }
    }

    func end() throws {
      try state.withLock { try $0.reader.end() }
    }
  }

  /// Reads the AG-UI event stream line by line.
  struct Reader: Sendable {
    private var reply = ""
    private var finished = false
    /// The SSE id of the last event read; nil while the server sends none
    /// (COACH_TURN_EVENTS off).
    private(set) var lastID: Int?
    /// The id of the event being read: its `id:` line comes first.
    private var nextID: Int?

    /// The event a `data:` line carries, if the app shows it. Throws the
    /// run's failure, with the server's status code, on RUN_ERROR.
    mutating func read(_ line: String) throws -> CoachEvent? {
      if line.hasPrefix("id:") {
        nextID = Int(line.dropFirst(3).trimmingCharacters(in: .whitespaces))
        return nil
      }
      guard line.hasPrefix("data:") else { return nil }
      // An event without an id (RUN_STARTED, coach.reset) keeps the last.
      if let id = nextID {
        lastID = id
        nextID = nil
      }
      let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
      guard payload.utf8.count < 2_000_000,
        let event = try? JSONDecoder().decode(AGUIEvent.self, from: Data(payload.utf8))
      else { return nil }
      switch event.type {
      case "STEP_STARTED":
        return event.stepName.map(CoachEvent.step)
      case "TEXT_MESSAGE_START":
        reply = ""
        return .step("Writing")
      case "TEXT_MESSAGE_CONTENT":
        reply += event.delta ?? ""
        return .reply(reply)
      case "CUSTOM":
        if event.name == "coach.reset" {
          reply = ""
          return .reset
        }
        return CoachStream.visual(fromCustom: payload).map(CoachEvent.visual)
      case "RUN_ERROR":
        // `code` is the HTTP status the server would have answered with,
        // such as "409" when the journal changed or "429" for too many.
        throw CoachFailure(
          message: event.message ?? "Coach could not finish. Your message is kept.",
          status: event.code.flatMap { Int($0) } ?? 0)
      case "RUN_FINISHED":
        finished = true
        return .finished
      default:
        return nil
      }
    }

    /// Throws if the stream ended before the run finished.
    func end() throws {
      if !finished {
        throw CoachFailure(message: CoachStream.cutOff, status: 0, interrupted: true)
      }
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
  let name: String?
  let stepName: String?
  let delta: String?
  let message: String?
  let code: String?
}

private struct ErrorMessage: Decodable {
  let error: String
}
