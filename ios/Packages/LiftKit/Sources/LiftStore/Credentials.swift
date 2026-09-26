import Foundation
import LiftAPI
import Security

/// The signed session token, kept in the Keychain on this device only. It is
/// readable after the first unlock so Apple Health updates can sync in the
/// background while the phone is locked.
public actor Credentials: CredentialProviding {
  public static let shared = Credentials()

  public struct Session: Codable, Sendable, Equatable {
    public var token: String
    public var accountID: String
    public var name: String
    public var email: String

    public init(token: String, accountID: String, name: String, email: String) {
      self.token = token
      self.accountID = accountID
      self.name = name
      self.email = email
    }
  }

  private let service = "com.bjarketornager.liftjournal.session"
  private var cached: Session?
  private var loaded = false

  public func current() -> Session? {
    if !loaded {
      cached = read()
      loaded = true
    }
    return cached
  }

  public func credentials() async -> (token: String, accountID: String)? {
    current().map { ($0.token, $0.accountID) }
  }

  public func save(_ session: Session) throws {
    let data = try JSONEncoder().encode(session)
    SecItemDelete(query() as CFDictionary)
    var item = query()
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    item[kSecValueData as String] = data
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError(status: status) }
    cached = session
    loaded = true
  }

  public func clear() {
    SecItemDelete(query() as CFDictionary)
    cached = nil
    loaded = true
  }

  private func read() -> Session? {
    var item = query()
    item[kSecReturnData as String] = true
    item[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    guard SecItemCopyMatching(item as CFDictionary, &value) == errSecSuccess,
      let data = value as? Data
    else { return nil }
    return try? JSONDecoder().decode(Session.self, from: data)
  }

  private func query() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "session",
    ]
  }
}

public struct KeychainError: LocalizedError {
  public let status: OSStatus
  public var errorDescription: String? {
    "Sign-in could not be saved securely on this iPhone (\(status))."
  }
}
