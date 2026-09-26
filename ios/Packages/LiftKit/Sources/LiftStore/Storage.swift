import Foundation

/// Files the app keeps between launches: the last Today view (so the app
/// opens offline) and the queue of unsent changes. They live in Application
/// Support with iOS data protection, and are excluded from backups because
/// the server holds the real journal.
public enum Storage {
  public static func directory(for accountID: String) throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    var url = base.appending(path: "Accounts/\(safe(accountID))", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
    return url
  }

  public static func write(_ data: Data, to url: URL) throws {
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  public static func removeAll() {
    guard
      let base = try? FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
    else { return }
    try? FileManager.default.removeItem(at: base.appending(path: "Accounts"))
  }

  private static func safe(_ id: String) -> String {
    String(id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" })
  }
}

/// A Codable value cached per account.
public struct Cached<Value: Codable & Sendable>: Sendable {
  public let name: String
  public init(_ name: String) { self.name = name }

  public func load(account: String) -> Value? {
    guard let url = try? Storage.directory(for: account).appending(path: name),
      let data = try? Data(contentsOf: url)
    else { return nil }
    return try? JSONDecoder().decode(Value.self, from: data)
  }

  public func save(_ value: Value, account: String) {
    guard let url = try? Storage.directory(for: account).appending(path: name),
      let data = try? JSONEncoder().encode(value)
    else { return }
    try? Storage.write(data, to: url)
  }
}
