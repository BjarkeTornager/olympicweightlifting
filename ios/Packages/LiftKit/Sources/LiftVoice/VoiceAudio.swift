import AVFAudio
import Foundation
import os

/// The audio side of a spoken check-in. The microphone runs through Apple's
/// voice processing (echo cancellation, noise suppression, automatic gain),
/// is converted to 16 kHz 16-bit mono PCM and handed over in 100 ms chunks.
/// The coach's 24 kHz replies are queued on a player node. Audio callbacks
/// run on the audio thread, so shared state is guarded by a lock.
public final class VoiceAudio: @unchecked Sendable {
  public static let chunkSamples = 1600

  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let playback = AVAudioFormat(
    commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
  private let capture = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private let lock = OSAllocatedUnfairLock(initialState: State())
  private var converter: AVAudioConverter?
  private var running = false
  private let log = Logger(subsystem: "com.bjarketornager.liftjournal", category: "voice")

  private struct State {
    var pending: [Int16] = []
    var scheduled = 0
    var generation = 0
    var coachLevel: Float = 0
    var micLevel: Float = 0
    var muted = false
  }

  /// A 100 ms chunk of microphone audio, called on the audio thread.
  public var onChunk: (@Sendable ([Int16]) -> Void)?
  /// Called when the coach starts or stops being audible.
  public var onSpeaking: (@Sendable (Bool) -> Void)?

  public init() {}

  public var coachSpeaking: Bool { lock.withLock { $0.scheduled > 0 } }
  public var coachLevel: Float { lock.withLock { $0.scheduled > 0 ? $0.coachLevel : 0 } }
  public var micLevel: Float { lock.withLock { $0.muted ? 0 : $0.micLevel } }
  public var muted: Bool {
    get { lock.withLock { $0.muted } }
    set { lock.withLock { $0.muted = newValue } }
  }

  public func start() throws {
    guard !running else { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord, mode: .voiceChat,
      options: [.defaultToSpeaker, .allowBluetoothHFP, .duckOthers])
    try session.setActive(true)

    let input = engine.inputNode
    try input.setVoiceProcessingEnabled(true)
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playback)
    let format = input.outputFormat(forBus: 0)
    converter = AVAudioConverter(from: format, to: capture)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.captured(buffer)
    }
    engine.prepare()
    try engine.start()
    player.play()
    running = true
  }

  public func stop() {
    guard running else { return }
    running = false
    engine.inputNode.removeTap(onBus: 0)
    player.stop()
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    lock.withLock { $0 = State() }
  }

  /// After an interruption (a phone call, Siri), audio starts again.
  public func restart() throws {
    guard running, !engine.isRunning else { return }
    try AVAudioSession.sharedInstance().setActive(true)
    try engine.start()
    player.play()
  }

  // MARK: Playback

  /// Queue 16-bit little-endian PCM at 24 kHz from the coach.
  public func play(_ pcm: Data) {
    let count = pcm.count / 2
    guard running, count > 0,
      let buffer = AVAudioPCMBuffer(pcmFormat: playback, frameCapacity: AVAudioFrameCount(count)),
      let out = buffer.floatChannelData?[0]
    else { return }
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
  }

  /// The athlete talked over the coach: drop what is still queued.
  public func interrupt() {
    lock.withLock { state in
      state.generation += 1
      state.scheduled = 0
    }
    player.stop()
    if running { player.play() }
    onSpeaking?(false)
  }

  // MARK: Capture

  private func captured(_ buffer: AVAudioPCMBuffer) {
    guard let converter else { return }
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
    guard error == nil, let data = output.int16ChannelData?[0], output.frameLength > 0 else {
      return
    }
    let samples = Array(UnsafeBufferPointer(start: data, count: Int(output.frameLength)))
    let chunks = lock.withLock { state -> [[Int16]] in
      state.micLevel = state.micLevel * 0.6 + BargeInGate.level(samples) * 0.4
      if state.muted {
        state.pending = []
        return []
      }
      state.pending += samples
      var ready: [[Int16]] = []
      while state.pending.count >= Self.chunkSamples {
        ready.append(Array(state.pending.prefix(Self.chunkSamples)))
        state.pending.removeFirst(Self.chunkSamples)
      }
      return ready
    }
    for chunk in chunks { onChunk?(chunk) }
  }
}
