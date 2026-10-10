import LiftTheme
import SwiftUI

/// Colours per kind of record, used the same way everywhere, and only on
/// data and its keys (see Theme). Each follows its area of life: training
/// is movement, a check-in is how you feel, and Coach keeps the accent.
enum Category {
  case sleep, heart, activity, water, food, training, checkin, coach, body

  var tint: Color {
    switch self {
    case .sleep: Theme.sleep
    case .heart: Theme.heart
    case .activity, .training: Theme.activity
    case .water: Theme.water
    case .food: Theme.calories
    case .checkin: Theme.feltEnergy
    case .coach: Theme.accent
    case .body: Theme.body
    }
  }

  /// What a key of this colour stands for, as Coach's byline names it.
  var name: String {
    switch self {
    case .sleep: "Sleep"
    case .heart: "Heart"
    case .activity: "Movement"
    case .water: "Water"
    case .food: "Food"
    case .training: "Training"
    case .checkin: "Check-in"
    case .coach: "Coach"
    case .body: "Body"
    }
  }
}

/// A large serif number with its unit in SF beside it.
struct BigValue: View {
  let value: String
  var unit: String?

  var body: some View {
    Measure(value: value, unit: unit)
      .contentTransition(.numericText())
  }
}

/// A smaller value with its label below, for two or three side by side.
struct MiniValue: View {
  let value: String?
  var unit: String?
  let label: String

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(value ?? "–").folio(.inline)
        if let unit, value != nil {
          Text(unit).unit()
        }
      }
      Text(label).font(.caption).foregroundStyle(Theme.inkSecondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// A serif number with its SF unit beside it, as in "980 kcal". A value
/// with several parts reads as one: "7 h 15 min" sets 7 and 15 in the serif
/// and h and min in SF.
struct Measure: View {
  let value: String
  var unit: String?
  var role: Folio.Role = .tile

  var body: some View {
    // One Text, so the parts share a baseline and shrink together.
    let parts = Measure.parts(value, unit)
    let text = parts.enumerated().reduce(Text(verbatim: "")) { text, item in
      let (index, part) = item
      if part.number {
        let gap = index > 0 && parts[index - 1].number ? " " : ""
        return Text("\(text)\(gap)\(part.text)")
      }
      let unit = Text(" \(part.text)\(index < parts.count - 1 ? " " : "")")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(Theme.inkSecondary)
      return Text("\(text)\(unit)")
    }
    // Shrinks to fit the width, never a stack's share of the height.
    text
      .folio(role)
      .lineLimit(1)
      .minimumScaleFactor(0.6)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityLabel([value, unit].compactMap { $0 }.joined(separator: " "))
  }

  /// Splits "7 h 15 min" into numbers and units. A word that starts with a
  /// digit or a sign is a number; "–" stands for one that is missing.
  static func parts(_ value: String, _ unit: String?) -> [(text: String, number: Bool)] {
    let words = value.split(separator: " ").map(String.init)
    let parts = words.map { word -> (text: String, number: Bool) in
      let first = word.first
      let number = first.map { $0.isNumber || "~+−-–".contains($0) } ?? false
      return (word, number)
    }
    return parts + (unit.map { [($0, false)] } ?? [])
  }
}

/// A symbol in its data colour on a soft neutral square.
struct IconBadge: View {
  let symbol: String
  let tint: Color
  var size: CGFloat = 30

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.46, weight: .semibold))
      .foregroundStyle(tint)
      .frame(width: size, height: size)
      .background(Theme.fill, in: .rect(cornerRadius: Theme.Radius.badge, style: .continuous))
      .accessibilityHidden(true)
  }
}

/// The signed-in person's initials, for the account button.
struct Avatar: View {
  let name: String
  var size: CGFloat = 32

  var body: some View {
    Text(initials)
      .font(.system(size: size * 0.38, weight: .semibold))
      .foregroundStyle(Theme.onAccent)
      .frame(width: size, height: size)
      .background(Theme.accent, in: .circle)
  }

  private var initials: String {
    let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
    return letters.isEmpty ? "?" : String(letters).uppercased()
  }
}

/// Numbers as the app writes them. The server writes the journal's entries
/// and Coach's replies in British English ("70.4 kg", "1,900 kcal"), so the
/// numbers set on the device follow the same locale: Today and the Journal
/// never mix "70,4" and "70.4" on an iPhone set to another region.
enum Format {
  static let locale = Locale(identifier: "en_GB")

  static func hours(_ value: Double) -> String {
    let minutes = Int((value * 60).rounded())
    return minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
  }

  /// Millilitres under a litre, else litres: to one decimal for an amount
  /// drunk ("2.4 L"), or two for a whole quarter litre ("2.25 L"), so the
  /// amount reads as the target, set in quarter litres, at the moment it
  /// is reached.
  static func litres(_ ml: Int, digits: Int? = nil) -> (String, String) {
    guard ml >= 1000 else { return ("\(ml)", "ml") }
    return (decimal(Double(ml) / 1000, digits: digits ?? (ml % 250 == 0 ? 2 : 1)), "L")
  }

