import Foundation

/// While the coach is speaking, background noise, distant voices and the
/// coach's own voice echoing from the speaker must not interrupt it. The
/// microphone is let through only when sound stands clearly above both the
/// room's noise floor and the coach's current output level for about a third
/// of a second, like someone speaking to the phone; otherwise the model hears
/// silence. The start of that speech is kept, not clipped. When the coach is
/// quiet, everything passes. A port of `createBargeInGate` in lib/voice-live.ts.
public struct BargeInGate: Sendable {
  var holdChunks = 3
  var ratio: Float = 3
  var minLevel: Float = 0.02
  var echoRatio: Float = 0.6
  private var floor: Float = 0.005
  private var loud: [[Int16]] = []
  private var open = false

  public init() {}

  public static func level(_ pcm: [Int16]) -> Float {
    guard !pcm.isEmpty else { return 0 }
    var sum: Float = 0
    for x in pcm {
      let v = Float(x) / 32768
      sum += v * v
    }
    return (sum / Float(pcm.count)).squareRoot()
  }

  /// The chunks to send for this microphone chunk.
  public mutating func pass(_ pcm: [Int16], coachSpeaking: Bool, coachLevel: Float) -> [[Int16]] {
    let rms = Self.level(pcm)
    if !coachSpeaking {
      // Learn the room's background level while nobody is being gated.
      floor = floor * 0.95 + min(rms, 0.2) * 0.05
      open = false
      loud = []
      return [pcm]
    }
    if open { return [pcm] }
    if rms > max(minLevel, floor * ratio, coachLevel * echoRatio) {
      loud.append(pcm)
      if loud.count >= holdChunks {
        open = true
        defer { loud = [] }
        return loud
      }
    } else {
      loud = []
    }
    return [[Int16](repeating: 0, count: pcm.count)]
  }
}
