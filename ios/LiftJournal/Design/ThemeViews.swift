import LiftTheme
import SwiftUI

/// A card's small heading: an optional symbol in the data colour, and the
/// title in spaced capitals.
struct CardLabel: View {
  let title: String
  var symbol: String?
  var tint: Color = .secondary

  var body: some View {
    HStack(spacing: 5) {
      if let symbol {
        Image(systemName: symbol)
          .font(.caption.weight(.semibold))
          .foregroundStyle(tint)
          .accessibilityHidden(true)
      }
      Text(title)
        .font(.caption.weight(.semibold))
        .textCase(.uppercase)
        .tracking(0.8)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

extension View {
  /// Lists and forms on the app's warm background instead of the system grey.
  func themedList() -> some View {
    scrollContentBackground(.hidden).background(Theme.background)
  }
}
