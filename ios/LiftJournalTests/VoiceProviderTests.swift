import Foundation
import LiftAPI
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

  @Test("A picked voice is used while offered; otherwise the server's default is named")
  func voices() {
    let defaults = UserDefaults.standard
    let key = VoiceProvider.elevenlabs.voiceKey
    let saved = defaults.string(forKey: key)
    defer { defaults.set(saved, forKey: key) }
    let options: [Components.Schemas.VoiceOption] = [
      .init(provider: "elevenlabs", id: "eric", name: "Eric", detail: "Male", isDefault: true),
      .init(provider: "elevenlabs", id: "sarah", name: "Sarah", detail: "Female", isDefault: false),
      .init(provider: "google", id: "Kore", name: "Kore", detail: "Female", isDefault: false),
    ]
    defaults.removeObject(forKey: key)
    #expect(VoiceProvider.elevenlabs.chosenVoice(in: options) == nil)
    #expect(VoiceProvider.elevenlabs.voiceName(in: options) == "Eric")
    defaults.set("sarah", forKey: key)
    #expect(VoiceProvider.elevenlabs.chosenVoice(in: options) == "sarah")
    #expect(VoiceProvider.elevenlabs.voiceName(in: options) == "Sarah")
    // Another provider's voice, or one the server dropped, isn't sent.
    defaults.set("Kore", forKey: key)
    #expect(VoiceProvider.elevenlabs.chosenVoice(in: options) == nil)
    #expect(VoiceProvider.elevenlabs.voiceName(in: options) == "Eric")
  }

  @Test("Coach's language is the one chosen, or the iPhone's when it's Danish")
  func language() {
    let defaults = UserDefaults.standard
    let saved = defaults.string(forKey: CoachLanguage.key)
    defer { defaults.set(saved, forKey: CoachLanguage.key) }
    defaults.removeObject(forKey: CoachLanguage.key)
    #expect(CoachLanguage.current == CoachLanguage.deviceDefault)
    defaults.set("da", forKey: CoachLanguage.key)
    #expect(CoachLanguage.current == .da)
    defaults.set("klingon", forKey: CoachLanguage.key)
    #expect(CoachLanguage.current == CoachLanguage.deviceDefault)
  }
}
