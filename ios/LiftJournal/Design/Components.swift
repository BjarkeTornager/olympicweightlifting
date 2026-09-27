import SwiftUI

/// Colours per kind of record, used the same way everywhere, as the Health
/// app does for its categories.
enum Category {
  case sleep, heart, activity, water, food, training, checkin, coach

  var tint: Color {
    switch self {
    case .sleep: .indigo
    case .heart: .pink
    case .activity: .orange
    case .water: .cyan
    case .food: .green
    case .training: .blue
    case .checkin: .teal
    case .coach: .purple
    }
  }

  var symbol: String {
    switch self {
    case .sleep: "bed.double.fill"
    case .heart: "heart.fill"
    case .activity: "flame.fill"
    case .water: "drop.fill"
    case .food: "fork.knife"
    case .training: "figure.strengthtraining.olympic"
    case .checkin: "face.smiling"
    case .coach: "waveform"
    }
  }
}

/// A summary card in the style of the Health app: the category in its
/// colour, an optional time on the right, then the content.
struct SummaryCard<Content: View>: View {
  let title: String
  let category: Category
  var caption: String?
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Label(title, systemImage: category.symbol)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(category.tint)
        Spacer(minLength: 8)
        if let caption {
          Text(caption).font(.footnote).foregroundStyle(.secondary)
        }
      }
      content
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
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

/// A white symbol on a coloured rounded square, as in Settings.
struct IconBadge: View {
  let symbol: String
  let tint: Color
  var size: CGFloat = 30

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.5, weight: .semibold))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(tint.gradient, in: .rect(cornerRadius: size * 0.24))
      .accessibilityHidden(true)
  }
}

/// A small heart, marking values that came from Apple Health.
struct AppleHealthMark: View {
  var body: some View {
    Image(systemName: "heart.fill")
      .font(.caption2)
      .foregroundStyle(.pink)
      .accessibilityLabel("From Apple Health")
  }
}

/// The signed-in person's initials, for the account button.
struct Avatar: View {
  let name: String
  var size: CGFloat = 32

  var body: some View {
    Text(initials)
      .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(Color.accentColor.gradient, in: .circle)
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
}

/// A white card with rounded corners and a soft shadow, as on Airbnb; in
/// dark mode an elevated surface without the shadow.
struct Card: ViewModifier {
  @Environment(\.colorScheme) private var scheme
  var padding: CGFloat = 16

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .fill(scheme == .dark ? Color(.secondarySystemBackground) : Color(.systemBackground))
          .shadow(color: .black.opacity(scheme == .dark ? 0 : 0.08), radius: 14, y: 6)
      )
      .overlay(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .strokeBorder(Color(.separator).opacity(scheme == .dark ? 0.3 : 0.12))
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

/// A full-width primary button in the accent colour, rounded like Airbnb's.
struct PrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.headline)
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity, minHeight: 50)
      .background(Color.accentColor.gradient, in: .rect(cornerRadius: 14, style: .continuous))
      .opacity(configuration.isPressed ? 0.85 : 1)
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}
