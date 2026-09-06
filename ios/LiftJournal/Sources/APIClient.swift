import Foundation

struct ServiceError: LocalizedError, Sendable {
  var message: String
  var status: Int = 0
  var errorDescription: String? { message }
}
final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
actor APIClient {
  static var origin: URL {
    #if DEBUG
      if let raw = ProcessInfo.processInfo.environment["LIFT_TEST_SERVER"],
        let url = URL(string: raw), ["localhost", "127.0.0.1"].contains(url.host ?? "")
      {
        return url
      }
    #endif
    return URL(string: "https://lift-journal-production.up.railway.app")!
  }
  private let session: URLSession
  init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 120
    session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
  }
  private func request(
    _ path: String, method: String, token: String?, account: String?, body: JSONValue?
  ) throws -> URLRequest {
    guard path.hasPrefix("/"), !path.hasPrefix("//"),
      let url = URL(string: path, relativeTo: Self.origin)?.absoluteURL,
      url.host == Self.origin.host, url.scheme == Self.origin.scheme
    else { throw ServiceError(message: "Invalid journal address.") }
    var r = URLRequest(url: url)
    r.httpMethod = method
    r.setValue(Self.origin.absoluteString, forHTTPHeaderField: "Origin")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.setValue("1", forHTTPHeaderField: "X-Food-Tags-Version")
    if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let account { r.setValue(account, forHTTPHeaderField: "X-Journal-Account") }
    if let body { r.httpBody = try body.data }
    return r
  }
  func call(
    _ path: String, method: String = "GET", token: String? = nil, account: String? = nil,
    body: JSONValue? = nil
  ) async throws -> JSONValue {
    let (data, response) = try await session.data(
      for: request(path, method: method, token: token, account: account, body: body))
    guard let http = response as? HTTPURLResponse else {
      throw ServiceError(message: "The server did not respond.")
    }
    let value = (try? JSONValue.decode(data)) ?? .null
    guard (200...299).contains(http.statusCode) else {
      throw ServiceError(
        message: value["error"].string.isEmpty
          ? "The request could not be completed." : value["error"].string, status: http.statusCode)
    }
    return value
  }
  func image(_ id: String, token: String, account: String) async throws -> Data {
    guard UUID(uuidString: id) != nil else { throw ServiceError(message: "Invalid image.") }
    let (data, response) = try await session.data(
      for: request("/api/images/\(id)", method: "GET", token: token, account: account, body: nil))
    guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count < 3_000_000
    else { throw ServiceError(message: "Image unavailable.") }
    return data
  }
  func stream(
    token: String, account: String, body: JSONValue, event: @Sendable (JSONValue) async -> Void
  ) async throws {
    var r = try request(
      "/api/agent/run", method: "POST", token: token, account: account, body: body)
    r.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    let (bytes, response) = try await session.bytes(for: r)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw ServiceError(
        message: "Coach could not connect. Your message is kept.",
        status: (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
    var resultReceived = false
    for try await line in bytes.lines {
      try Task.checkCancellation()
      guard line.hasPrefix("data: "), let data = line.dropFirst(6).data(using: .utf8) else {
        continue
      }
      guard data.count < 1_000_000 else {
        throw ServiceError(message: "Coach response is too large.")
      }
      let value = try JSONValue.decode(data)
      if value["type"].string == "RUN_ERROR" {
        throw ServiceError(message: value["message"].string)
      }
      if value["type"].string == "RUN_FINISHED" { resultReceived = true }
      await event(value)
    }
    if !resultReceived {
      throw ServiceError(
        message: "The reply was interrupted. Your message is kept; refresh before retrying.")
    }
  }
}