  /// A whole number with thousands separated: "1,900".
  static func number(_ value: Double) -> String {
    Int(value.rounded()).formatted(.number.locale(locale))
  }

  static func number(_ value: Int) -> String {
    value.formatted(.number.locale(locale))
  }

  /// A measurement with up to `digits` decimals: "70.4", "70".
  static func decimal(_ value: Double, digits: Int = 1) -> String {
    value.formatted(.number.precision(.fractionLength(0...digits)).locale(locale))
  }

  /// A daily target, or nil when none is set. Zero counts as none: nobody
  /// aims to eat nothing, and "0 kcal a day" would read as a target to meet.
  static func target(_ value: Double?) -> Double? {
    value.flatMap { $0 > 0 ? $0 : nil }
  }

  /// A count in running text: spelled out up to ten ("two meals"), in
  /// figures above.
  static func count(_ value: Int) -> String {
    guard (0...10).contains(value) else { return number(value) }
    return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][value]
  }

  /// The body goal's focus, as the server names it.
  static func focus(_ value: String?) -> String? {
    switch value {
    case "lose_fat": "Losing fat"
    case "build_muscle": "Building muscle"
    case "recomposition": "Recomposition"
    case "maintain": "Maintaining"
    default: nil
    }
  }
}

/// A sheet that floats on the paper: Coach's figures, receipts, workout
/// exercises. A hairline edge and no shadow, in light and dark mode alike.
struct Card: ViewModifier {
  var padding: CGFloat = 16

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.surface, in: .rect(cornerRadius: Theme.Radius.sheet, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: Theme.Radius.sheet, style: .continuous)
          .strokeBorder(Theme.rule, lineWidth: 0.5)
      }
  }
}

extension View {
  func card(padding: CGFloat = 16) -> some View { modifier(Card(padding: padding)) }
}

/// A section's heading, set like a page: a 1 pt ink rule, the title in the
/// serif, and a short note or an action on the right ("Seven days").
struct FolioSection<Trailing: View>: View {
  let title: String
  var meta: String?
  @ViewBuilder var trailing: Trailing

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Rectangle().fill(Theme.ink).frame(height: 1)
      // The note moves under the title when both don't fit on one line, so
      // the title never breaks inside a word.
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          heading
          Spacer(minLength: 0)
          note
        }
        VStack(alignment: .leading, spacing: 6) {
          heading
          HStack(alignment: .firstTextBaseline, spacing: 12) { note }
        }
      }
    }
  }

  private var heading: some View {
    Text(title)
      .folio(.sectionTitle)
      .foregroundStyle(Theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
  }

  @ViewBuilder
  private var note: some View {
    if let meta {
      Text(meta).font(.footnote).foregroundStyle(Theme.inkSecondary)
    }
    trailing
  }
}

extension FolioSection where Trailing == EmptyView {
  init(_ title: String, meta: String? = nil) {
    self.title = title
    self.meta = meta
    self.trailing = EmptyView()
  }
}

/// The one primary action on a screen: a full-width capsule in the deep
/// accent. Inside a sheet, such as a receipt waiting to be saved, it is as
/// wide as its label.
struct PrimaryButtonStyle: ButtonStyle {
  var height: CGFloat = 54
  var fullWidth = true

  func makeBody(configuration: Configuration) -> some View {
    Filled(configuration: configuration, height: height, fullWidth: fullWidth)
  }

  private struct Filled: View {
    let configuration: ButtonStyleConfiguration
    let height: CGFloat
    let fullWidth: Bool
    @Environment(\.isEnabled) private var enabled

    var body: some View {
      configuration.label
        .font(fullWidth ? .headline : .subheadline.weight(.semibold))
        .foregroundStyle(Theme.onAccentFill)
        .padding(.horizontal, fullWidth ? 20 : 16)
        .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: height)
        .background(Theme.accentFill, in: .capsule)
        .contentShape(.capsule)
        .opacity(enabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
        .scaleEffect(configuration.isPressed ? 0.98 : 1)
        .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
  }
}

/// Every other button: a capsule drawn with a hairline, in ink. A
/// destructive button, or one marked `danger` (a missed lift), is in the
/// danger colour.
struct SecondaryButtonStyle: ButtonStyle {
  var danger = false
  var height: CGFloat = 44

  func makeBody(configuration: Configuration) -> some View {
    Outlined(configuration: configuration, danger: danger || configuration.role == .destructive, height: height)
  }

  private struct Outlined: View {
    let configuration: ButtonStyleConfiguration
    let danger: Bool
    let height: CGFloat
    @Environment(\.isEnabled) private var enabled

