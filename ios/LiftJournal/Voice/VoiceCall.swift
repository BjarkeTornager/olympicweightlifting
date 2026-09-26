import AVFAudio
import Foundation
import LiftAPI
import LiftStore
import LiftVoice
import Observation
import UIKit
import os

/// One spoken conversation with Coach, the same check-in as the website's.
/// Audio goes straight between this iPhone and Google's Live API with a
/// single-use token from the server; every save and read goes through the
/// server's voice actions, so both apps behave alike. The call survives
/// Google's connection limits, network drops and a locked screen.
@Observable
final class VoiceCall {
  enum Status: Equatable { case idle, connecting, listening, speaking, reconnecting, ended, failed }

  struct Line: Identifiable, Equatable {
    enum Role { case you, coach, save }
    enum SaveState { case saving, saved, failed }
    let id: String
    var role: Role
    var text: String
    var state: SaveState?
  }

  private(set) var status: Status = .idle
  private(set) var error: String?
  private(set) var lines: [Line] = []
  private(set) var level: Float = 0
  var muted = false {
    didSet { audio.muted = muted }
  }
  /// The coach asked to see a meal; the camera sheet is shown.
  var cameraRequested = false

  var inCall: Bool { [.connecting, .listening, .speaking, .reconnecting].contains(status) }
  var saved: Int { lines.filter { $0.state == .saved }.count }

  private let app: AppModel
  private let id = UUID()
  private let audio = VoiceAudio()
  private var gate = BargeInGate()
  private var socket: URLSessionWebSocketTask?
  private var handle: String?
  private var started = false
  private var reconnecting = false
  private var closed = false
  private var pending = 0
  private var lineClosed = true
  private var turnText = ""
  private var photos: [String] = []
  private var tasks: [Task<Void, Never>] = []
  private var ending: Task<Void, Never>?
  private var nudge: Task<Void, Never>?
  private var persistTask: Task<Void, Never>?
  private let log = Logger(subsystem: "com.bjarketornager.liftjournal", category: "voice")

  static let maxMinutes = 30
  /// After the coach's goodbye, how long the athlete has to keep talking.
  static let endingGrace: Duration = .seconds(12)
  static let clientVersion = "3"
  private static let saveLabels = [
    "log_training": "Training", "update_training": "Workout corrected", "log_meal": "Meal",
    "update_meal": "Meal updated", "delete_meal": "Meal deleted", "log_sleep": "Sleep",
    "log_drink": "Drink", "delete_drink": "Drink removed", "log_activity": "Activity",
    "clear_unfinished_workout": "Unfinished workout", "set_goals": "Goals", "undo_save": "Undo",
  ]
  /// Server tools that only read; they leave no receipt in the conversation.
  private static let readTools: Set<String> = ["read_journal", "list_photos", "recall_conversations"]

  init(app: AppModel) {
    self.app = app
  }

  // MARK: Start and stop

  func start() async {
    guard status == .idle || status == .ended || status == .failed else { return }
    closed = false
    error = nil
    lines = []
    status = .connecting
    guard await AVAudioApplication.requestRecordPermission() else {
      stop(failure: "Microphone access is off. Turn it on in Settings › Lift Journal, then try again.")
      return
    }
    audio.onChunk = { [weak self] chunk in
      Task { @MainActor in self?.microphone(chunk) }
    }
    audio.onSpeaking = { [weak self] speaking in
      Task { @MainActor in
        guard let self, !self.closed, !self.reconnecting, self.started else { return }
        self.status = speaking ? .speaking : .listening
      }
    }
    audio.onFailure = { [weak self] message in
      Task { @MainActor in self?.stop(failure: message) }
    }
    do {
      try audio.start()
      try await connect(resume: false)
      meter()
      tasks.append(
        Task { [weak self] in
          try? await Task.sleep(for: .seconds((Self.maxMinutes - 2) * 60))
          self?.send(
            LiveProtocol.text(
              "(Two minutes left in this call: finish the current topic, then say goodbye and call end_check_in.)"
            ))
          try? await Task.sleep(for: .seconds(120))
          await self?.endWhenIdle(limit: .seconds(90))
        })
    } catch {
      stop(failure: failureMessage(error))
    }
  }

  func stop(failure: String? = nil) {
    guard !closed else { return }
    closed = true
    persist()
    tasks.forEach { $0.cancel() }
    tasks = []
    ending?.cancel()
    nudge?.cancel()
    socket?.cancel(with: .normalClosure, reason: nil)
    socket = nil
    audio.stop()
    level = 0
    connected(.failure(CancellationError()))
    error = failure
    status = failure == nil ? .ended : .failed
    Task { await app.loadToday() }
  }

