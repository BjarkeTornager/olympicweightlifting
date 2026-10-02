import Foundation
import Testing

@testable import LiftVoice

@Suite("ElevenLabs voice protocol")
struct ElevenLabsProtocolTests {
  func events(_ json: String) -> [LiveEvent] { ElevenLabsProtocol.events(Data(json.utf8)) }

  @Test("ElevenLabs messages become the same events as Gemini's")
  func mapping() {
    #expect(
      events(
        #"{"type":"conversation_initiation_metadata","conversation_initiation_metadata_event":{"conversation_id":"c","agent_output_audio_format":"pcm_24000","user_input_audio_format":"pcm_16000"}}"#
      ) == [.conversation("c"), .ready])
    let pcm = Data([0x01, 0x00, 0xFF, 0x7F])
    #expect(
      events(#"{"type":"audio","audio_event":{"audio_base_64":"\#(pcm.base64EncodedString())","event_id":3}}"#)
        == [.audio(pcm)])
    #expect(
      events(#"{"type":"user_transcript","user_transcription_event":{"user_transcript":"I slept seven hours"}}"#)
        == [.heard("I slept seven hours")])
    #expect(
      events(#"{"type":"agent_response","agent_response_event":{"agent_response":"Nice. Saving it."}}"#)
        == [.said("Nice. Saving it."), .turnComplete])
    #expect(
      events(
        #"{"type":"agent_response_correction","agent_response_correction_event":{"original_agent_response":"Nice. Saving it.","corrected_agent_response":"Nice."}}"#
      ) == [.corrected("Nice.")])
    #expect(events(#"{"type":"interruption","interruption_event":{"event_id":4}}"#) == [.interrupted])
    #expect(events(#"{"type":"ping","ping_event":{"event_id":9,"ping_ms":40}}"#) == [.ping(9)])
    #expect(events(#"{"type":"vad_score","vad_score_event":{"vad_score":0.9}}"#).isEmpty)
    // Silence transcribed as dots isn't a line from the athlete.
    #expect(events(#"{"type":"user_transcript","user_transcription_event":{"user_transcript":"..."}}"#).isEmpty)
    #expect(events(#"{"type":"user_transcript","user_transcription_event":{"user_transcript":" … "}}"#).isEmpty)
    #expect(
      events(#"{"type":"user_transcript","user_transcription_event":{"user_transcript":"Ja."}}"#) == [.heard("Ja.")])
    #expect(events("not json").isEmpty)
  }

  @Test("Acting cues shape the voice but stay out of the transcript")
  func actingCues() {
    #expect(
      events(#"{"type":"agent_response","agent_response_event":{"agent_response":"[happy] Seven and a half hours, logged!"}}"#)
        == [.said("Seven and a half hours, logged!"), .turnComplete])
    #expect(
      ElevenLabsProtocol.spoken("Alright, [happy] sounds good! [excited] Keep up the great work [laughs] .")
        == "Alright, sounds good! Keep up the great work.")
    #expect(ElevenLabsProtocol.spoken("70 kg [x2], then 72") == "70 kg [x2], then 72")
    #expect(events(#"{"type":"agent_response","agent_response_event":{"agent_response":"[sighs]"}}"#).isEmpty)
    #expect(
      events(
        #"{"type":"agent_response_correction","agent_response_correction_event":{"corrected_agent_response":"[happy] Seven and"}}"#
      ) == [.corrected("Seven and")])
  }

  @Test("Tool arguments reach the server with their own names")
  func toolCall() {
    let received = events(
      #"{"type":"client_tool_call","client_tool_call":{"tool_name":"log_training","tool_call_id":"t1","parameters":{"summary":"Snatch","exercises":[{"exercise":"snatch","sets":[{"weight_kg":70,"reps":2,"made":true}]}]},"event_id":5,"expects_response":true}}"#
    )
    guard case .toolCall(let calls) = received.first, let call = calls.first else {
      Issue.record("no tool call")
      return
    }
    #expect(call.id == "t1" && call.name == "log_training")
    guard case .array(let exercises) = call.args["exercises"], case .object(let exercise) = exercises.first,
      case .array(let sets) = exercise["sets"], case .object(let set) = sets.first
    else {
      Issue.record("arguments changed shape")
      return
    }
    #expect(set["weight_kg"] == .number(70))
  }

  @Test("A voice in another audio format, or an error, ends the call with a reason")
  func failures() {
    let other = events(
      #"{"type":"conversation_initiation_metadata","conversation_initiation_metadata_event":{"agent_output_audio_format":"pcm_16000"}}"#
    )
    guard case .failed(let reason) = other.first else {
      Issue.record("played audio at the wrong rate")
      return
    }
    #expect(reason.contains("pcm_16000"))
    #expect(
      events(#"{"type":"client_error","error_event":{"code":1008,"error_name":"quota_exceeded","message":"Quota exceeded"}}"#)
        == [.failed("Quota exceeded")])
    #expect(ElevenLabsProtocol.isCreditError("This request exceeds your quota"))
    #expect(!ElevenLabsProtocol.isCreditError("The voice connection closed."))
  }

  @Test("Tool results go back as text, since ElevenLabs ends the call on an object")
  func toolResults() throws {
    let call = FunctionCall(id: "t1", name: "log_sleep", args: [:])
    let saved = ElevenLabsProtocol.toolResult(call, ["result": ["saved": "Sleep", "save_id": "s1"]])
    #expect(saved["type"] as? String == "client_tool_result")
    #expect(saved["tool_call_id"] as? String == "t1")
    #expect(saved["is_error"] as? Bool == false)
    #expect(saved["result"] as? String == #"{"save_id":"s1","saved":"Sleep"}"#)
    let failed = ElevenLabsProtocol.toolResult(call, ["error": "The date is in the future."])
    #expect(failed["result"] as? String == "The date is in the future.")
    #expect(failed["is_error"] as? Bool == true)
    let plain = ElevenLabsProtocol.toolResult(call, ["result": "The camera is open."])
    #expect(plain["result"] as? String == "The camera is open.")
  }

  @Test("A photo goes to the coach as a message with the file the server handed over")
  func photo() throws {
    let message = ElevenLabsProtocol.photo("(The athlete took a food photo.)", fileID: "file_9")
    #expect(message["type"] as? String == "multimodal_message")
    let text = try #require(message["text"] as? [String: Any])
    #expect(text["type"] as? String == "user_message")
    #expect(text["text"] as? String == "(The athlete took a food photo.)")
    let files = try #require(message["files"] as? [[String: Any]])
    #expect(files.first?["type"] as? String == "file_input")
    #expect(files.first?["file_id"] as? String == "file_9")
  }

  @Test("Audio and notes go out in ElevenLabs' shapes")
  func outgoing() {
    let chunk = ElevenLabsProtocol.audio([1, -1])
    #expect(chunk["user_audio_chunk"] as? String == Data([0x01, 0x00, 0xFF, 0xFF]).base64EncodedString())
    #expect(ElevenLabsProtocol.userMessage("(The athlete started the call.)")["type"] as? String == "user_message")
    #expect(ElevenLabsProtocol.context("(Apple Health added sleep.)")["type"] as? String == "contextual_update")
    #expect(ElevenLabsProtocol.pong(9)["event_id"] as? Int == 9)
  }
}
