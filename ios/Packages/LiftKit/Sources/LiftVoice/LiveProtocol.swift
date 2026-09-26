import Foundation

/// A tool the voice coach asked the app to run.
public struct FunctionCall: Sendable, Equatable {
  public let id: String
  public let name: String
  /// The arguments as JSON, passed through to the server unchanged.
  public let args: [String: JSONValue]
}

/// What a Gemini Live server message means for the call. Mirrors
/// `liveEvents` in lib/voice-live.ts, so both apps treat the stream alike.
public enum LiveEvent: Sendable, Equatable {
  case ready
  case audio(Data)
  case heard(String)
  case said(String)
  case interrupted
  case turnComplete
  case toolCall([FunctionCall])
  case cancelled([String])
  case goAway
  case resumeHandle(String)
}

public enum LiveProtocol {
  public static func events(_ data: Data) -> [LiveEvent] {
    guard let message = try? JSONDecoder().decode(ServerMessage.self, from: data) else { return [] }
    var events: [LiveEvent] = []
    if message.setupComplete != nil { events.append(.ready) }
    if let content = message.serverContent {
      if content.interrupted == true { events.append(.interrupted) }
      if let text = content.inputTranscription?.text, !text.isEmpty { events.append(.heard(text)) }
      for part in content.modelTurn?.parts ?? [] {
        if let base64 = part.inlineData?.data, let audio = Data(base64Encoded: base64) {
          events.append(.audio(audio))
        }
      }
      if let text = content.outputTranscription?.text, !text.isEmpty { events.append(.said(text)) }
      if content.turnComplete == true { events.append(.turnComplete) }
    }
    if let calls = message.toolCall?.functionCalls, !calls.isEmpty {
      events.append(
        .toolCall(calls.map { FunctionCall(id: $0.id, name: $0.name, args: $0.args ?? [:]) }))
    }
    if let ids = message.toolCallCancellation?.ids, !ids.isEmpty { events.append(.cancelled(ids)) }
    if message.goAway != nil { events.append(.goAway) }
    if let resume = message.sessionResumptionUpdate, resume.resumable == true,
      let handle = resume.newHandle
    {
      events.append(.resumeHandle(handle))
    }
    return events
  }

  // MARK: Messages the app sends

  public static func text(_ text: String) -> [String: Any] {
    ["realtimeInput": ["text": text]]
  }

  public static func audio(_ pcm: [Int16]) -> [String: Any] {
    let data = pcm.withUnsafeBufferPointer { Data(buffer: $0) }
    return [
      "realtimeInput": [
        "audio": ["data": data.base64EncodedString(), "mimeType": "audio/pcm;rate=16000"]
      ]
    ]
  }

  public static func image(_ jpeg: Data) -> [String: Any] {
    ["realtimeInput": ["video": ["data": jpeg.base64EncodedString(), "mimeType": "image/jpeg"]]]
  }

  public static func toolResponse(_ call: FunctionCall, _ response: [String: Any]) -> [String: Any] {
    ["toolResponse": ["functionResponses": [["id": call.id, "name": call.name, "response": response]]]]
  }

  /// "Let me check that" with nothing following would leave the athlete in
  /// silence; the app then prompts the coach to carry on.
  public static func promisesAction(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    // The last sentence: everything after the final ". ", "? " or "! ".
    let last = trimmed.matches(of: /[.?!]\s+/).last.map { String(trimmed[$0.range.upperBound...]) } ?? trimmed
    return last.firstMatch(of: promise) != nil
  }

  nonisolated(unsafe) private static let promise =
    /(?i)\b(let me|i'?ll|i will|i'?m going to|one moment|give me a (second|moment))\b[^.?!]{0,40}\b(check|look|see|find|review|save|log|record|update|get|pull|calculate|sort|fix|add)/

  public static let waitingNudge =
    "(The athlete is waiting: do what you just said now, then answer.)"
  public static let creditMessage =
    "Voice is paused because its Google credit has run out. You can keep typing to Coach."
  public static func isCreditError(_ message: String) -> Bool {
    message.range(
      of: "prepayment credits|credit has run out|RESOURCE_EXHAUSTED", options: [.regularExpression, .caseInsensitive])
      != nil
  }
}

private struct ServerMessage: Decodable {
  struct Part: Decodable {
    struct Inline: Decodable { let data: String? }
    let inlineData: Inline?
  }
  struct Turn: Decodable { let parts: [Part]? }
  struct Transcript: Decodable { let text: String? }
  struct Content: Decodable {
    let modelTurn: Turn?
    let inputTranscription: Transcript?
    let outputTranscription: Transcript?
    let interrupted: Bool?
    let turnComplete: Bool?
  }
  struct Call: Decodable {
    let id: String
    let name: String
    let args: [String: JSONValue]?
  }
  struct ToolCall: Decodable { let functionCalls: [Call]? }
  struct Cancellation: Decodable { let ids: [String]? }
  struct Resumption: Decodable {
    let newHandle: String?
    let resumable: Bool?
  }
  struct Empty: Decodable {}

  let setupComplete: Empty?
  let serverContent: Content?
  let toolCall: ToolCall?
  let toolCallCancellation: Cancellation?
  let goAway: Empty?
  let sessionResumptionUpdate: Resumption?
}

/// Any JSON value, for passing tool arguments through untouched.
public enum JSONValue: Codable, Sendable, Equatable {
  case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
    else { self = .object(try container.decode([String: JSONValue].self)) }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let v): try container.encode(v)
    case .number(let v): try container.encode(v)
    case .bool(let v): try container.encode(v)
    case .object(let v): try container.encode(v)
    case .array(let v): try container.encode(v)
    case .null: try container.encodeNil()
    }
  }

  /// As a Foundation object for JSONSerialization.
  public var foundation: Any {
    switch self {
    case .string(let v): v
    case .number(let v): v
    case .bool(let v): v
    case .object(let v): v.mapValues(\.foundation)
    case .array(let v): v.map(\.foundation)
    case .null: NSNull()
    }
  }

  public var string: String? {
    if case .string(let v) = self { return v }
    return nil
  }
}
