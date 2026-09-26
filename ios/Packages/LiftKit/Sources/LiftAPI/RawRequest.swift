import Foundation

/// Hand-built JSON requests for the endpoints the OpenAPI document does not
/// describe (the voice check-in, which the website shares). Same headers and
/// session as the generated client.
public enum RawRequest {
  public struct Response: Sendable {
    public let status: Int
    public let data: Data
    public var json: [String: Any]? {
      (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    public var error: String? { json?["error"] as? String }
  }

  public static func send(
    _ path: String, method: String = "POST", body: [String: Any]? = nil,
    token: String, account: String, headers: [String: String] = [:], timeout: TimeInterval = 20
  ) async throws -> Response {
    try await send(
      path, method: method, json: body.map { try JSONSerialization.data(withJSONObject: $0) },
      token: token, account: account, headers: headers, timeout: timeout)
  }

  /// The same with an already encoded body, safe to hand to another task.
  public static func send(
    _ path: String, method: String = "POST", json: Data?,
    token: String, account: String, headers: [String: String] = [:], timeout: TimeInterval = 20
  ) async throws -> Response {
    var request = URLRequest(url: LiftServer.origin.appending(path: path))
    request.httpMethod = method
    request.timeoutInterval = timeout
    LiftHeaders.apply(to: &request, token: token, account: account)
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    if let json {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = json
    }
    let (data, response) = try await LiftServer.session().data(for: request)
    return Response(status: (response as? HTTPURLResponse)?.statusCode ?? 0, data: data)
  }
}
