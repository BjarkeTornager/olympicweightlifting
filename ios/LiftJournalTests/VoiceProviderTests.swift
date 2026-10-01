import Foundation
import Testing

@testable import LiftJournal

@Suite("Voice provider", .serialized)
struct VoiceProviderTests {
  @Test("The voice chosen in Profile is used while the server offers it, and Google otherwise")
  func choice() {
    let defaults = UserDefaults.standard
    let saved = defaults.string(forKey: VoiceProvider.key)
    defer { defaults.set(saved, forKey: VoiceProvider.key) }

    defaults.removeObject(forKey: VoiceProvider.key)
    #expect(VoiceProvider.current(offered: [.google, .elevenlabs]) == .google)
    defaults.set("elevenlabs", forKey: VoiceProvider.key)
    #expect(VoiceProvider.current(offered: [.google, .elevenlabs]) == .elevenlabs)
    // The server stopped offering it (its key was removed): back to Google.
    #expect(VoiceProvider.current(offered: [.google]) == .google)
    // A server with only ElevenLabs runs every call there.
    defaults.set("google", forKey: VoiceProvider.key)
    #expect(VoiceProvider.current(offered: [.elevenlabs]) == .elevenlabs)
  }
}
