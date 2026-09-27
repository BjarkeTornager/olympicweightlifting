import LiftTheme
import SwiftUI

/// Colours per kind of record, used the same way everywhere, and only on
/// data and its symbols (see Theme).
enum Category {
  case sleep, heart, activity, water, food, training, checkin, coach, body

  var tint: Color {
    switch self {
    case .sleep: Theme.sleep
    case .heart: Theme.heart
    case .activity: Theme.activity
    case .water: Theme.water
    case .food: Theme.calories
    case .training, .checkin, .coach: Theme.accent
    case .body: Theme.body
    }
  }

  var symbol: String {
    switch self {
    case .sleep: "bed.double.fill"
    case .heart: "heart.fill"
    case .activity: "flame.fill"
    case .water: "drop.fill"
    case .food: "fork.knife"
    case .training: "dumbbell.fill"
    case .checkin: "face.smiling"
    case .coach: "waveform"
    case .body: "scalemass.fill"
    }
  }
}

/// A large rounded number with its unit, as in Health and Fitness.
struct BigValue: View {
  let value: String
  var unit: String?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 3) {
      Text(value)
        .font(.system(.title, design: .rounded, weight: .semibold))
        .monospacedDigit()
        .contentTransition(.numericText())
      if let unit {
        Text(unit)
          .font(.system(.subheadline, design: .rounded, weight: .semibold))
          .foregroundStyle(.secondary)
      }
    }
  }
}

/// A smaller value with its label below, for two or three side by side.
struct MiniValue: View {
  let value: String?
  var unit: String?
  let label: String

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(alignment: .firstTextBaseline, spacing: 2) {
        Text(value ?? "–")
          .font(.system(.title3, design: .rounded, weight: .semibold))
          .monospacedDigit()
        if let unit, value != nil {
          Text(unit).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
      }
      Text(label).font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
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
      .background(Theme.fill, in: .rect(cornerRadius: size * 0.3, style: .continuous))
      .accessibilityHidden(true)
  }
}

/// A small heart, marking values that came from Apple Health.
struct AppleHealthMark: View {
  var body: some View {
    Image(systemName: "heart.fill")
      .font(.caption2)
      .foregroundStyle(Theme.heart)
      .accessibilityLabel("From Apple Health")
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

enum Format {
  static func hours(_ value: Double) -> String {
    let minutes = Int((value * 60).rounded())
    return minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
  }

  static func litres(_ ml: Int) -> (String, String) {
    ml < 1000
      ? ("\(ml)", "ml")
      : ((Double(ml) / 1000).formatted(.number.precision(.fractionLength(0...2))), "L")
  }

  static func number(_ value: Double) -> String {
    Int(value.rounded()).formatted()
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

/// A white card on the warm background, with a faint shadow; in dark mode
/// an elevated surface without one.
struct Card: ViewModifier {
  @Environment(\.colorScheme) private var scheme
  var padding: CGFloat = 16

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .fill(Theme.surface)
          .shadow(color: .black.opacity(scheme == .dark ? 0 : 0.04), radius: 10, y: 3)
      )
  }
}

extension View {
  func card(padding: CGFloat = 16) -> some View { modifier(Card(padding: padding)) }
}

/// A bold section heading with an optional action on the right.
struct SectionHeading<Trailing: View>: View {
  let title: String
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title).font(.title3.weight(.bold))
      Spacer()
      trailing
    }
  }
}

extension SectionHeading where Trailing == EmptyView {
  init(_ title: String) {
    self.title = title
    self.trailing = EmptyView()
  }
}

/// A full-width primary button in the accent colour.
struct PrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.headline)
      .foregroundStyle(Theme.onAccent)
      .frame(maxWidth: .infinity, minHeight: 50)
      .background(Theme.accent, in: .rect(cornerRadius: 14, style: .continuous))
      .opacity(configuration.isPressed ? 0.85 : 1)
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}
