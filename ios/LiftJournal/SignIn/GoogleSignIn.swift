import AuthenticationServices
import CryptoKit
import Foundation
import LiftAPI
import UIKit

/// Google sign-in through the website, with PKCE. The website completes
/// Google's sign-in, checks the invitation, and hands back only a short-lived
/// single-use code bound to this app's challenge. The app exchanges it, with
/// the verifier that never left the phone, for its own session.
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
  enum Failure: LocalizedError {
    case cancelled, unverified, unavailable
    var errorDescription: String? {
      switch self {
      case .cancelled: "Sign-in was cancelled."
      case .unverified: "Sign-in could not be verified. Please try again."
      case .unavailable: "Secure sign-in could not open. Please try again."
      }
    }
  }

  struct Grant {
    let code: String
    let verifier: String
  }

  private var session: ASWebAuthenticationSession?

  func authenticate() async throws -> Grant {
    let verifier = Self.random(bytes: 48)
    let state = Self.random(bytes: 32)
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
    var url = URLComponents(
      url: LiftServer.origin.appending(path: "mobile"), resolvingAgainstBaseURL: false)!
    url.queryItems = [
      URLQueryItem(name: "challenge", value: challenge),
      URLQueryItem(name: "state", value: state),
    ]
    let callback: URL = try await withCheckedThrowingContinuation { continuation in
      let session = ASWebAuthenticationSession(
        url: url.url!, callback: .customScheme("liftjournal")
      ) { returned, error in
        if let returned {
          continuation.resume(returning: returned)
        } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
          continuation.resume(throwing: Failure.cancelled)
        } else {
          continuation.resume(throwing: error ?? Failure.unavailable)
        }
      }
      session.presentationContextProvider = self
      // No shared cookies: each sign-in starts clean.
      session.prefersEphemeralWebBrowserSession = true
      self.session = session
      if !session.start() { continuation.resume(throwing: Failure.unavailable) }
    }
    session = nil
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    guard callback.scheme == "liftjournal", callback.host() == "auth",
      items.first(where: { $0.name == "state" })?.value == state,
      let code = items.first(where: { $0.name == "code" })?.value, code.count == 43
    else { throw Failure.unverified }
    return Grant(code: code, verifier: verifier)
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return window }
    return ASPresentationAnchor(windowScene: scenes.first!)
  }

  private static func random(bytes count: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: count)
    _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
    return Data(bytes).base64URL
  }
}

extension Data {
  var base64URL: String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
