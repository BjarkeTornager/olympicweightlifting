import AVFAudio
import Foundation
import os

/// The audio side of a spoken check-in. The microphone runs through Apple's
/// voice processing (echo cancellation, noise suppression, automatic gain),
/// is converted to 16 kHz 16-bit mono PCM and handed over in 100 ms chunks.
/// The coach's 24 kHz replies are queued on a player node.
///
/// On a real iPhone, switching the session to voice chat and turning on voice
/// processing makes the hardware reconfigure shortly after the engine starts,
/// which stops the engine without an error: no sound either way. So the engine
/// is created only after the session is active, and rebuilt whenever iOS
/// reports a configuration change, an interruption or a media-services reset.
/// Audio callbacks run on the audio thread; shared state is behind a lock.
public final class VoiceAudio: @unchecked Sendable {
  public static let chunkSamples = 1600

  private let playback = AVAudioFormat(
    commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
  private let capture = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private let lock = OSAllocatedUnfairLock(initialState: State())
  private let log = Logger(subsystem: "com.bjarketornager.liftjournal", category: "voice")

  // Touched only on the main thread.
  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var converter: AVAudioConverter?
  private var observers: [any NSObjectProtocol] = []
  private var running = false

  private struct State {
    var pending: [Int16] = []
    var scheduled = 0
    var generation = 0
    var coachLevel: Float = 0
    var micLevel: Float = 0
    var muted = false
    var chunks = 0
  }

  /// A 100 ms chunk of microphone audio, called on the audio thread.
  public var onChunk: (@Sendable ([Int16]) -> Void)?
  /// Called when the coach starts or stops being audible.
  public var onSpeaking: (@Sendable (Bool) -> Void)?
  /// Called when audio could not be restarted after iOS stopped it.
  public var onFailure: (@Sendable (String) -> Void)?

  public init() {}

  public var coachSpeaking: Bool { lock.withLock { $0.scheduled > 0 } }
  public var coachLevel: Float { lock.withLock { $0.scheduled > 0 ? $0.coachLevel : 0 } }
  public var micLevel: Float { lock.withLock { $0.muted ? 0 : $0.micLevel } }
  public var muted: Bool {
    get { lock.withLock { $0.muted } }
    set { lock.withLock { $0.muted = newValue } }
  }

  @MainActor
  public func start() throws {
    guard !running else { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true)
    try build()
    running = true
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) {
        [weak self] note in
        let changed = (note.object as? AVAudioEngine).map(ObjectIdentifier.init)
        MainActor.assumeIsolated {
          guard let self, changed == self.engine.map(ObjectIdentifier.init) else { return }
          self.log.notice("Audio configuration changed; restarting")
          self.rebuild()
        }
      },
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated {
          self?.log.notice("Media services were reset; restarting")
          self?.rebuild()
        }
      },
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) {
        [weak self] note in
        let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
          .flatMap(AVAudioSession.InterruptionType.init)
        MainActor.assumeIsolated {
          guard type == .ended else { return }
          self?.log.notice("Audio interruption ended; restarting")
          self?.rebuild()
        }
      },
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated { self?.preferSpeaker() }
      },
    ]
  }

  @MainActor
  public func stop() {
    guard running else { return }
    running = false
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    tearDown()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    lock.withLock { $0 = State() }
  }

  /// After an interruption (a phone call, Siri), audio starts again.
  @MainActor
  public func restart() {
    rebuild()
  }

  @MainActor
  private func build() throws {
    let engine = AVAudioEngine()
    let input = engine.inputNode
    try input.setVoiceProcessingEnabled(true)
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playback)
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0,
      let converter = AVAudioConverter(from: format, to: capture)
    else {
      throw VoiceAudioError("The microphone isn't available right now.")
    }
    // Voice processing can report several microphone channels.
    if format.channelCount > 1 { converter.downmix = true }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.captured(buffer)
    }
    engine.prepare()
    try engine.start()
    player.play()
    self.engine = engine
    self.player = player
    self.converter = converter
    preferSpeaker()
    log.notice(
      "Audio started: mic \(format.sampleRate, privacy: .public) Hz × \(format.channelCount, privacy: .public), output \(engine.outputNode.outputFormat(forBus: 0).sampleRate, privacy: .public) Hz"
    )
  }

  @MainActor
  private func tearDown() {
    if let engine {
      engine.inputNode.removeTap(onBus: 0)
      player?.stop()
      engine.stop()
    }
    engine = nil
    player = nil
    converter = nil
    // Anything queued for the old engine will never play.
    let wasSpeaking = lock.withLock { state -> Bool in
      state.generation += 1
      defer { state.scheduled = 0 }
      state.pending = []
      return state.scheduled > 0
    }
    if wasSpeaking { onSpeaking?(false) }
  }

  @MainActor
  private func rebuild() {
    guard running else { return }
    tearDown()
    do {
      try AVAudioSession.sharedInstance().setActive(true)
      try build()
    } catch {
      log.error("Audio restart failed: \(error.localizedDescription, privacy: .public)")
      onFailure?("The iPhone's audio stopped and could not restart. End the call and try again.")
    }
  }

  /// Out of the loudspeaker unless headphones, AirPods or a car are connected.
  @MainActor
  private func preferSpeaker() {
    let session = AVAudioSession.sharedInstance()
    let outputs = session.currentRoute.outputs.map(\.portType)
    if outputs.allSatisfy({ $0 == .builtInReceiver }) {
      try? session.overrideOutputAudioPort(.speaker)
    }
  }

  // MARK: Playback

  /// Queue 16-bit little-endian PCM at 24 kHz from the coach.
  @MainActor
  public func play(_ pcm: Data) {
    let count = pcm.count / 2
    guard running, count > 0, let player, let engine, engine.isRunning,
      let buffer = AVAudioPCMBuffer(pcmFormat: playback, frameCapacity: AVAudioFrameCount(count)),
      let out = buffer.floatChannelData?[0]
    else {
      if running, engine?.isRunning == false {
        log.notice("Audio engine not running while the coach speaks; restarting")
        rebuild()
      }
      return
    }
    buffer.frameLength = AVAudioFrameCount(count)
    var energy: Float = 0
    pcm.withUnsafeBytes { raw in
      let samples = raw.bindMemory(to: Int16.self)
      for i in 0..<count {
        let value = Float(Int16(littleEndian: samples[i])) / 32768
        out[i] = value
        energy += value * value
      }
    }
    let level = (energy / Float(count)).squareRoot()
    let (generation, started) = lock.withLock { state in
      state.scheduled += 1
      state.coachLevel = level
      return (state.generation, state.scheduled == 1)
    }
    if started { onSpeaking?(true) }
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self else { return }
      let finished = self.lock.withLock { state -> Bool in
        guard state.generation == generation, state.scheduled > 0 else { return false }
        state.scheduled -= 1
        return state.scheduled == 0
      }
      if finished { self.onSpeaking?(false) }
    }
    if !player.isPlaying { player.play() }
  }

  /// The athlete talked over the coach: drop what is still queued.
  @MainActor
  public func interrupt() {
    lock.withLock { state in
      state.generation += 1
      state.scheduled = 0
    }
    player?.stop()
    if running { player?.play() }
    onSpeaking?(false)
  }

  // MARK: Capture

  private func captured(_ buffer: AVAudioPCMBuffer) {
    // The converter is replaced only after this tap is removed.
    guard let converter = unsafeConverter() else { return }
    let ratio = capture.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
    guard let output = AVAudioPCMBuffer(pcmFormat: capture, frameCapacity: capacity) else { return }
    var supplied = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if supplied {
        status.pointee = .noDataNow
        return nil
      }
      supplied = true
      status.pointee = .haveData
      return buffer
    }
    if let error {
      log.error("Microphone conversion failed: \(error.localizedDescription, privacy: .public)")
      return
    }
    guard let data = output.int16ChannelData?[0], output.frameLength > 0 else { return }
    let samples = Array(UnsafeBufferPointer(start: data, count: Int(output.frameLength)))
    let (chunks, first) = lock.withLock { state -> ([[Int16]], Bool) in
      state.micLevel = state.micLevel * 0.6 + BargeInGate.level(samples) * 0.4
      if state.muted {
        state.pending = []
        return ([], false)
      }
      state.pending += samples
      var ready: [[Int16]] = []
      while state.pending.count >= Self.chunkSamples {
        ready.append(Array(state.pending.prefix(Self.chunkSamples)))
        state.pending.removeFirst(Self.chunkSamples)
      }
      state.chunks += ready.count
      return (ready, state.chunks == ready.count && !ready.isEmpty)
    }
    if first { log.notice("Microphone audio is flowing") }
    for chunk in chunks { onChunk?(chunk) }
  }

  private func unsafeConverter() -> AVAudioConverter? {
    // Read from the audio thread; written on the main thread only while no
    // tap is installed, so it is never read mid-write.
    nonisolated(unsafe) let current = converter
    return current
  }
}

public struct VoiceAudioError: LocalizedError {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}
