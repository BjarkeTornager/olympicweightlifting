import Foundation
import LiftAPI
import LiftStore
import Observation
import UIKit

typealias CoachTurn = Components.Schemas.CoachTurn
typealias VoiceCallRecord = Components.Schemas.VoiceCall

/// A typed message or a voice call, in the order they happened.
enum ThreadItem: Identifiable {
  case turn(CoachTurn)
  case call(VoiceCallRecord)

  var id: String {
    switch self {
    case .turn(let turn): "turn-\(turn.id)"
    case .call(let call): "call-\(call.id)"
    }
  }

  var date: Date {
    switch self {
    case .turn(let turn): CoachView.date(turn.createdAt)
    case .call(let call): CoachView.date(call.startedAt)
    }
  }
}

@Observable
final class CoachModel {
  struct Attachment: Identifiable {
    let id = UUID()
    let preview: UIImage
    let jpeg: Data
  }

  var turns: [CoachTurn] = []
  /// Voice calls from the last 30 days, with their transcripts.
  var calls: [VoiceCallRecord] = []
  var loaded = false
  var draft = ""
  var attachments: [Attachment] = []
  var sending = false
  /// The message being answered, shown until the saved turn arrives.
  var asking: String?
  var step: String?
  var reply = ""
  /// Visuals Coach has made for the message being answered, shown as they
  /// arrive, until the saved turn replaces them.
  var liveVisuals: [Components.Schemas.CoachVisual] = []
  var error: String?
  var busyReceipt: String?
  /// Photos attached to the message being answered, shown until it's saved.
  var sendingPreviews: [UIImage] = []
  /// The text sent with photos and no words.
  static let photoOnly = "Here's a photo."
  /// Counts sends, for the send haptic.
  var sentCount = 0

  private var task: Task<Void, Never>?
  private var refreshing: Task<Void, Never>?
  /// The message being answered, by its run id, until its saved turn arrives.
  private var pending: (id: UUID, stream: CoachStream)?

  func load(_ app: AppModel) async {
    do {
      async let history = app.client.getCoach().value().turns
      // The thread still shows typed messages if calls can't be loaded.
      async let spoken = try? app.client.getVoiceCalls().value().calls
      turns = try await history
      calls = await spoken ?? calls
      loaded = true
      refreshWhileAnswering(app)
    } catch {
      self.error = await app.handle(error)
    }
  }

  /// A reply still being written on the server, as when the app was closed
  /// mid-reply, is picked up by itself, for three minutes after it was sent.
  private func refreshWhileAnswering(_ app: AppModel) {
    guard pending == nil, refreshing == nil,
      turns.contains(where: { $0.status == "running" && CoachView.date($0.createdAt) > .now - 180 })
    else { return }
    refreshing = Task { [weak self] in
      try? await Task.sleep(for: .seconds(3))
      guard let self, !Task.isCancelled else { return }
      self.refreshing = nil
      await self.load(app)
    }
  }

  /// Typed turns and voice calls together, oldest first. The message being
  /// answered shows on its own until it's done, not also as a saved turn.
  var items: [ThreadItem] {
    let answering = asking == nil ? nil : pending?.id.uuidString.lowercased()
    return (turns.filter { $0.id != answering }.map(ThreadItem.turn) + calls.map(ThreadItem.call))
      .sorted { $0.date < $1.date }
  }

  var canSend: Bool {
    !sending && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
  }