  // MARK: Connection

  private func connect(resume: Bool) async throws {
    guard let session = app.session else { throw VoiceError("Sign in again to talk to Coach.") }
    var body: [String: Any] = ["timezone": TimeZone.current.identifier, "purpose": "checkin"]
    if resume, let handle { body["resumeHandle"] = handle }
    let response = try await RawRequest.send(
      "api/voice/session", body: body, token: session.token, account: session.accountID,
      headers: ["X-Voice-Client": Self.clientVersion], timeout: 15)
    if response.status == 426 { app.updateRequired = true }
    if response.status == 401 {
      _ = await app.handle(APIFailure(status: 401, message: "Sign in again."))
    }
    guard response.status == 200, let json = response.json,
      let raw = json["url"] as? String, let url = URL(string: raw), let setup = json["setup"]
    else { throw VoiceError(response.error ?? "Voice could not start.") }
    guard !closed else { return }

    let previous = socket
    let task = URLSession.shared.webSocketTask(with: url)
    task.maximumMessageSize = 16 * 1024 * 1024
    socket = task
    task.resume()
    try await task.send(.string(Self.encode(["setup": setup])))
    listen(on: task, previous: previous)
    // Wait for Google's setupComplete, or give up after 20 seconds.
    let timeout = Task { [weak self] in
      try? await Task.sleep(for: .seconds(20))
      guard !Task.isCancelled else { return }
      self?.connected(.failure(VoiceError("The voice connection timed out.")))
    }
    defer { timeout.cancel() }
    try await withCheckedThrowingContinuation { waiting = $0 }
  }

  private var waiting: CheckedContinuation<Void, any Error>?

  private func connected(_ result: Result<Void, any Error>) {
    waiting?.resume(with: result)
    waiting = nil
  }

  /// Reads the socket for the life of this connection.
  private func listen(on task: URLSessionWebSocketTask, previous: URLSessionWebSocketTask?) {
    tasks.append(
      Task { [weak self] in
        while true {
          let message: URLSessionWebSocketTask.Message
          do {
            message = try await task.receive()
          } catch {
            guard let self, !self.closed, self.socket === task else { return }
            let reason = task.closeReason.flatMap { String(data: $0, encoding: .utf8) }
            self.report("socket_closed", ["code": task.closeCode.rawValue, "reason": String((reason ?? "").prefix(200))])
            if self.waiting != nil {
              self.connected(.failure(VoiceError(reason ?? "The voice connection closed.")))
            } else {
              await self.recover()
            }
            return
          }
          guard let self, !self.closed else { return }
          let data: Data
          switch message {
          case .string(let text): data = Data(text.utf8)
          case .data(let bytes): data = bytes
          @unknown default: continue
          }
          for event in LiveProtocol.events(data) {
            if case .ready = event {
              self.ready(task: task, previous: previous)
              self.connected(.success(()))
            } else {
              self.handle(event)
            }
          }
        }
      })
  }

