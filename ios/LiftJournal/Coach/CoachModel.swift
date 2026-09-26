import Foundation
import LiftAPI
import LiftStore
import Observation
import UIKit

typealias CoachTurn = Components.Schemas.CoachTurn

@Observable
final class CoachModel {
  struct Attachment: Identifiable {
    let id = UUID()
    let preview: UIImage
    let jpeg: Data
  }

  var turns: [CoachTurn] = []
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

  private var task: Task<Void, Never>?

  func load(_ app: AppModel) async {
    do {
      turns = try await app.client.getCoach().value().turns
      loaded = true
    } catch {
      self.error = await app.handle(error)
    }
  }

  var canSend: Bool {
    !sending && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
  }

  func send(_ app: AppModel) {
    guard canSend, let session = app.session else { return }
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    let message = text.isEmpty ? "Here's a photo." : text
    let photos = attachments
    sending = true
    asking = message
    step = photos.isEmpty ? "Sending" : "Uploading photos"
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
          case .finished: step = "Saving"
          }
        }
        draft = ""
        attachments = []
        await load(app)
        asking = nil
        reply = ""
        await app.loadToday()
      } catch {
        // The message stays in the composer so it can be sent again.
        asking = nil
        reply = ""
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
