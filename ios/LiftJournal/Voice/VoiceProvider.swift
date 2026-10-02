import Foundation
import LiftAPI

/// Who runs spoken check-ins: Google's Gemini Live, one model that listens
/// and speaks, or ElevenLabs, whose Eleven v4 Turbo voice speaks what Gemini
/// 3.8 Flash decides. Chosen in Profile and kept on this iPhone; the server
/// says which it has set up.
enum VoiceProvider: String, CaseIterable, Identifiable {
  case google, elevenlabs

  static let key = "voiceProvider"

  var id: Self { self }

  var title: String {
    switch self {
    case .google: "Google"
    case .elevenlabs: "ElevenLabs"
    }
  }

  /// Shown under the choice in Profile.
  var detail: String {
    switch self {
    case .google:
      "Gemini Live listens and speaks in one model: the quickest replies, and it can look at food photos you take in the call."
    case .elevenlabs:
      "ElevenLabs' Eleven v4 Turbo voice, with Gemini 3.8 Flash deciding what to say. It can't see photos, so it asks what's on the plate. ElevenLabs keeps no recording of the call."
    }
  }

  /// Where the voice picked for this provider is kept.
  var voiceKey: String { "voice.\(rawValue)" }

  /// The voice picked in Profile, if this server still offers it; nil means
  /// the server's default.
  func chosenVoice(in options: [Components.Schemas.VoiceOption]) -> String? {
    guard let id = UserDefaults.standard.string(forKey: voiceKey),
      options.contains(where: { $0.provider == rawValue && $0.id == id })
    else { return nil }
    return id
  }

  /// The name of the voice a call with this provider uses.
  func voiceName(in options: [Components.Schemas.VoiceOption]) -> String? {
    let mine = options.filter { $0.provider == rawValue }
    let id = chosenVoice(in: options)
    return (mine.first { $0.id == id } ?? mine.first { $0.isDefault })?.name
  }

  /// The choice made in Profile, if this server offers it; otherwise the
  /// first it does.
  static func current(offered: [VoiceProvider]) -> VoiceProvider {
    let chosen = UserDefaults.standard.string(forKey: key).flatMap(VoiceProvider.init) ?? .google
    return offered.contains(chosen) ? chosen : offered.first ?? .google
  }
}
