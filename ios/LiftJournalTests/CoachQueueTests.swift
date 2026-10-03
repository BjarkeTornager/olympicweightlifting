import Foundation
import LiftStore
import Testing
import UIKit

@testable import LiftJournal

@Suite("Coach queue")
struct CoachQueueTests {
  @Test("Messages waiting for Coach survive the app closing, photos and all, for their own account only")
  func savedQueue() throws {
    let account = "test-queue-\(UUID().uuidString)"
    defer { try? FileManager.default.removeItem(at: try! Storage.directory(for: account)) }
    let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 30)).image { context in
      UIColor.systemTeal.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 40, height: 30))
    }
    let photo = CoachModel.Attachment(jpeg: try #require(CoachModel.jpeg(image)))
    let sent = Date(timeIntervalSince1970: 1_790_000_000)
    let store = CoachQueueStore(account: account)
    store.save([
      .init(id: UUID(), text: "", photos: [photo], sentAt: sent, account: account),
      .init(
        id: UUID(), text: "Two eggs and toast", photos: [], sentAt: sent, account: account,
        failure: CoachModel.offlineText, offline: true),
      .init(id: UUID(), text: "Someone else's", photos: [], sentAt: sent, account: "other"),
    ])

    let restored = CoachQueueStore(account: account).load()
    #expect(restored.map(\.text) == ["", "Two eggs and toast"])
    // The same photo id, so sending it again never makes a second copy.
    #expect(restored[0].photos.map(\.id) == [photo.id])
    #expect(restored[0].photos.first?.jpeg == photo.jpeg)
    #expect(restored[0].photos.first?.day == photo.day)
    #expect(restored[0].sentAt == sent)
    #expect(restored[1].failure == CoachModel.offlineText && restored[1].offline)

    // Nothing waiting: nothing kept, photos included.
    store.save([])
    #expect(store.load().isEmpty)
    let folder = try Storage.directory(for: account).appending(path: "CoachQueue")
    #expect(!FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)))
  }

  @Test("A photo leaves the disk with its message, and one being edited keeps its place")
  func photosAndEdits() throws {
    let account = "test-queue-\(UUID().uuidString)"
    defer { try? FileManager.default.removeItem(at: try! Storage.directory(for: account)) }
    let first = CoachModel.Attachment(jpeg: Data([1, 2, 3]))
    let second = CoachModel.Attachment(jpeg: Data([4, 5, 6]))
    var edited = CoachModel.Outgoing(id: UUID(), text: "Lunch", photos: [first], sentAt: .now, account: account)
    edited.editing = true
    let waiting = CoachModel.Outgoing(id: UUID(), text: "", photos: [second], sentAt: .now, account: account)
    let store = CoachQueueStore(account: account)
    store.save([edited, waiting])
    store.save([waiting])
    // The folder is under "Application Support", whose space is escaped
    // in a URL's default path.
    let folder = try Storage.directory(for: account).appending(path: "CoachQueue")
    let files = try FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))
    #expect(files.filter { $0.hasSuffix(".jpg") } == ["\(second.id.uuidString).jpg"])

    store.save([edited, waiting])
    let restored = store.load()
    #expect(restored.map(\.editing) == [true, false])
  }

  @Test("Edit keeps the first message in the queue, held, and out of the waiting list")
  func editHoldsTheQueue() {
    let coach = CoachModel()
    let first = CoachModel.Outgoing(
      id: UUID(), text: "Two eggs", photos: [], sentAt: .now, account: "a", failure: "Stopped")
    let second = CoachModel.Outgoing(id: UUID(), text: "And toast", photos: [], sentAt: .now, account: "a")
    coach.queue = [first, second]
    coach.edit(first.id, app: AppModel())
    #expect(coach.draft == "Two eggs")
    #expect(coach.heldForEdit)
    #expect(coach.queue.map(\.id) == [first.id, second.id])
    #expect(coach.waiting.map(\.id) == [second.id])
    // It goes back in its own place, so a full queue still takes it.
    coach.queue += (0..<CoachModel.maxQueued).map { _ in second }
    #expect(!coach.queueFull)
  }

  @Test("VoiceOver names a queued message by its start, or by its photos")
  func summary() {
    let photo = CoachModel.Attachment(jpeg: Data())
    #expect(
      CoachModel.Outgoing(id: UUID(), text: "", photos: [photo, photo], sentAt: .now, account: "a").summary
        == "2 photos")
    let long = String(repeating: "a", count: 80)
    #expect(
      CoachModel.Outgoing(id: UUID(), text: long, photos: [], sentAt: .now, account: "a").summary
        == String(repeating: "a", count: 60) + "…")
  }
}
