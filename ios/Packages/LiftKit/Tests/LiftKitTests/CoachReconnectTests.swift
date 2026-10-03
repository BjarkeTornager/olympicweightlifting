import Foundation
import Testing

@testable import LiftAPI

/// A Coach reply cut off by a dropped connection is read on from its last
/// event when the server sends events with ids (COACH_TURN_EVENTS), and
/// waited for as before when it doesn't.
@Suite("Reading a Coach reply on")
struct CoachReconnectTests {
  /// Frames as the server writes them with COACH_TURN_EVENTS on: RUN_STARTED
  /// without an id, then each stored event with its id.
  static let started = #"data: {"type":"RUN_STARTED","threadId":"coach","runId":"r"}"#
  static func frame(_ id: Int, _ json: String) -> [String] { ["id: \(id)", "data: \(json)", ""] }
  static func text(_ id: Int, _ delta: String) -> [String] {
    frame(id, #"{"type":"TEXT_MESSAGE_CONTENT","messageId":"m","delta":"\#(delta)"}"#)
  }
  static let finished = #"{"type":"RUN_FINISHED","threadId":"coach","runId":"r","result":{"reply":"Hi"}}"#

  /// Lines that end as the connection does: cleanly, or with `drop`.
  static func lines(_ lines: [String], drop: URLError.Code? = nil) -> AsyncThrowingStream<String, any Error> {
    AsyncThrowingStream { continuation in
      for line in lines { continuation.yield(line) }
      continuation.finish(throwing: drop.map { URLError($0) })
    }
  }

  @Test("The last event's SSE id is kept; one without an id keeps the one before")
  func ids() throws {
    var reader = CoachStream.Reader()
    #expect(try reader.read(Self.started) == nil)
    #expect(reader.lastID == nil)
    for line in Self.frame(1, #"{"type":"STEP_STARTED","stepName":"Reading your journal"}"#) {
      _ = try reader.read(line)
    }
    #expect(reader.lastID == 1)
    // The id comes on the line before its event, and counts once that is read.
    #expect(try reader.read("id: 2") == nil)
    #expect(reader.lastID == 1)
    #expect(try reader.read(#"data: {"type":"TEXT_MESSAGE_START","messageId":"m"}"#) == .step("Writing"))
    #expect(reader.lastID == 2)
    #expect(try reader.read(": keep-alive") == nil)
    #expect(try reader.read(#"data: {"type":"CUSTOM","name":"other","value":{}}"#) == nil)
    #expect(reader.lastID == 2)
  }

  @Test("coach.reset drops the reply so far, and the new attempt's text starts afresh")
  func reset() throws {
    var reader = CoachStream.Reader()
    var events: [CoachEvent] = []
    let lines =
      Self.text(1, "Half an ") + Self.text(2, "answer")
      + [#"data: {"type":"CUSTOM","name":"coach.reset","value":{"attempt":2}}"#]
      + Self.frame(3, #"{"type":"TEXT_MESSAGE_START","messageId":"n"}"#) + Self.text(4, "A whole answer.")
    for line in lines { if let event = try reader.read(line) { events.append(event) } }
    #expect(
      events == [
        .reply("Half an "), .reply("Half an answer"), .reset, .step("Writing"), .reply("A whole answer."),
      ])
    #expect(reader.lastID == 4)
  }

  @Test("A reply read on after a drop carries on where it was, without repeating text")
  func readOn() async throws {
    let progress = CoachStream.Progress()
    var events: [CoachEvent] = []
    // The run's own stream drops after "First part. ".
    let dropped = await #expect(throws: CoachFailure.self) {
      try await CoachStream.read(
        Self.lines([Self.started] + Self.text(1, "First part. "), drop: .networkConnectionLost),
        into: progress
      ) { events.append($0) }
    }
    #expect(dropped?.resumable == true && dropped?.interrupted == true)
    #expect(progress.lastEventID == 1)
    // GET ?turnId=…&after=1 sends the events after it.
    try await CoachStream.read(
      Self.lines(Self.text(2, "Second ") + Self.text(3, "part.") + Self.frame(4, Self.finished)),
      into: progress
    ) { events.append($0) }
    #expect(
      events == [
        .reply("First part. "), .reply("First part. Second "), .reply("First part. Second part."), .finished,
      ])
    #expect(progress.lastEventID == 4)
  }

