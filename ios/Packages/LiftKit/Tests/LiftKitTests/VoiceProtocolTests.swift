import Foundation
import Testing

@testable import LiftVoice

@Suite("Voice check-in protocol")
struct VoiceProtocolTests {
  @Test("Live messages become the same events as on the website")
  func events() {
    let pcm = Data([0x01, 0x00, 0xFF, 0x7F]).base64EncodedString()
    let message = """
      {"serverContent":{"modelTurn":{"parts":[{"inlineData":{"data":"\(pcm)"}}]},
      "inputTranscription":{"text":"I ran 5 k"},"outputTranscription":{"text":"Nice."},
      "interrupted":true,"turnComplete":true},
      "toolCall":{"functionCalls":[{"id":"c1","name":"log_activity","args":{"distance_km":5,"kind":"run"}}]},
      "sessionResumptionUpdate":{"newHandle":"h1","resumable":true}}
      """
    let events = LiveProtocol.events(Data(message.utf8))
    #expect(events.contains(.interrupted))
    #expect(events.contains(.heard("I ran 5 k")))
    #expect(events.contains(.said("Nice.")))
    #expect(events.contains(.turnComplete))
    #expect(events.contains(.resumeHandle("h1")))
    #expect(events.contains(.audio(Data([0x01, 0x00, 0xFF, 0x7F]))))
    guard case .toolCall(let calls) = events.first(where: { if case .toolCall = $0 { true } else { false } })
    else {
      Issue.record("no tool call")
      return
    }
    #expect(calls.first?.name == "log_activity")
    #expect(calls.first?.args["kind"] == .string("run"))
    #expect(LiveProtocol.events(Data(#"{"setupComplete":{}}"#.utf8)) == [.ready])
    #expect(LiveProtocol.events(Data(#"{"goAway":{"timeLeft":"10s"}}"#.utf8)) == [.goAway])
  }

  @Test("A promise without an action is noticed, as on the website")
  func promises() {
    #expect(LiveProtocol.promisesAction("Great. Let me check your sleep."))
    #expect(LiveProtocol.promisesAction("One moment, I'll look that up"))
    #expect(!LiveProtocol.promisesAction("Let me check your sleep. You slept 7 hours."))
    #expect(!LiveProtocol.promisesAction("How was training?"))
  }

  @Test("Background noise is silenced while the coach speaks; real speech gets through whole")
  func gate() {
    var gate = BargeInGate()
    let quiet = [Int16](repeating: 100, count: 1600)
    let loud = [Int16](repeating: 12000, count: 1600)
    #expect(gate.pass(quiet, coachSpeaking: false, coachLevel: 0) == [quiet])
    // Noise while the coach speaks becomes silence.
    #expect(gate.pass(quiet, coachSpeaking: true, coachLevel: 0.3).first?.allSatisfy { $0 == 0 } == true)
    // Speech must last three chunks; then all three are sent, not clipped.
    _ = gate.pass(loud, coachSpeaking: true, coachLevel: 0.1)
    _ = gate.pass(loud, coachSpeaking: true, coachLevel: 0.1)
    #expect(gate.pass(loud, coachSpeaking: true, coachLevel: 0.1) == [loud, loud, loud])
    #expect(gate.pass(quiet, coachSpeaking: true, coachLevel: 0.1) == [quiet])
  }

  @Test func audioMessage() throws {
    let message = LiveProtocol.audio([1, -1])
    let input = try #require(message["realtimeInput"] as? [String: Any])
    let audio = try #require(input["audio"] as? [String: String])
    #expect(audio["mimeType"] == "audio/pcm;rate=16000")
    #expect(Data(base64Encoded: audio["data"]!) == Data([0x01, 0x00, 0xFF, 0xFF]))
  }
}
