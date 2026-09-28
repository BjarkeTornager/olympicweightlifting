import SwiftUI
import UIKit

/// Light, dark, or as the iPhone is set. Chosen in Profile and kept on this
/// iPhone, also after signing out.
enum Appearance: String, CaseIterable, Identifiable {
  case system, light, dark

  static let key = "appearance"

  var id: Self { self }

  var title: String {
    switch self {
    case .system: "System"
    case .light: "Light"
    case .dark: "Dark"
    }
  }

  var style: UIUserInterfaceStyle {
    switch self {
    case .system: .unspecified
    case .light: .light
    case .dark: .dark
    }
  }

  /// Applies it to the app's windows, so sheets, alerts and the voice call
  /// follow too. SwiftUI's preferredColorScheme doesn't reliably return to
  /// the iPhone's setting once it has been set.
  @MainActor func apply() {
    for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
      for window in scene.windows { window.overrideUserInterfaceStyle = style }
    }
  }
}
