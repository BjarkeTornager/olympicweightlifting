import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

/// The one backend the app talks to: the same Railway service as the website.
public enum LiftServer {
  public static var origin: URL {
    #if DEBUG
      // Debug builds may point at a local `npm run dev` server.
      if let raw = ProcessInfo.processInfo.environment["LIFT_SERVER"],
        let url = URL(string: raw), ["localhost", "127.0.0.1"].contains(url.host() ?? "")
      {
        return url
      }
    #endif
    return URL(string: "https://lift-journal-production.up.railway.app")!
  }

  /// Sent as `X-Client: ios/<version>/<build>`; the server gates by build.
  public static var clientHeader: String {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String ?? "0.0"
    let build = info?["CFBundleVersion"] as? String ?? "0"
    return "ios/\(version)/\(build)"
  }

  /// An ephemeral session: no cookies, no response cache, no redirects.
  public static func session() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 60
    configuration.waitsForConnectivity = false
    return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
  }

  /// The generated client with the app's headers attached to every request.
  public static func client(credentials: some CredentialProviding) -> Client {
    Client(
      serverURL: origin,
      transport: URLSessionTransport(configuration: .init(session: session())),
      middlewares: [JournalHeaders(credentials: credentials)]
    )
  }
}

/// Supplies the signed session token and account ID for each request.
public protocol CredentialProviding: Sendable {
  func credentials() async -> (token: String, accountID: String)?
}

final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest
  ) async -> URLRequest? { nil }
}

/// Adds the headers every private endpoint checks: the bearer session, the
/// account the app believes it is signed in to, the site origin (required
/// for changes) and the build, which the server uses instead of the
/// website's feature-version headers.
struct JournalHeaders: ClientMiddleware {
  let credentials: any CredentialProviding

  func intercept(
    _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    for (name, value) in LiftHeaders.common() { request.headerFields[name] = value }
    if let (token, account) = await credentials.credentials() {
      request.headerFields[.authorization] = "Bearer \(token)"
      if !account.isEmpty { request.headerFields[LiftHeaders.account] = account }
    }
    return try await next(request, body, baseURL)
  }
}

public enum LiftHeaders {
  public static let account = HTTPField.Name("X-Journal-Account")!
  static let client = HTTPField.Name("X-Client")!
  static let origin = HTTPField.Name("Origin")!
  static let coachLogging = HTTPField.Name("X-Coach-Logging-Version")!
  static let liftingCoach = HTTPField.Name("X-Lifting-Coach-Version")!

  static func common() -> [(HTTPField.Name, String)] {
    var origin = LiftServer.origin.absoluteString
    if origin.hasSuffix("/") { origin.removeLast() }
    return [
      (Self.client, LiftServer.clientHeader),
      (Self.origin, origin),
      // Coach saves directly with receipts and Undo, and lifting-brief
      // proposals can be confirmed from the app.
      (coachLogging, "1"),
      (liftingCoach, "1"),
    ]
  }

  /// The same headers for hand-built requests (the Coach stream).
  public static func apply(to request: inout URLRequest, token: String, account: String) {
    for (name, value) in common() { request.setValue(value, forHTTPHeaderField: name.rawName) }
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if !account.isEmpty { request.setValue(account, forHTTPHeaderField: Self.account.rawName) }
  }
}