  private func ready(task: URLSessionWebSocketTask, previous: URLSessionWebSocketTask?) {
    if let previous, previous !== task { previous.cancel(with: .normalClosure, reason: nil) }
    status = audio.coachSpeaking ? .speaking : .listening
    if !started {
      started = true
      // Let the coach speak first.
      send(LiveProtocol.text("(The athlete started the call.)"))
      UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
  }

  /// Reconnects with Google's resumption handle; the conversation carries on.
  private func recover() async {
    guard !closed, !reconnecting else { return }
    reconnecting = true
    status = .reconnecting
    defer { reconnecting = false }
    // Retries for about 40 seconds: long enough to ride out a server release.
    for wait in [1, 2, 4, 8, 12, 15] {
      do {
        let resumed = handle != nil
        try await connect(resume: true)
        if !resumed {
          // Without a handle the conversation starts fresh; give the coach
          // the last few lines to carry on from.
          let recent = lines.filter { $0.role != .save }.suffix(8)
            .map { "\($0.role == .you ? "Athlete" : "Coach"): \($0.text)" }.joined(separator: "\n")
          send(LiveProtocol.text("(The call reconnected. Continue where you left off; the last lines were:\n\(recent))"))
        }
        report("reconnected", ["resumed": resumed ? 1 : 0])
        return
      } catch {
        if closed { return }
        if LiveProtocol.isCreditError(error.localizedDescription) {
          stop(failure: LiveProtocol.creditMessage)
          return
        }
        try? await Task.sleep(for: .seconds(wait))
      }
    }
    report("reconnect_failed")
    stop(failure: "The call dropped. Anything already saved is in Coach.")
  }

  private func send(_ message: [String: Any]) {
    guard let socket, !closed, let text = try? Self.encode(message) else { return }
    socket.send(.string(text)) { _ in }
  }

  private static func encode(_ object: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
  }

  // MARK: Audio

  private func microphone(_ chunk: [Int16]) {
    guard started, !closed, !reconnecting else { return }
    for pcm in gate.pass(chunk, coachSpeaking: audio.coachSpeaking, coachLevel: audio.coachLevel) {
      send(LiveProtocol.audio(pcm))
    }
  }

  /// Drives the on-screen voice from the coach's and the athlete's levels.
  private func meter() {
    tasks.append(
      Task { [weak self] in
        while let self, !self.closed {
          let target = max(self.audio.coachLevel * 4, self.audio.micLevel * 6)
          self.level = min(1, self.level * 0.7 + target * 0.3)
          try? await Task.sleep(for: .milliseconds(50))
        }
      })
  }

  // MARK: Live events

  private func handle(_ event: LiveEvent) {
    switch event {
    case .ready:
      break
    case .resumeHandle(let value):
      handle = value
    case .audio(let pcm):
      audio.play(pcm)
    case .interrupted:
      audio.interrupt()
      lineClosed = true
    case .heard(let text):
      append(.you, text)
      lineClosed = true
      nudge?.cancel()
      // Still talking after the coach's goodbye: the call goes on.
      ending?.cancel()
      ending = nil
    case .said(let text):
      let fresh = lineClosed
      lineClosed = false
      turnText = (fresh ? "" : turnText) + text
      append(.coach, text, fresh: fresh)
    case .turnComplete:
      lineClosed = true
      nudge?.cancel()
      if LiveProtocol.promisesAction(turnText) {
        nudge = Task { [weak self] in
          try? await Task.sleep(for: .milliseconds(2500))
          guard let self, !Task.isCancelled, self.pending == 0 else { return }
          self.send(LiveProtocol.text(LiveProtocol.waitingNudge))
        }
      }
    case .toolCall(let calls):
      nudge?.cancel()
      for call in calls { Task { await run(call) } }
    case .cancelled:
      break
    case .goAway:
      report("go_away")
      Task { await recover() }
    }
  }

  private func append(_ role: Line.Role, _ text: String, fresh: Bool = false) {
    if let last = lines.last, last.role == role, !fresh {
      lines[lines.count - 1].text += text
    } else {
      lines.append(Line(id: UUID().uuidString, role: role, text: text.trimmingCharacters(in: .whitespaces)))
    }
    schedulePersist()
  }

  // MARK: Tools

  private func run(_ call: FunctionCall) async {
    if call.name == "end_check_in" {
      respond(call, ["result": "The call ends in a few seconds unless the athlete keeps talking; if they do, carry on."])
      // A premature goodbye must not cut the athlete off.
      ending?.cancel()
      ending = Task { [weak self] in
        try? await Task.sleep(for: Self.endingGrace)
        guard !Task.isCancelled else { return }
        await self?.endWhenIdle(limit: .seconds(30))
      }
      return
    }
    pending += 1
    defer { pending -= 1 }
    switch call.name {
    case "open_camera":
      cameraRequested = true
      respond(call, ["result": "The camera is open. The athlete taps the shutter to take the photo."])
    case "take_photo":
      respond(call, ["error": "Ask the athlete to tap the shutter button on the camera; the photo is sent to you when they do."])
    case "view_photo":
      do {
        let photo = call.args["photo_id"]?.string ?? ""
        try await showSavedPhoto(photo)
        respond(call, ["result": ["photo_id": photo, "note": "The image was sent to you."]])
      } catch {
        respond(call, ["error": error.localizedDescription])
      }
    default:
      await journal(call)
    }
  }

  /// A save or read through the server's voice actions, retried with one
  /// id so a lost reply never saves twice.
  private func journal(_ call: FunctionCall) async {
    let reading = Self.readTools.contains(call.name)
    if !reading {
      lines.append(Line(id: call.id, role: .save, text: Self.saveLabels[call.name] ?? "Save", state: .saving))
    }
    guard let session = app.session else { return }
    let id = UUID().uuidString.lowercased()
    var result: [String: Any] = ["ok": false, "error": "The connection to the journal failed."]
    for wait in [0.0, 1.5, 3, 6, 10] {
      if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
      do {
        let response = try await RawRequest.send(
          "api/voice/action",
          body: [
            "id": id, "name": call.name, "args": call.args.mapValues(\.foundation),
            "timezone": TimeZone.current.identifier, "seenPhotoIds": photos,
          ], token: session.token, account: session.accountID)
        // A release in progress answers 502/503; try again shortly.
        if response.status >= 502 { continue }
        result = response.json ?? result
        if response.status != 200 {
          result = ["ok": false, "error": response.error ?? "That could not be done."]
        }
        break
      } catch {
        continue
      }
    }
    let ok = result["ok"] as? Bool == true
    if !reading, let index = lines.firstIndex(where: { $0.id == call.id }) {
      lines[index].state = ok ? .saved : .failed
      if ok { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    }
    if !ok {
      respond(call, ["error": result["error"] as? String ?? "That could not be done."])
    } else if let data = result["data"] {
      respond(call, ["result": data])
    } else {
      var saved: [String: Any] = ["saved": result["title"] ?? "", "detail": result["detail"] ?? ""]
      if let save = result["saveId"] { saved["save_id"] = save }
      respond(call, ["result": saved])
    }
  }

  private func respond(_ call: FunctionCall, _ response: [String: Any]) {
    send(LiveProtocol.toolResponse(call, response))
  }

  /// The athlete took a photo with the camera the coach opened.
  func photoTaken(_ image: UIImage) async {
    cameraRequested = false
    guard let jpeg = CoachModel.jpeg(image) else { return }
    send(LiveProtocol.image(Self.small(image) ?? jpeg))
    let id = UUID().uuidString.lowercased()
    do {
      try await app.client.uploadImage(
        body: .json(
          .init(
            id: id, label: "Meal photo from voice check-in", date: JournalDay.string(.now),
            autoTag: false, purpose: .mealPhoto, image: jpeg.base64EncodedString()))
      ).value()
      photos.append(id)
      send(LiveProtocol.text("(The athlete took a food photo, photo id \(id). It is the image just sent.)"))
    } catch {
      self.error = "The photo could not be saved: \(error.localizedDescription)"
    }
  }

  private func showSavedPhoto(_ id: String) async throws {
    guard let session = app.session, UUID(uuidString: id) != nil else {
      throw VoiceError("That photo is not in the athlete's library.")
    }
    let response = try await RawRequest.send(
      "api/images/\(id)", method: "GET", token: session.token, account: session.accountID)
    guard response.status == 200, let image = UIImage(data: response.data), let jpeg = Self.small(image) else {
      throw VoiceError("That photo is not in the athlete's library.")
    }
    send(LiveProtocol.image(jpeg))
    if !photos.contains(id) { photos.append(id) }
  }

  /// A JPEG no larger than the coach needs.
  static func small(_ image: UIImage) -> Data? {
    let scale = min(1, 1024 / max(image.size.width, image.size.height, 1))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }.jpegData(compressionQuality: 0.75)
  }

  // MARK: Ending

  /// Ends once nothing is playing and no check or save is running, or after
  /// the limit if something hangs.
  private func endWhenIdle(limit: Duration) async {
    let until = ContinuousClock.now + limit
    while !closed, ContinuousClock.now < until, pending > 0 || audio.coachSpeaking {
      try? await Task.sleep(for: .milliseconds(300))
    }
    try? await Task.sleep(for: .milliseconds(1200))
    stop()
  }

  // MARK: Server records

  private func schedulePersist() {
    persistTask?.cancel()
    persistTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(4))
      guard !Task.isCancelled else { return }
      self?.persist()
    }
  }

  /// The conversation is kept on the server so Coach can recall it later.
  private func persist() {
    let entries = lines.filter { $0.role != .save }.suffix(400).map {
      ["role": $0.role == .you ? "you" : "coach", "text": String($0.text.prefix(4000))]
    }
    guard !entries.isEmpty, let session = app.session else { return }
    let body: [String: Any] = ["id": id.uuidString.lowercased(), "purpose": "checkin", "entries": Array(entries)]
    guard let json = try? JSONSerialization.data(withJSONObject: body) else { return }
    Task.detached {
      _ = try? await RawRequest.send(
        "api/voice/transcript", json: json, token: session.token, account: session.accountID)
    }
  }

  /// Connection problems are reported (codes only, never content).
  private func report(_ event: String, _ details: [String: Any] = [:]) {
    guard let session = app.session else { return }
    var body = details
    body["event"] = event
    guard let json = try? JSONSerialization.data(withJSONObject: body) else { return }
    Task.detached {
      _ = try? await RawRequest.send(
        "api/voice/event", json: json, token: session.token, account: session.accountID, timeout: 10)
    }
  }

  private func failureMessage(_ error: any Error) -> String {
    let message = error.localizedDescription
    return LiveProtocol.isCreditError(message) ? LiveProtocol.creditMessage : message
  }
}

struct VoiceError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
