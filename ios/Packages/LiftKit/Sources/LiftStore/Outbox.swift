import Foundation
import LiftAPI

/// Changes waiting to reach the journal, in the order they were made. Each
/// keeps the ID it was created with, so a retry after a lost response is
/// saved once. The queue is written to disk before sending, so a set logged
/// in a gym with no signal survives the app being closed.
public actor Outbox {
  public struct Item: Codable, Sendable, Identifiable, Equatable {
    public var id: UUID
    public var request: Components.Schemas.ActionRequest
    public var createdAt: Date
    /// Set when the server refused the change; it is kept for the athlete to see.
    public var refusal: String?
  }

  public enum Outcome: Sendable {
    case saved(Components.Schemas.ActionResult)
    case queued
    case refused(String)
  }

  private let account: String
  private let file = Cached<[Item]>("outbox.json")
  private var items: [Item]
  private var flushing = false

  public init(account: String) {
    self.account = account
    items = file.load(account: account) ?? []
  }

  public var pending: [Item] { items.filter { $0.refusal == nil } }
  public var refused: [Item] { items.filter { $0.refusal != nil } }

  /// Queue a change and try to send everything queued.
  public func submit(_ action: Components.Schemas.NativeAction, client: Client) async -> Outcome {
    let item = Item(
      id: UUID(),
      request: .init(
        id: UUID().uuidString.lowercased(), timezone: TimeZone.current.identifier, action: action),
      createdAt: .now
    )
    items.append(item)
    persist()
    let results = await flush(client: client)
    return results[item.id] ?? .queued
  }

  /// Send queued changes in order. Stops at the first connection problem so
  /// later changes never overtake earlier ones.
  @discardableResult
  public func flush(client: Client) async -> [UUID: Outcome] {
    guard !flushing else { return [:] }
    flushing = true
    defer { flushing = false }
    var results: [UUID: Outcome] = [:]
    for item in pending {
      do {
        let result = try await client.applyAction(body: .json(item.request)).value()
        items.removeAll { $0.id == item.id }
        results[item.id] = .saved(result)
      } catch let failure as APIFailure where [400, 404, 410, 413, 422].contains(failure.status) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
          items[index].refusal = failure.message
        }
        results[item.id] = .refused(failure.message)
      } catch {
        // Offline, signed out, rate limited or a server error: keep it and retry later.
        break
      }
      persist()
    }
    persist()
    return results
  }

  public func discard(_ id: UUID) {
    items.removeAll { $0.id == id }
    persist()
  }

  private func persist() {
    file.save(items, account: account)
  }
}
