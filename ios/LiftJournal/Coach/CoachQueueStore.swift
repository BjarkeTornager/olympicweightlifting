import Foundation
import LiftStore
import UIKit

/// Coach's queue on disk, in the account's own storage, so messages waiting
/// to be sent survive the app being closed. Each photo is kept as its JPEG
/// file until its message leaves the queue. Signing out removes the lot,
/// with the rest of the account's storage.
struct CoachQueueStore {
  let account: String

  /// One message, as saved: the photos by id, their JPEGs beside it.
  struct Record: Codable {
    struct Photo: Codable {
      let id: UUID
      let day: String
    }

    let id: UUID
    let text: String
    let photos: [Photo]
    let sentAt: Date
    let account: String
    let failure: String?
    let offline: Bool
    let expired: Bool
    /// Missing in queues saved before messages could be held for an edit.
    let editing: Bool?
  }

  private var folder: URL? {
    guard let base = try? Storage.directory(for: account) else { return nil }
    return base.appending(path: "CoachQueue", directoryHint: .isDirectory)
  }

  func save(_ queue: [CoachModel.Outgoing]) {
    guard let folder else { return }
    let mine = queue.filter { $0.account == account }
    // Nothing waiting: nothing kept.
    if mine.isEmpty {
      try? FileManager.default.removeItem(at: folder)
      return
    }
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let records = mine.map { item in
      Record(
        id: item.id, text: item.text, photos: item.photos.map { .init(id: $0.id, day: $0.day) },
        sentAt: item.sentAt, account: item.account, failure: item.failure, offline: item.offline,
        expired: item.expired, editing: item.editing)
    }
    if let data = try? JSONEncoder().encode(records) {
      try? Storage.write(data, to: folder.appending(path: "queue.json"))
    }
    // Each photo is written once; those no longer queued are removed. The
    // paths are unescaped: the folder is under "Application Support".
    let photos = mine.flatMap(\.photos)
    let keep = Set(photos.map(Self.fileName))
    for photo in photos {
      let url = folder.appending(path: Self.fileName(photo))
      if !FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) {
        try? Storage.write(photo.jpeg, to: url)
      }
    }
    let files = (try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))) ?? []
    for file in files where file.hasSuffix(".jpg") && !keep.contains(file) {
      try? FileManager.default.removeItem(at: folder.appending(path: file))
    }
  }

  func load() -> [CoachModel.Outgoing] {
    guard let folder, let data = try? Data(contentsOf: folder.appending(path: "queue.json")),
      let records = try? JSONDecoder().decode([Record].self, from: data)
    else { return [] }
    return records.filter { $0.account == account }.map { record in
      CoachModel.Outgoing(
        id: record.id, text: record.text,
        photos: record.photos.compactMap { photo in
          (try? Data(contentsOf: folder.appending(path: "\(photo.id.uuidString).jpg"))).map {
            CoachModel.Attachment(id: photo.id, day: photo.day, jpeg: $0)
          }
        },
        sentAt: record.sentAt, account: record.account, failure: record.failure, offline: record.offline,
        expired: record.expired, editing: record.editing ?? false)
    }
    // A message whose photos are gone has nothing left to send.
    .filter { !$0.text.isEmpty || !$0.photos.isEmpty }
  }

  private static func fileName(_ photo: CoachModel.Attachment) -> String { "\(photo.id.uuidString).jpg" }
}
