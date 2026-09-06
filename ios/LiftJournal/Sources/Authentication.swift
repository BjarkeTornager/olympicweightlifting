import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

struct LoginProof {
  let verifier =
    UUID().uuidString.replacingOccurrences(of: "-", with: "")
    + UUID().uuidString.replacingOccurrences(of: "-", with: "")
  let state = UUID().uuidString.replacingOccurrences(of: "-", with: "")
  var challenge: String {
    Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString().replacingOccurrences(
      of: "+", with: "-"
    ).replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
  func code(from url: URL) throws -> String {
    guard url.scheme == "liftjournal", url.host == "auth",
      let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      parts.queryItems?.first(where: { $0.name == "state" })?.value == state,
      let code = parts.queryItems?.first(where: { $0.name == "code" })?.value, code.count == 43
    else { throw ServiceError(message: "Sign-in could not be verified. Please try again.") }
    return code
  }
}
enum CredentialStore {
  private static let service = "app.liftjournal.ios.session"
  static func read() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "session", kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var value: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess,
      let data = value as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func save(_ token: String) throws {
    clear()
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "session",
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecValueData as String: Data(token.utf8),
    ]
    guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
      throw ServiceError(message: "Could not securely save sign-in on this device.")
    }
  }
  static func clear() {
    SecItemDelete(
      [
        kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
        kSecAttrAccount as String: "session",
      ] as CFDictionary)
  }
}
@MainActor final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var session: ASWebAuthenticationSession?
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
      .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }
  func authenticate() async throws -> (String, String) {
    let proof = LoginProof()
    var url = URLComponents(
      url: APIClient.origin.appendingPathComponent("mobile"), resolvingAgainstBaseURL: false)!
    url.queryItems = [
      URLQueryItem(name: "challenge", value: proof.challenge),
      URLQueryItem(name: "state", value: proof.state),
    ]
    let callback: URL = try await withCheckedThrowingContinuation { continuation in
      session = ASWebAuthenticationSession(url: url.url!, callback: .customScheme("liftjournal")) {
        returned, error in
        if let returned {
          continuation.resume(returning: returned)
        } else {
          continuation.resume(throwing: error ?? ServiceError(message: "Sign-in cancelled."))
        }
      }
      session?.presentationContextProvider = self
      session?.prefersEphemeralWebBrowserSession = true
      if session?.start() != true {
        continuation.resume(throwing: ServiceError(message: "Could not open secure sign-in."))
        session = nil
      }
    }
    session = nil
    return (try proof.code(from: callback), proof.verifier)
  }
}
