import SwiftUI

/// One half of the split-disc mark, drawn from the same geometry as the app
/// icon: the 1024 canvas cropped to the 716-unit square the mark occupies.
/// The left half is Coach and the right half is you, lifted. Every value is
/// in mark units, so the same shape serves the icon, the byline, the
/// colophon, the cover and the voice orb, and it animates.
nonisolated public struct MarkHalf: Shape {
  public enum Part: Sendable { case coach, you }

  public var part: Part
  /// The gutter between the flat edges (40 at rest).
  public var gap: CGFloat
  /// How far the right half sits above the left (136 at rest). 0 closes the
  /// mark into one disc.
  public var lift: CGFloat
  /// Extra rise for the speaking half in the voice orb.
  public var rise: CGFloat
  /// An echo of the half: as much larger and moved as far out from the
  /// spine, as the voice orb's arcs on the speaking side.
  public var spread: CGFloat

  public init(_ part: Part, gap: CGFloat = 40, lift: CGFloat = 136, rise: CGFloat = 0, spread: CGFloat = 0) {
    self.part = part
    self.gap = gap
    self.lift = lift
    self.rise = rise
    self.spread = spread
  }

  public var animatableData: AnimatablePair<CGFloat, AnimatablePair<CGFloat, CGFloat>> {
    get { AnimatablePair(gap, AnimatablePair(lift, rise)) }
    set {
      gap = newValue.first
      lift = newValue.second.first
      rise = newValue.second.second
    }
  }

  public func path(in rect: CGRect) -> Path {
    let scale = min(rect.width, rect.height) / 716
    let radius: CGFloat = 290 + spread
    let fillet: CGFloat = 10
    let left = part == .coach
    let side: CGFloat = left ? -1 : 1
    // The full disc's centre is (358, 358) in the cropped canvas.
    let cx = 358 + side * (gap / 2 + spread)
    let cy = 358 + (left ? lift / 2 : -lift / 2) - rise
    let dy = ((radius - fillet) * (radius - fillet) - fillet * fillet).squareRoot()
    let k = radius / (radius - fillet)
    let top = CGPoint(x: cx + side * fillet, y: cy - dy)
    let bottom = CGPoint(x: cx + side * fillet, y: cy + dy)
    let arcTop = CGPoint(x: cx + (top.x - cx) * k, y: cy + (top.y - cy) * k)
    let arcBottom = CGPoint(x: cx + (bottom.x - cx) * k, y: cy + (bottom.y - cy) * k)
    let start = atan2(arcTop.y - cy, arcTop.x - cx)
    var end = atan2(arcBottom.y - cy, arcBottom.x - cx)
    if left { end -= 2 * .pi }  // the long way round, through 180°
    let point = { (x: CGFloat, y: CGFloat) in CGPoint(x: rect.minX + x * scale, y: rect.minY + y * scale) }
    var path = Path()
    path.move(to: point(cx, cy - dy))
    path.addQuadCurve(to: point(arcTop.x, arcTop.y), control: point(cx, cy - radius))
    for step in 1...72 {
      let angle = start + (end - start) * CGFloat(step) / 72
      path.addLine(to: point(cx + radius * cos(angle), cy + radius * sin(angle)))
    }
    path.addQuadCurve(to: point(cx, cy + dy), control: point(cx, cy + radius))
    path.closeSubpath()
    return path
  }
}

/// The split-disc mark: Coach's ultramarine half and your lifted vermilion
/// half. It is decoration, so VoiceOver skips it; label what it sits in.
public struct BrandMark: View {
  var coach: Color
  var you: Color
  var gap: CGFloat
  var lift: CGFloat

  /// `gap: 0, lift: 0` closes the halves into one disc, as at the day's end.
  public init(
    coach: Color = Theme.markCoach, you: Color = Theme.markYou, gap: CGFloat = 40, lift: CGFloat = 136
  ) {
    self.coach = coach
    self.you = you
    self.gap = gap
    self.lift = lift
  }

  public var body: some View {
    ZStack {
      MarkHalf(.coach, gap: gap, lift: lift).fill(coach)
      MarkHalf(.you, gap: gap, lift: lift).fill(you)
    }
    .aspectRatio(1, contentMode: .fit)
    .accessibilityHidden(true)
  }
}

#Preview("Mark") {
  HStack(spacing: 24) {
    BrandMark().frame(width: 18)
    BrandMark().frame(width: 64)
    BrandMark().frame(width: 160)
    BrandMark(gap: 0, lift: 0).frame(width: 64)
  }
  .padding()
  .background(Theme.background)
}
