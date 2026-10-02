import Foundation

/// What an ElevenLabs agent's message means for the call, as the same events
/// Gemini Live's become, so one call runs either. Reads only what the app's
/// agent is set to send (lib/voice-elevenlabs.ts).
public enum ElevenLabsProtocol {
  /// The agent speaks 24 kHz PCM, like Gemini: the player takes nothing else.
  public static let outputFormat = "pcm_24000"

  public static func events(_ data: Data) -> [LiveEvent] {
    // Explicit keys, not convertFromSnakeCase: that would also rename the
    // tool arguments (weight_kg → weightKg) the server reads.
    guard let message = try? JSONDecoder().decode(Message.self, from: data) else { return [] }
    switch message.type {
    case "conversation_initiation_metadata":
      let metadata = message.conversationInitiationMetadataEvent
      let conversation = metadata?.conversationId.map { [LiveEvent.conversation($0)] } ?? []
      guard let format = metadata?.agentOutputAudioFormat, format != outputFormat else {
        return conversation + [.ready]
      }
      return [.failed("The ElevenLabs voice sends audio this app can't play (\(format)).")]
    case "audio":
      guard let base64 = message.audioEvent?.audioBase64, let audio = Data(base64Encoded: base64) else { return [] }
      return [.audio(audio)]
    case "user_transcript":
      // Silence or noise comes through as "..." or "…": not something said.
      let text = message.userTranscriptionEvent?.userTranscript ?? ""
      return text.contains(where: { $0.isLetter || $0.isNumber }) ? [.heard(text)] : []
    case "agent_response":
      // The whole reply at once, as it starts playing.
      let text = spoken(message.agentResponseEvent?.agentResponse ?? "")
      return text.isEmpty ? [] : [.said(text), .turnComplete]
    case "agent_response_correction":
      // Cut off: what was actually said before the athlete spoke.
      guard let text = message.agentResponseCorrectionEvent?.correctedAgentResponse else { return [] }
      return [.corrected(spoken(text))]
    case "interruption":
      return [.interrupted]
    case "client_tool_call":
      guard let call = message.clientToolCall else { return [] }
      return [.toolCall([FunctionCall(id: call.toolCallId, name: call.toolName, args: call.parameters ?? [:])])]
    case "ping":
      return message.pingEvent.map { [.ping($0.eventId)] } ?? []
    case "client_error":
      let error = message.errorEvent
      return [.failed(error?.message ?? error?.errorName ?? "ElevenLabs ended the call.")]
    default:
      return []
    }
  }

  /// The reply as heard: v4 voices take acting cues such as "[happy]" or
  /// "[laughs]" that shape the voice but aren't spoken, so the transcript
  /// leaves them out.
  public static func spoken(_ text: String) -> String {
    text.replacing(/\[[A-Za-z][A-Za-z ]{0,30}\]/, with: "")
      .replacing(/\ {2,}/, with: " ")
      .replacing(/\ ([,.!?])/, with: { "\($0.output.1)" })
      .trimmingCharacters(in: .whitespaces)
  }

  // MARK: Messages the app sends

  public static func audio(_ pcm: [Int16]) -> [String: Any] {
    ["user_audio_chunk": pcm.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString()]
  }

  /// A note the coach answers, such as "(The athlete started the call.)".
  public static func userMessage(_ text: String) -> [String: Any] {
    ["type": "user_message", "text": text]
  }

  /// A photo handed to the conversation (by the server, which returns its
  /// file id), with a note the coach answers.
  public static func photo(_ text: String, fileID: String) -> [String: Any] {
    [
      "type": "multimodal_message",
      "text": ["type": "user_message", "text": text],
      "files": [["type": "file_input", "file_id": fileID]],
    ]
  }

  /// Something the coach should know without replying to it now.
  public static func context(_ text: String) -> [String: Any] {
    ["type": "contextual_update", "text": text]
  }

  public static func pong(_ eventID: Int) -> [String: Any] {
    ["type": "pong", "event_id": eventID]
  }

  /// A tool's outcome, in the shape the Gemini call builds (`result` or
  /// `error`). ElevenLabs takes it as text: an object ends the conversation.
  public static func toolResult(_ call: FunctionCall, _ response: [String: Any]) -> [String: Any] {
    let error = response["error"] as? String
    let value = error ?? response["result"] ?? response
    let text =
      (value as? String)
      ?? (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
      .map { String(decoding: $0, as: UTF8.self) } ?? ""
    return ["type": "client_tool_result", "tool_call_id": call.id, "result": text, "is_error": error != nil]
  }

  public static let creditMessage =
    "Voice is paused because the ElevenLabs credit has run out. Switch to Google in Profile, or keep typing to Coach."
  public static func isCreditError(_ message: String) -> Bool {
    message.range(of: "quota|credit|insufficient|payment", options: [.regularExpression, .caseInsensitive]) != nil
  }
}

private struct Message: Decodable {
  struct Metadata: Decodable {
    let agentOutputAudioFormat: String?
    let conversationId: String?
    enum CodingKeys: String, CodingKey {
      case agentOutputAudioFormat = "agent_output_audio_format", conversationId = "conversation_id"
    }
  }
  struct Audio: Decodable {
    let audioBase64: String?
    enum CodingKeys: String, CodingKey { case audioBase64 = "audio_base_64" }
  }
  struct Transcript: Decodable {
    let userTranscript: String?
    enum CodingKeys: String, CodingKey { case userTranscript = "user_transcript" }
  }
  struct Response: Decodable {
    let agentResponse: String?
    enum CodingKeys: String, CodingKey { case agentResponse = "agent_response" }
  }
  struct Correction: Decodable {
    let correctedAgentResponse: String?
    enum CodingKeys: String, CodingKey { case correctedAgentResponse = "corrected_agent_response" }
  }
  struct ToolCall: Decodable {
    let toolName: String
    let toolCallId: String
    let parameters: [String: JSONValue]?
    enum CodingKeys: String, CodingKey {
      case toolName = "tool_name", toolCallId = "tool_call_id", parameters
    }
  }
  struct Ping: Decodable {
    let eventId: Int
    enum CodingKeys: String, CodingKey { case eventId = "event_id" }
  }
  struct Failure: Decodable {
    let errorName: String?
    let message: String?
    enum CodingKeys: String, CodingKey { case errorName = "error_name", message }
  }

  let type: String
  let conversationInitiationMetadataEvent: Metadata?
  let audioEvent: Audio?
  let userTranscriptionEvent: Transcript?
  let agentResponseEvent: Response?
  let agentResponseCorrectionEvent: Correction?
  let clientToolCall: ToolCall?
  let pingEvent: Ping?
  let errorEvent: Failure?

  enum CodingKeys: String, CodingKey {
    case type
    case conversationInitiationMetadataEvent = "conversation_initiation_metadata_event"
    case audioEvent = "audio_event"
    case userTranscriptionEvent = "user_transcription_event"
    case agentResponseEvent = "agent_response_event"
    case agentResponseCorrectionEvent = "agent_response_correction_event"
    case clientToolCall = "client_tool_call"
    case pingEvent = "ping_event"
    case errorEvent = "error_event"
  }
}
