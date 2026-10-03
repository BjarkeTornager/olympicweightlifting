import AVFAudio
import Foundation
import LiftAPI
import LiftStore
import LiftVoice
import Observation
import UIKit
import os

/// One spoken conversation with Coach, the same check-in as the website's.
/// Audio goes straight between this iPhone and the voice chosen in Profile,
/// Google's Live API or an ElevenLabs agent, with a single-use link from the
/// server; every save and read goes through the server's voice actions, so
/// both apps and both voices behave alike. The call survives connection
/// limits, network drops and a locked screen.
@Observable
final class VoiceCall {
  enum Status: Equatable { case idle, connecting, listening, speaking, reconnecting, ended, failed }

  struct Line: Identifiable, Equatable {
    enum Role { case you, coach, save, card }
    enum SaveState { case saving, saved, failed }
    let id: String
    var role: Role
    var text: String
    var state: SaveState?
    /// A card the coach put on screen (show_card), with its picture once
    /// one is asked for (show_picture).
    var visual: Components.Schemas.CoachVisual?

    /// What was said, as opposed to a save or a card.
    var spoken: Bool { role == .you || role == .coach }
  }

  private(set) var status: Status = .idle
  private(set) var error: String?
  private(set) var lines: [Line] = []
  /// Coach's voice and the athlete's, each from 0 to 1 and smoothed: each
  /// half of the call's mark rises with its own speaker.
  private(set) var coachLevel: Float = 0
  private(set) var micLevel: Float = 0
  /// When the voice answered, for the call's running time.
  private(set) var connectedAt: Date?
  var muted = false {
    didSet { audio.muted = muted }
  }
  /// The coach asked to see a meal; the camera sheet is shown.
  var cameraRequested = false

  var inCall: Bool { [.connecting, .listening, .speaking, .reconnecting].contains(status) }
  /// Fixed when the call starts, so a change in Profile applies to the next.
  private(set) var provider: VoiceProvider = .google
  /// ElevenLabs' id for this conversation, to hand it photos.
  private var conversationID: String?
  var saved: Int { lines.filter { $0.state == .saved }.count }
  var cards: Int { lines.filter { $0.role == .card }.count }

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
  /// Pictures ElevenLabs has been or will be told about, each once.
  private var watchedPictures: Set<String> = []
  private let log = Logger(subsystem: "com.bjarketornager.liftjournal", category: "voice")

  static let maxMinutes = 30
  /// After the coach's goodbye, how long the athlete has to keep talking.
  static let endingGrace: Duration = .seconds(12)
  /// 4: draws show_card's cards and their pictures, so the server offers
  /// the tools.
  static let clientVersion = "4"
  private static let saveLabels = [
    "log_training": "Training", "update_training": "Workout corrected", "log_meal": "Meal",
    "update_meal": "Meal updated", "delete_meal": "Meal deleted", "log_sleep": "Sleep",
    "log_drink": "Drink", "delete_drink": "Drink removed",
    "log_supplement": "Supplement", "delete_supplement": "Supplement removed", "log_body_fat": "Body fat", "log_activity": "Activity",
    "clear_unfinished_workout": "Unfinished workout", "set_goals": "Goals", "undo_save": "Undo",
  ]
  /// Server tools that only read; they leave no receipt in the conversation.
  private static let readTools: Set<String> = ["read_journal", "list_photos", "recall_conversations"]
  /// Server tools that put a card on screen, or a picture on a card,
  /// instead of saving.
  static let displayTools: Set<String> = ["show_card", "show_picture"]

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
    provider = VoiceProvider.current(offered: app.voiceProviders)
    let allowed = await AVAudioApplication.requestRecordPermission()
    voiceTrace("microphone permission: \(allowed)")
    guard allowed else {
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
    // Coach starts the call knowing the day: last night's sleep and new
    // workouts from Apple Health reach the server first.
    await app.syncHealthForCall()
    do {
      try audio.start()
      voiceTrace("audio start returned")
      try await connect(resume: false)
      voiceTrace("connected and ready")
      meter()
      tasks.append(
        Task { [weak self] in
          try? await Task.sleep(for: .seconds((Self.maxMinutes - 2) * 60))
          self?.note(
            "(Two minutes left in this call: finish the current topic, then say goodbye and call end_check_in.)",
            answer: false)
          try? await Task.sleep(for: .seconds(120))
          await self?.endWhenIdle(limit: .seconds(90))
        })
    } catch {
      voiceTrace("start failed: \(error.localizedDescription)")
      stop(failure: failureMessage(error))
    }
  }