    var body: some View {
      configuration.label
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(danger ? Theme.danger : Theme.ink)
        .padding(.horizontal, 16)
        .frame(minHeight: height)
        .background {
          Capsule().fill(configuration.isPressed ? Theme.fill : .clear)
          Capsule().strokeBorder(Theme.rule, lineWidth: 1)
        }
        .contentShape(.capsule)
        .opacity(enabled ? 1 : 0.4)
        .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
  }
}

/// A one-tap amount or item. To add, accent text in an outlined capsule;
/// once logged, ink on fill with a check mark. Chips sit in a FlowLayout, so
/// they wrap instead of clipping, and keep a 44 pt hit area.
struct Chip: View {
  enum Kind { case add, logged }
  let title: String
  var kind: Kind = .add

  var body: some View {
    Label(title, systemImage: kind == .add ? "plus" : "checkmark")
      .labelStyle(ChipLabelStyle())
      .font(.subheadline.weight(kind == .add ? .semibold : .medium))
      .foregroundStyle(kind == .add ? Theme.accent : Theme.ink)
      .padding(.horizontal, 15)
      .frame(minHeight: 40)
      .background {
        switch kind {
        case .add: Capsule().strokeBorder(Theme.accent.opacity(0.45), lineWidth: 1)
        case .logged: Capsule().fill(Theme.fill)
        }
      }
      .padding(.vertical, 2)
      .contentShape(.rect)
  }

  private struct ChipLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
      HStack(spacing: 6) {
        configuration.icon.imageScale(.small).fontWeight(.bold)
        configuration.title
      }
    }
  }
}

/// Lays its views out in rows, wrapping to the next row when one is full.
/// A view wider than a whole row gets the row's width and grows taller, so
/// its text wraps instead of being cut short.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  var lineSpacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(subviews, width: proposal.width ?? .infinity)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in rows(subviews, width: bounds.width) {
      var x = bounds.minX
      for (index, size) in zip(row.indices, row.sizes) {
        subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + lineSpacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var sizes: [CGSize] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  /// A view's size on one line, or at most `width` wide and as tall as it
  /// then needs.
  private func size(_ subview: LayoutSubview, width: CGFloat) -> CGSize {
    let ideal = subview.sizeThatFits(.unspecified)
    guard ideal.width > width else { return ideal }
    let wrapped = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
    return CGSize(width: min(wrapped.width, width), height: wrapped.height)
  }

  private func rows(_ subviews: Subviews, width: CGFloat) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for index in subviews.indices {
      let size = size(subviews[index], width: width)
      if !row.indices.isEmpty && row.width + spacing + size.width > width {
        rows.append(row)
        row = Row()
      }
      row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
      row.height = max(row.height, size.height)
      row.indices.append(index)
      row.sizes.append(size)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}

/// The one colour field on Today: the way into a check-in with Coach. The
/// mark sits in a disc, Coach's half knocked out in paper on the blue.
struct CheckInBlock: View {
  let title: String
  let detail: String

  var body: some View {
    HStack(spacing: 14) {
      BrandMark(coach: Theme.onAccentFill, you: Theme.markYou)
        .frame(width: 28)
        .frame(width: 46, height: 46)
        .background(Theme.onAccentFill.opacity(0.14), in: .circle)
      VStack(alignment: .leading, spacing: 1) {
        Text(title).font(.headline)
        Text(detail).font(.footnote).opacity(0.82)
      }
      Spacer(minLength: 0)
      Image(systemName: "arrow.right").font(.title3.weight(.medium)).accessibilityHidden(true)
    }
    .foregroundStyle(Theme.onAccentFill)
    .padding(.leading, 14)
    .padding(.trailing, 20)
    .padding(.vertical, 12)
    .frame(minHeight: 72)
    .background(Theme.accentFill, in: .rect(cornerRadius: Theme.Radius.block, style: .continuous))
    .contentShape(.rect(cornerRadius: Theme.Radius.block, style: .continuous))
    .accessibilityElement(children: .combine)
  }
}

#Preview("Controls") {
  ScrollView {
    VStack(alignment: .leading, spacing: 20) {
      FolioSection("Food & drink", meta: "2 meals")
      Button("Continue with Google") {}.buttonStyle(PrimaryButtonStyle())
      HStack {
        Button {
        } label: {
          Label("Miss", systemImage: "xmark").frame(maxWidth: .infinity)
        }
        .buttonStyle(SecondaryButtonStyle(danger: true))
        Button("Start Day 1") {}.buttonStyle(SecondaryButtonStyle())
      }
      FlowLayout {
        Chip(title: "250 ml")
        Chip(title: "500 ml")
        Chip(title: "Water · 500 ml", kind: .logged)
        Chip(title: "Vitamin D 1000 IU", kind: .logged)
        Chip(title: "Add supplement")
      }
      CheckInBlock(title: "Check in with Coach", detail: "Coach logs your day as you talk")
      HStack(spacing: 24) {
        Measure(value: "7 h 15 min")
        Measure(value: "54", unit: "bpm")
      }
      Text("A sheet that floats").card()
    }
    .padding(20)
  }
  .background(Theme.background)
}
