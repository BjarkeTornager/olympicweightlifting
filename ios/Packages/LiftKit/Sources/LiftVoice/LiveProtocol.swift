import Foundation
import os

/// Voice diagnostics: to the unified log, and to stdout so a build launched
/// from the Mac shows them live. Never includes speech or transcripts.
public func voiceTrace(_ message: String) {
  Logger(subsystem: "com.bjarketornager.liftjournal", category: "voice").notice("\(message, privacy: .public)")
  print("[voice \(Date.now.formatted(.dateTime.hour().minute().second()))] \(message)")
}

/// A tool the voice coach asked the app to run.
public struct FunctionCall: Sendable, Equatable {
  public let id: String
  public let name: String
  /// The arguments as JSON, passed through to the server unchanged.
  public let args: [String: JSONValue]
}

/// What a Gemini Live server message means for the call. Mirrors
/// `liveEvents` in lib/voice-live.ts, so both apps treat the stream alike.
/// ElevenLabs' messages become the same events (ElevenLabsProtocol).
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
  /// ElevenLabs only: answer with a pong to keep the call open.
  case ping(Int)
  /// ElevenLabs only: the coach was cut off; this is what it actually said.
  case corrected(String)
  /// ElevenLabs only: the call can't go on, with the reason.
  case failed(String)
  /// ElevenLabs only: the conversation's id, to hand it a photo.
  case conversation(String)
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
  /// silence; the app then prompts the coach to carry on. An offer ("let me
  /// know if you'd like me to draw it") waits for the athlete instead. The
  /// website matches the same (promisesAction in lib/voice-live.ts).
  public static func promisesAction(_ text: String) -> Bool {
    let last = lastSentence(text)
    guard last.firstMatch(of: offer) == nil, last.firstMatch(of: danishOffer) == nil else { return false }
    return last.firstMatch(of: promise) != nil || last.firstMatch(of: danishPromise) != nil
  }

  /// A card promised ("I'll put it on your screen"): writing a whole recipe
  /// or table takes longer than a save, so the nudge waits longer.
  public static func promisesCard(_ text: String) -> Bool {
    promisesAction(text) && lastSentence(text).firstMatch(of: cardWords) != nil
  }

  /// How long the coach has been quiet before it is nudged.
  public static func nudgeAfter(_ text: String) -> Duration {
    promisesCard(text) ? .seconds(6) : .milliseconds(2500)
  }

  /// The last sentence: everything after the final ". ", "? " or "! ".
  private static func lastSentence(_ text: String) -> Substring {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.matches(of: /[.?!]\s+/).last.map { trimmed[$0.range.upperBound...] } ?? trimmed[...]
  }

  nonisolated(unsafe) private static let promise =
    /(?i)\b(let me|i'?ll|i will|i'?m going to|one moment|give me a (second|moment))\b[^.?!]{0,40}\b(check|look|see|find|review|save|log|record|update|get|pull|calculate|sort|fix|add|show|put|draw)/

  /// "Let me check if you slept" is a promise; "let me know if you'd like"
  /// is an offer.
  nonisolated(unsafe) private static let offer =
    /(?i)\b(let me know|if you('d| would)? (like|want|prefer)|would you like|do you want)\b/
  nonisolated(unsafe) private static let danishOffer =
    /(?i)\b(sig til|hvis du (vil|har lyst|ønsker)|vil du have|har du lyst)\b/
  nonisolated(unsafe) private static let cardWords =
    /(?i)\b(show|put|draw|screen|vise|viser|tegne|lægge|skærm)/

  /// The same promise in Danish, for a coach speaking Danish.
  nonisolated(unsafe) private static let danishPromise =
    /(?i)\b(lad mig|jeg skal lige|jeg vil|jeg skal|et øjeblik|et sekund|to sekunder)\b[^.?!]{0,40}\b(tjekke|tjekker|kigge|kigger|se|finde|gemme|gemmer|logge|logger|registrere|opdatere|hente|regne|rette|tilføje|vise|viser|tegne|lægge)/

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