  func stop(failure: String? = nil) {
    guard !closed else { return }
    closed = true
    persistTask?.cancel()
    persist(final: true)
    tasks.forEach { $0.cancel() }
    tasks = []
    ending?.cancel()
    nudge?.cancel()
    socket?.cancel(with: .normalClosure, reason: nil)
    socket = nil
    audio.stop()
    coachLevel = 0
    micLevel = 0
    connected(.failure(CancellationError()))
    error = failure
    status = failure == nil ? .ended : .failed
    Task { await app.loadToday() }
  }

  // MARK: Connection

  private func connect(resume: Bool) async throws {
    guard let session = app.session else { throw VoiceError("Sign in again to talk to Coach.") }
    var body: [String: Any] = [
      "timezone": TimeZone.current.identifier, "purpose": "checkin",
      "language": CoachLanguage.current.rawValue,
    ]
    if let voice = provider.chosenVoice(in: app.voiceOptions) { body["voice"] = voice }
    if resume, let handle { body["resumeHandle"] = handle }
    // Only sent for ElevenLabs, which only a server that knows it offers.
    if provider == .elevenlabs { body["provider"] = provider.rawValue }
    let response = try await RawRequest.send(
      "api/voice/session", body: body, token: session.token, account: session.accountID,
      headers: ["X-Voice-Client": Self.clientVersion], timeout: 15)
    voiceTrace("session request: HTTP \(response.status)\(response.error.map { " – \($0)" } ?? "")")
    if response.status == 426 { app.updateRequired = true }
    if response.status == 401 {
      _ = await app.handle(APIFailure(status: 401, message: "Sign in again."))
    }
    // Gemini takes the setup first; ElevenLabs this call's instructions.
    let first: [String: Any]? =
      provider == .elevenlabs
      ? response.json?["start"] as? [String: Any]
      : response.json?["setup"].map { ["setup": $0] }
    guard response.status == 200, let json = response.json,
      let raw = json["url"] as? String, let url = URL(string: raw), let first
    else { throw VoiceError(response.error ?? "Voice could not start.") }
    guard !closed else { return }

    let previous = socket
    let task = URLSession.shared.webSocketTask(with: url)
    task.maximumMessageSize = 16 * 1024 * 1024
    socket = task
    task.resume()
    voiceTrace("socket opening to \(url.host() ?? "?")")
    try await task.send(.string(Self.encode(first)))
    voiceTrace("setup sent (\(provider.rawValue))")
    listen(on: task, previous: previous)
    // Wait until the voice is ready, or give up after 20 seconds.
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
            voiceTrace("socket closed: code \(task.closeCode.rawValue) \(reason ?? error.localizedDescription)")
            self.report("socket_closed", ["code": task.closeCode.rawValue, "reason": String((reason ?? "").prefix(200))])
            if self.waiting != nil {
              self.connected(.failure(VoiceError(reason ?? "The voice connection closed.")))
            } else {
              await self.recover()
            }
            return
          }
          guard let self, !self.closed else { return }
          self.received += 1
          if self.received <= 3 || self.received % 50 == 0 {
            voiceTrace("message \(self.received) from \(self.provider.title)")
          }
          let data: Data
          switch message {
          case .string(let text): data = Data(text.utf8)
          case .data(let bytes): data = bytes
          @unknown default: continue
          }
          let events =
            self.provider == .elevenlabs ? ElevenLabsProtocol.events(data) : LiveProtocol.events(data)
          for event in events {
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
      connectedAt = .now
      // Let the coach speak first.
      note("(The athlete started the call.)", answer: true)
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
          // the last few lines to carry on from, with any card on screen.
          note("(The call reconnected. Continue where you left off; the last lines were:\n\(Self.recap(lines)))", answer: true)
        }
        report("reconnected", ["resumed": resumed ? 1 : 0])
        return
      } catch {
        if closed { return }
        if let credit = creditFailure(error.localizedDescription) {
          stop(failure: credit)
          return
        }
        try? await Task.sleep(for: .seconds(wait))
      }
    }
    report("reconnect_failed")
    stop(failure: "The call dropped. Anything already saved is in Coach.")
  }

  /// The last few lines for a coach starting afresh, with the cards on
  /// screen and their ids, which show_picture needs (recapLines on the
  /// website).
  static func recap(_ lines: [Line]) -> String {
    lines.filter { $0.role != .save }.suffix(8)
      .map { line in
        switch line.role {
        case .card:
          "(Card on screen: \(line.text), \(line.visual?.kind ?? "card"), card_id \(line.id))"
        case .you: "Athlete: \(line.text)"
        default: "Coach: \(line.text)"
        }
      }
      .joined(separator: "\n")
  }

  private func send(_ message: [String: Any]) {
    guard let socket, !closed, let text = try? Self.encode(message) else { return }
    socket.send(.string(text)) { _ in }
  }

  private static func encode(_ object: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
  }

  /// A note in brackets from the app to the coach. Gemini takes every note
  /// as something to respond to; ElevenLabs replies only when asked to, and
  /// otherwise keeps the note for its next turn.
  private func note(_ text: String, answer: Bool) {
    switch provider {
    case .google: send(LiveProtocol.text(text))
    case .elevenlabs: send(answer ? ElevenLabsProtocol.userMessage(text) : ElevenLabsProtocol.context(text))
    }
  }

  // MARK: Audio

  private var received = 0
  private var heardAudio = false
  private var sentChunks = 0

  private func microphone(_ chunk: [Int16]) {
    guard started, !closed, !reconnecting else { return }
    sentChunks += 1
    if sentChunks == 1 || sentChunks % 100 == 0 { voiceTrace("sent \(sentChunks) microphone chunks") }
    for pcm in gate.pass(chunk, coachSpeaking: audio.coachSpeaking, coachLevel: audio.coachLevel) {
      send(provider == .elevenlabs ? ElevenLabsProtocol.audio(pcm) : LiveProtocol.audio(pcm))
    }
  }

  /// Drives the on-screen voice from the coach's and the athlete's levels,
  /// kept apart so the mark shows whose turn it is. A muted microphone
  /// moves nothing.
  private func meter() {
    tasks.append(
      Task { [weak self] in
        while let self, !self.closed {
          let coach = min(1, self.audio.coachLevel * 4)
          let mic = self.muted ? 0 : min(1, self.audio.micLevel * 6)
          self.coachLevel = self.coachLevel * 0.7 + coach * 0.3
          self.micLevel = self.micLevel * 0.7 + mic * 0.3
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
      if !heardAudio {
        heardAudio = true
        voiceTrace("first coach audio: \(pcm.count) bytes")
      }
      audio.play(pcm)
    case .interrupted:
      audio.interrupt()
      lineClosed = true
    case .heard(let text):
      guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { break }
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
        // Counted from when the coach stops speaking: ElevenLabs completes a
        // turn as it starts to play, while a card it promised may still be
        // on its way.
        let wait = LiveProtocol.nudgeAfter(turnText)
        nudge = Task { [weak self] in
          var quiet = Duration.zero
          while quiet < wait {
            try? await Task.sleep(for: .milliseconds(250))
            guard let self, !Task.isCancelled else { return }
            quiet = self.audio.coachSpeaking ? .zero : quiet + .milliseconds(250)
          }
          guard let self, !Task.isCancelled, self.pending == 0 else { return }
          self.note(LiveProtocol.waitingNudge, answer: true)
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
    case .ping(let id):
      send(ElevenLabsProtocol.pong(id))
    case .corrected(let text):
      // Cut off mid-reply: keep only what the athlete actually heard.
      if let index = lines.lastIndex(where: { $0.role == .coach }) {
        lines[index].text = text.trimmingCharacters(in: .whitespaces)
        schedulePersist()
      }
    case .conversation(let id):
      conversationID = id
    case .failed(let reason):
      if waiting != nil {
        connected(.failure(VoiceError(reason)))
      } else {
        stop(failure: creditFailure(reason) ?? reason)
      }
    }
  }

  /// A completed turn starts a new line unless it ended mid-sentence; noise
  /// that transcribes as nothing adds no line (appendLine on the website).
  private func append(_ role: Line.Role, _ text: String, fresh: Bool = false) {
    // Coach's words keep no em dashes; the whole line is cleaned, as a dash
    // and its spaces can arrive in separate fragments.
    let clean = { (line: String) in role == .coach ? LiveTranscript.withoutEmDashes(line) : line }
    if let last = lines.last, last.role == role, !fresh || !LiveTranscript.endsSentence(last.text) {
      lines[lines.count - 1].text = clean(LiveTranscript.join(last.text, text))
    } else if !text.trimmingCharacters(in: .whitespaces).isEmpty {
      lines.append(Line(id: UUID().uuidString, role: role, text: clean(text.trimmingCharacters(in: .whitespaces))))
    }
    schedulePersist()
  }

  /// Apple Health delivered sleep or workouts during the call: Coach looks
  /// them up rather than asking for them.
  func healthArrived() {
    guard started, !closed else { return }
    note(
      "(Apple Health just added records for today, such as last night's sleep or a workout. Call read_journal for today and use them; don't ask for them.)",
      answer: false)
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
      if Self.displayTools.contains(call.name) {
        await display(call)
      } else {
        await journal(call)
      }
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
          ], token: session.token, account: session.accountID, headers: ["X-Voice-Client": Self.clientVersion])
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

  /// A card on the athlete's screen, drawn as soon as the server has kept it
  /// in Coach, with no Save chip, or a picture added to one. A quick retry
  /// uses the same id, so a lost reply never shows the card twice.
  private func display(_ call: FunctionCall) async {
    let failure = "The card could not be shown; give the gist in words."
    guard let session = app.session else {
      respond(call, ["error": failure])
      return
    }
    let id = UUID().uuidString.lowercased()
    var result: [String: Any] = ["ok": false, "error": failure]
    for wait in [0.0, 1, 1] {
      if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
      do {
        let response = try await RawRequest.send(
          "api/voice/action",
          body: [
            "id": id, "name": call.name, "args": call.args.mapValues(\.foundation),
            "timezone": TimeZone.current.identifier, "callId": self.id.uuidString.lowercased(),
          ], token: session.token, account: session.accountID,
          headers: ["X-Voice-Client": Self.clientVersion], timeout: 10)
        if response.status >= 502 { continue }
        result = response.json ?? result
        if response.status != 200 { result = ["ok": false, "error": response.error ?? failure] }
        break
      } catch {
        continue
      }
    }
    guard result["ok"] as? Bool == true else {
      respond(call, ["error": result["error"] as? String ?? failure])
      return
    }
    if let visual = Self.card(result["card"]) {
      // The card's id is the one show_picture names it by.
      let card = (result["data"] as? [String: Any])?["card_id"] as? String ?? id
      let fresh = !lines.contains { $0.role == .card && $0.id == card }
      lines = Self.placing(visual, id: card, in: lines)
      if fresh { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
      if let picture = visual.pictureId { watchPicture(picture, title: visual.title) }
    }
    respond(call, ["result": result["data"] ?? [String: Any]()])
  }

  /// The call's lines with a card shown: a new card at the end, or one
  /// already on screen updated where it is (its picture added).
  static func placing(_ visual: Components.Schemas.CoachVisual, id: String, in lines: [Line]) -> [Line] {
    var lines = lines
    if let index = lines.firstIndex(where: { $0.role == .card && $0.id == id }) {
      lines[index].visual = visual
    } else {
      lines.append(Line(id: id, role: .card, text: visual.title, visual: visual))
    }
    return lines
  }

  /// ElevenLabs is told once a picture it asked for is on screen, or
  /// couldn't be drawn, without being made to reply. Gemini answers every
  /// note, so it gets none; the card shows the picture either way.
  private func watchPicture(_ picture: String, title: String) {
    guard provider == .elevenlabs, !watchedPictures.contains(picture), let session = app.session else { return }
    watchedPictures.insert(picture)
    tasks.append(
      Task { [weak self] in
        let until = ContinuousClock.now + CoachPicture.patience
        var outcome = CoachPicture.Outcome.drawing
        while outcome == .drawing, ContinuousClock.now < until, !Task.isCancelled {
          let response = try? await RawRequest.send(
            "api/coach/pictures/\(picture)", method: "GET", json: nil, token: session.token,
            account: session.accountID, timeout: 15)
          outcome = CoachPicture.outcome(status: response?.status ?? 0)
          if outcome == .drawing { try? await Task.sleep(for: CoachPicture.interval) }
        }
        guard let self, !Task.isCancelled, !self.closed else { return }
        self.note(Self.pictureNote(title: title, ready: outcome == .ready), answer: false)
      })
  }

  /// What ElevenLabs is told when a picture settles.
  static func pictureNote(title: String, ready: Bool) -> String {
    ready
      ? "(The picture of \(title) is now on the athlete's screen.)"
      : "(The picture of \(title) couldn't be drawn; the recipe card is still on screen. Mention it only if asked.)"
  }

  /// The card in an action's reply, in the shape the Coach thread draws.
  static func card(_ json: Any?) -> Components.Schemas.CoachVisual? {
    guard let json, JSONSerialization.isValidJSONObject(json),
      let data = try? JSONSerialization.data(withJSONObject: json)
    else { return nil }
    return try? JSONDecoder().decode(Components.Schemas.CoachVisual.self, from: data)
  }

  private func respond(_ call: FunctionCall, _ response: [String: Any]) {
    send(
      provider == .elevenlabs
        ? ElevenLabsProtocol.toolResult(call, response) : LiveProtocol.toolResponse(call, response))
  }

  /// The athlete took a photo with the camera the coach opened.
  func photoTaken(_ image: UIImage) async {
    cameraRequested = false
    guard let jpeg = CoachModel.jpeg(image) else { return }
    // Gemini sees it on the socket; ElevenLabs gets it from the server below.
    if provider == .google { send(LiveProtocol.image(Self.small(image) ?? jpeg)) }
    let id = UUID().uuidString.lowercased()
    do {
      try await app.client.uploadImage(
        body: .json(
          .init(
            id: id, label: "Meal photo from voice check-in", date: JournalDay.string(.now),
            autoTag: false, purpose: .mealPhoto, image: jpeg.base64EncodedString()))
      ).value()
      photos.append(id)
      switch provider {
      case .google:
        note("(The athlete took a food photo, photo id \(id). It is the image just sent.)", answer: true)
      case .elevenlabs:
        // ElevenLabs gets the photo from the server, then sees it with the note.
        if let file = await showToElevenLabs(id) {
          send(ElevenLabsProtocol.photo("(The athlete took a food photo, photo id \(id). It is the attached image.)", fileID: file))
        } else {
          note(
            "(The athlete took a food photo, photo id \(id), but it couldn't be shown to you: ask what's on the plate and roughly how much, then log_meal with this id in photo_ids.)",
            answer: true)
        }
      }
    } catch {
      self.error = "The photo could not be saved: \(error.localizedDescription)"
    }
  }

  /// Hands a photo just taken to the ElevenLabs conversation; nil if that
  /// failed, and the coach asks about the plate instead.
  private func showToElevenLabs(_ photoID: String) async -> String? {
    guard let conversationID, let session = app.session else { return nil }
    let response = try? await RawRequest.send(
      "api/voice/photo", body: ["conversationId": conversationID, "photoId": photoID],
      token: session.token, account: session.accountID, timeout: 25)
    guard let response, response.status == 200 else {
      report("photo_failed", ["status": response?.status ?? 0])
      return nil
    }
    return response.json?["fileId"] as? String
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

  /// The conversation is kept on the server so Coach can recall it later
  /// and the thread can show it. The last save marks the call as ended, so
  /// the server tidies the transcript (punctuation, clear mishearings).
  private func persist(final: Bool = false) {
    let entries = Self.transcriptEntries(lines)
    guard !entries.isEmpty, let session = app.session else { return }
    var body: [String: Any] = ["id": id.uuidString.lowercased(), "purpose": "checkin", "entries": entries]
    if final { body["final"] = true }
    guard let json = try? JSONSerialization.data(withJSONObject: body) else { return }
    Task.detached {
      _ = try? await RawRequest.send(
        "api/voice/transcript", json: json, token: session.token, account: session.accountID)
    }
  }

  /// What was said, for the stored transcript: saves and cards are kept in
  /// Coach as their own turns, so they never become the coach's words.
  static func transcriptEntries(_ lines: [Line]) -> [[String: String]] {
    lines.filter(\.spoken).suffix(400).map {
      ["role": $0.role == .you ? "you" : "coach", "text": String($0.text.prefix(4000))]
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
    return creditFailure(message) ?? message
  }

  /// The chosen voice's own message when its credit has run out.
  private func creditFailure(_ message: String) -> String? {
    switch provider {
    case .google: LiveProtocol.isCreditError(message) ? LiveProtocol.creditMessage : nil
    case .elevenlabs: ElevenLabsProtocol.isCreditError(message) ? ElevenLabsProtocol.creditMessage : nil
    }
  }
}

#if DEBUG
  extension VoiceCall {
    /// A call at a given moment, for previews and screenshots: nothing
    /// connects or plays.
    static func staged(
      _ status: Status, lines: [Line] = [], coachLevel: Float = 0, micLevel: Float = 0, muted: Bool = false
    ) -> VoiceCall {
      let call = VoiceCall(app: AppModel())
      call.status = status
      call.lines = lines
      call.coachLevel = coachLevel
      call.micLevel = micLevel
      call.connectedAt = .now - 192
      call.closed = !call.inCall
      call.muted = muted
      return call
    }
  }
#endif

struct VoiceError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