  @Test("Without ids a drop is the connection's own error, as before")
  func noIDs() async {
    let progress = CoachStream.Progress()
    let lines = [
      Self.started, #"data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m","delta":"Hi"}"#,
    ]
    await #expect(throws: URLError.self) {
      try await CoachStream.read(Self.lines(lines, drop: .networkConnectionLost), into: progress) { _ in }
    }
    #expect(!progress.resumable)
    // A stream the server ended without the run's last event: an
    // interruption, never read on.
    let ended = CoachStream.Progress()
    let failure = await #expect(throws: CoachFailure.self) {
      try await CoachStream.read(Self.lines([Self.started] + Self.text(1, "Hi")), into: ended) { _ in }
    }
    #expect(failure?.interrupted == true && failure?.resumable == false)
  }

  @Test("A quiet connection is ended only when the reply can be read on")
  func quiet() async throws {
    let task = URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:9/")!)
    let progress = CoachStream.Progress()
    progress.connected(task)
    #expect(!progress.dropIfQuiet(for: .seconds(20), now: .now + .seconds(60)))
    _ = try progress.read("id: 1")
    _ = try progress.read(#"data: {"type":"STEP_STARTED","stepName":"Reading your journal"}"#)
    #expect(!progress.dropIfQuiet(for: .seconds(20)))
    #expect(progress.dropIfQuiet(for: .seconds(20), now: .now + .seconds(21)))
    progress.disconnected()
    #expect(!progress.dropIfQuiet(for: .seconds(20), now: .now + .seconds(21)))
  }

  @Test("A drop with ids is read on at once, then after longer waits, ten times before waiting for the saved turn")
  func backoff() {
    var reconnect = CoachReconnect()
    let dropped = CoachFailure(message: "", status: 0, interrupted: true, resumable: true)
    #expect(reconnect.next(after: dropped) == .readOn(after: .zero))
    // The server can't be reached while reading on: tried again.
    #expect(reconnect.next(after: URLError(.cannotConnectToHost)) == .readOn(after: .seconds(1)))
    #expect(reconnect.next(after: URLError(.networkConnectionLost)) == .readOn(after: .seconds(2)))
    #expect(reconnect.next(after: dropped) == .readOn(after: .seconds(4)))
    for _ in 5...10 { #expect(reconnect.next(after: dropped) == .readOn(after: .seconds(8))) }
    #expect(reconnect.next(after: dropped) == .waitForSaved)
    // An event arrived, or the app is back in the foreground: at once again.
    reconnect.restart()
    #expect(reconnect.next(after: dropped) == .readOn(after: .zero))
  }

  @Test("Without ids, after the server ends the stream or refuses to read on, the saved turn tells")
  func waitForSaved() {
    // Switched off: the run's own stream dropped, as before.
    var off = CoachReconnect()
    #expect(off.next(after: URLError(.networkConnectionLost)) == .waitForSaved)
    #expect(off.next(after: URLError(.badServerResponse)) == .fail)
    var on = CoachReconnect()
    _ = on.next(after: CoachFailure(message: "", status: 0, interrupted: true, resumable: true))
    // Ended without RUN_FINISHED: stopped, cut off and swept, or followed
    // for five minutes.
    #expect(on.next(after: CoachFailure(message: "", status: 0, interrupted: true)) == .waitForSaved)
    // Refused: switched off since, or the turn isn't there.
    #expect(on.next(after: CoachFailure(message: "", status: 404, interrupted: true)) == .waitForSaved)
  }

  @Test("The run's own failure stands")
  func failure() {
    var reconnect = CoachReconnect()
    _ = reconnect.next(after: CoachFailure(message: "", status: 0, interrupted: true, resumable: true))
    #expect(reconnect.next(after: CoachFailure(message: "Coach could not finish", status: 500)) == .fail)
    #expect(reconnect.next(after: CoachFailure(message: "Sync first", status: 409)) == .fail)
  }
}
