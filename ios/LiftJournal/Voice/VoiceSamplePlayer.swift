import AVFAudio
import Foundation
import LiftAPI
import LiftVoice
import Observation

/// Plays a voice's short sample when it's picked, like choosing a ringtone:
/// a new pick stops the last. Samples are small files the server hosts,
/// recorded through the same setup a call uses, and kept for the session.
@MainActor
@Observable
final class VoiceSamplePlayer {
  /// The voice whose sample is loading or playing.
  private(set) var playing: String?
  private var player: AVAudioPlayer?
  private var cache: [URL: Data] = [:]
  private var task: Task<Void, Never>?

  func play(_ option: Components.Schemas.VoiceOption, language: CoachLanguage) {
    stop()
    let path = language == .da ? option.samples?.da ?? option.samples?.en : option.samples?.en
    guard let path else { return }
    let url = LiftServer.origin.appending(path: path.hasPrefix("/") ? String(path.dropFirst()) : path)
    playing = option.id
    task = Task { [weak self] in
      guard let self else { return }
      do {
        let data: Data
        if let cached = cache[url] {
          data = cached
        } else {
          let (body, response) = try await URLSession.shared.data(from: url)
          guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
          data = body
          cache[url] = data
        }
        try Task.checkCancellation()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try session.setActive(true)
        let player = try AVAudioPlayer(data: data)
        self.player = player
        let started = player.play()
        voiceTrace("sample \(url.lastPathComponent): \(started ? "playing" : "not started"), \(String(format: "%.1f", player.duration)) s")
        try await Task.sleep(for: .seconds(player.duration + 0.2))
        finish()
      } catch {
        if !(error is CancellationError) {
          voiceTrace("sample \(url.lastPathComponent) failed: \(error.localizedDescription)")
          finish()
        }
      }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
    player?.stop()
    player = nil
    if playing != nil { finish() }
  }

  private func finish() {
    playing = nil
    player = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