  func send(_ app: AppModel) {
    guard canSend, let session = app.session else { return }
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    let message = text.isEmpty ? Self.photoOnly : text
    let photos = attachments
    // The message leaves the text field at once, as in Messages; it comes
    // back only if it could not be sent.
    draft = ""
    attachments = []
    sentCount += 1
    sending = true
    asking = message
    sendingPreviews = photos.map(\.preview)
    step = photos.isEmpty ? nil : "Uploading photos"
    reply = ""
    liveVisuals = []
    error = nil
    let runID = UUID()
    let stream = CoachStream(token: session.token, account: session.accountID)
    pending = (runID, stream)
    task = Task {
      // A little time to finish if the athlete switches app mid-reply; the
      // server carries on regardless, and the reply is read when they're back.
      let background = BackgroundTime("Coach reply")
      defer {
        sending = false
        step = nil
        pending = nil
        background.end()
      }
      do {
        var ids: [UUID] = []
        for photo in photos {
          let id = UUID()
          try await app.client.uploadImage(
            body: .json(
              .init(
                id: id.uuidString.lowercased(), label: "Coach photo", date: JournalDay.string(.now),
                autoTag: true, image: photo.jpeg.base64EncodedString()))
          ).value()
          ids.append(id)
        }
        do {
          for try await event in stream.run(
            id: runID, message: message, revision: app.today?.revision ?? 0, photoIDs: ids,
            language: CoachLanguage.current.rawValue)
          {
            switch event {
            case .step(let text): step = text
            case .reply(let text): reply = text
            case .visual(let visual):
              if !liveVisuals.contains(where: { $0.id == visual.id }) { liveVisuals.append(visual) }
            case .finished: step = nil
            }
          }
        } catch where CoachFailure.isInterruption(error) && !Task.isCancelled {
          // The connection dropped, usually because the app was in the
          // background: Coach is still working on the server.
          try await follow(runID, app: app)
        }
        await load(app)
        asking = nil
        reply = ""
        liveVisuals = []
        sendingPreviews = []
        await app.loadToday()
      } catch {
        // Nothing was saved: put the message back so it can be sent again.
        asking = nil
        reply = ""
        liveVisuals = []
        sendingPreviews = []
        if draft.isEmpty { draft = text }
        if attachments.isEmpty { attachments = photos }
        if !(error is CancellationError) {
          self.error = await app.handle(error) ?? error.localizedDescription
        }
        await load(app)
      }
    }
  }

  /// Waits for a turn whose stream was cut off to finish on the server, for
  /// up to three minutes. Throws if it failed, or never reached the server;
  /// past the wait, the turn stays in the thread to refresh later.
  private func follow(_ id: UUID, app: AppModel) async throws {
    step = "Still working"
    let key = id.uuidString.lowercased()
    let deadline = ContinuousClock.now + .seconds(180)
    var missing = 0
    while ContinuousClock.now < deadline {
      try Task.checkCancellation()
      if let history = try? await app.client.getCoach().value() {
        guard let turn = history.turns.first(where: { $0.id == key }) else {
          // Never received: the message is put back to send again.
          missing += 1
          if missing >= 3 {
            throw CoachFailure(message: "Coach didn't get that message. It's back in the box to send again.", status: 0)
          }
          try await Task.sleep(for: .seconds(2))
          continue
        }
        switch turn.status {
        case "done": return
        case "failed":
          throw CoachFailure(message: "Coach could not finish that one. Your message is kept.", status: 0)
        default:
          if let saved = turn.reply, !saved.isEmpty { reply = saved }
        }
      }
      try await Task.sleep(for: .seconds(2))
    }
    // Not put back to send again: it may still arrive, and would be doubled.
    error = "Coach is taking longer than usual. Pull down in a minute to see the reply."
  }

  /// Stop: the server would otherwise finish the reply in the background.
  func cancel() {
    if let pending {
      Task { await pending.stream.cancel(id: pending.id) }
    }
    task?.cancel()
  }

  /// Save a receipt Coach prepared, or undo one it saved.
  func resolve(_ receipt: Components.Schemas.CoachReceipt, undo: Bool, app: AppModel) async {
    busyReceipt = receipt.id
    defer { busyReceipt = nil }
    do {
      try await app.client.applyProposal(body: .json(.init(id: receipt.id, undo: undo))).value()
      await load(app)
      await app.loadToday()
    } catch {
      self.error = await app.handle(error)
    }
  }

  func attach(_ image: UIImage) {
    guard attachments.count < 4, let jpeg = Self.jpeg(image) else { return }
    attachments.append(Attachment(preview: image, jpeg: jpeg))
  }

  /// At most 1280 pixels on the long side, as on the website.
  static func jpeg(_ image: UIImage) -> Data? {
    let longest = max(image.size.width, image.size.height)
    let scale = min(1, 1280 / max(longest, 1))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    return resized.jpegData(compressionQuality: 0.82)
  }
}

/// Extra time iOS allows to finish work after the app leaves the screen
/// (about 30 seconds). It must be handed back before it runs out, or iOS
/// ends the app: when it runs out, it is.
@MainActor
final class BackgroundTime {
  private var id: UIBackgroundTaskIdentifier = .invalid

  init(_ name: String) {
    id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.end() }
  }

  func end() {
    guard id != .invalid else { return }
    UIApplication.shared.endBackgroundTask(id)
    id = .invalid
  }
}
