import SwiftUI

/// How a meter is counted: one mark is one fixed amount (100 kcal, 10 g of
/// protein, one 250 ml glass). The marks run to the target, and on past it
/// after a short ink target line. Without a target there is no meter, never a
/// made-up full one.
public struct MeterLayout: Equatable, Sendable {
  /// Marks drawn: at least the target's, more when the value passes it.
  public let marks: Int
  /// Marks up to the target.
  public let targetMarks: Int
  /// How many marks the value fills; the last one may be partly filled.
  public let filled: Double

  /// Nil without a positive target or amount per mark: draw nothing.
  public init?(value: Double, target: Double?, unit: Double) {
    guard let target, target > 0, unit > 0 else { return nil }
    filled = max(0, value) / unit
    targetMarks = max(1, Int((target / unit).rounded()))
    marks = max(targetMarks, Int(filled.rounded(.up)))
  }

  /// After which mark the target line stands, when the value runs past it.
  public var targetLineAfter: Int? { marks > targetMarks ? targetMarks : nil }

  /// The index of the furthest filled mark, which glows in dark mode.
  public var lead: Int? { filled > 0 ? Int(filled.rounded(.up)) - 1 : nil }

  /// How full mark `index` is, from 0 to 1.
  public func fill(_ index: Int) -> Double { min(1, max(0, filled - Double(index))) }
}

/// The Ledger's meter: a row of marks, one per fixed amount, the partial
/// mark filled from the bottom. A new amount fills in with a spring.
public struct IsotypeMeter: View {
  let value: Double
  let target: Double?
  let unit: Double
  let tint: Color
  let markWidth: CGFloat
  @ScaledMetric private var height: CGFloat
  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shown: Double = 0

  /// - Parameters:
  ///   - unit: The amount one mark stands for.
  ///   - height: The marks' height at the default text size.
  public init(
    value: Double, target: Double?, unit: Double, tint: Color, markWidth: CGFloat = 7, height: CGFloat = 32
  ) {
    self.value = value
    self.target = target
    self.unit = unit
    self.tint = tint
    self.markWidth = markWidth
    _height = ScaledMetric(wrappedValue: height, relativeTo: .title)
  }

  public var body: some View {
    if MeterLayout(value: value, target: target, unit: unit) != nil {
      MeterMarks(
        shown: shown, value: value, target: target, unit: unit, tint: tint, markWidth: markWidth,
        glow: scheme == .dark)
      .frame(height: height)
      .onAppear { withAnimation(Theme.Motion.spring(reduceMotion: reduceMotion)) { shown = value } }
      .onChange(of: value) { _, value in
        withAnimation(Theme.Motion.spring(reduceMotion: reduceMotion)) { shown = value }
      }
      // The row around it reads the value and its target as one sentence.
      .accessibilityHidden(true)
    }
  }
}

/// Animatable, so a logged 250 ml fills the next glass instead of jumping.
/// The marks are counted from the final value, so the spring's overshoot
/// never adds a mark for a moment.
private struct MeterMarks: View, Animatable {
  var shown: Double
  let value: Double
  let target: Double?
  let unit: Double
  let tint: Color
  let markWidth: CGFloat
  let glow: Bool

  nonisolated var animatableData: Double {
    get { shown }
    set { shown = newValue }
  }

  var body: some View {
    Canvas { context, size in
      guard let layout = MeterLayout(value: value, target: target, unit: unit),
        let filling = MeterLayout(value: shown, target: target, unit: unit)
      else { return }
      let count = layout.marks
      let pitch = count > 1 ? (size.width - markWidth) / CGFloat(count - 1) : 0
      for index in 0..<count {
        let x = CGFloat(index) * pitch
        let mark = CGRect(x: x, y: 0, width: markWidth, height: size.height)
        context.fill(Path(roundedRect: mark, cornerRadius: Theme.Radius.mark), with: .color(Theme.track))
        let fill = filling.fill(index)
        guard fill > 0 else { continue }
        let height = size.height * fill
        let filled = Path(
          roundedRect: CGRect(x: x, y: size.height - height, width: markWidth, height: height),
          cornerRadius: Theme.Radius.mark)
        if glow && index == filling.lead {
          // The light point: in dark mode the leading mark glows.
          var light = context
          light.addFilter(.shadow(color: tint.opacity(0.9), radius: 5))
          light.fill(filled, with: .color(tint))
        } else {
          context.fill(filled, with: .color(tint))
        }
      }
      if let after = layout.targetLineAfter {
        let x = CGFloat(after - 1) * pitch + (pitch + markWidth) / 2 - 0.75
        context.fill(Path(CGRect(x: x, y: -5, width: 1.5, height: size.height + 10)), with: .color(Theme.ink))
      }
    }
  }
}

#Preview("Meters") {
  VStack(alignment: .leading, spacing: 28) {
    IsotypeMeter(value: 980, target: 1900, unit: 100, tint: Theme.calories)
    IsotypeMeter(value: 2150, target: 1900, unit: 100, tint: Theme.calories)
    HStack(spacing: 32) {
      IsotypeMeter(value: 52, target: 130, unit: 10, tint: Theme.protein, markWidth: 5, height: 24)
      IsotypeMeter(value: 500, target: 2450, unit: 250, tint: Theme.water, markWidth: 8, height: 24)
    }
  }
  .padding(20)
  .background(Theme.background)
}
