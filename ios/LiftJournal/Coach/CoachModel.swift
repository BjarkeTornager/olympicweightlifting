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
  var error: String?
  var busyReceipt: String?
  /// Photos attached to the message being answered, shown until it's saved.
  var sendingPreviews: [UIImage] = []
  /// The text sent with photos and no words.
  static let photoOnly = "Here's a photo."
  /// Counts sends, for the send haptic.
  var sentCount = 0

  private var task: Task<Void, Never>?

  func load(_ app: AppModel) async {
    do {
      async let history = app.client.getCoach().value().turns
      // The thread still shows typed messages if calls can't be loaded.
      async let spoken = try? app.client.getVoiceCalls().value().calls
      turns = try await history
      calls = await spoken ?? calls
      loaded = true
    } catch {
      self.error = await app.handle(error)
    }
  }

  /// Typed turns and voice calls together, oldest first.
  var items: [ThreadItem] {
    (turns.map(ThreadItem.turn) + calls.map(ThreadItem.call)).sorted { $0.date < $1.date }
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
    error = nil
    task = Task {
      defer {
        sending = false
        step = nil
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
        let stream = CoachStream(token: session.token, account: session.accountID)
        for try await event in stream.run(
          id: UUID(), message: message, revision: app.today?.revision ?? 0, photoIDs: ids)
        {
          switch event {
          case .step(let text): step = text
          case .reply(let text): reply = text
          case .finished: step = nil
          }
        }
        await load(app)
        asking = nil
        reply = ""
        sendingPreviews = []
        await app.loadToday()
      } catch {
        // Nothing was saved: put the message back so it can be sent again.
        asking = nil
        reply = ""
        sendingPreviews = []
        if draft.isEmpty { draft = text }
        if attachments.isEmpty { attachments = photos }
        self.error = await app.handle(error) ?? error.localizedDescription
        await load(app)
      }
    }
  }

  func cancel() {
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
