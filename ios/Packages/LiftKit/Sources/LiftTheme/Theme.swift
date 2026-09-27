import SwiftUI
import UIKit

/// The app's look in one place. Pine: the app icon's deep teal as the one
/// accent colour, warm stone and white surfaces, and muted, earthy colours
/// kept for data. Screens use these roles, never the palette below, so a
/// colour changes here and everywhere at once. The app's AccentColor asset
/// must match `accent` (a test checks it), because UIKit tints with the asset.
public enum Theme {
  // MARK: Surfaces

  /// Behind every screen.
  public static let background = Palette.stone
  /// Cards, list rows and the coach's messages.
  public static let surface = Palette.paper
  /// Chips, steppers and icon squares on a surface.
  public static let fill = Palette.sand
  /// Ring tracks and the earlier days in small charts.
  public static let track = Palette.pebble

  // MARK: Accent

  /// Buttons, the athlete's messages, progress and what's next.
  public static let accent = Palette.pine
  /// Text and symbols on the accent colour.
  public static let onAccent = Palette.onPine

  // MARK: Status

  /// Saved, done, connected.
  public static let success = Palette.sage
  /// In progress, waiting, not saved, rest over.
  public static let attention = Palette.ochre
  /// A missed lift.
  public static let danger = Palette.rose

  // MARK: Data

  public static let calories = Palette.sage
  public static let protein = Palette.clay
  public static let carbs = Palette.wheat
  public static let fat = Palette.rose
  public static let water = Palette.steel
  public static let sleep = Palette.dusk
  public static let heart = Palette.rose
  /// Heart rate variability, beside resting heart rate.
  public static let variability = Palette.dusk
  public static let activity = Palette.ochre
  public static let body = Palette.slate
  /// Body fat, beside weight.
  public static let bodyFat = Palette.clay
  /// Energy as the athlete feels it, from 1 to 5.
  public static let feltEnergy = Palette.ochre
  public static let soreness = Palette.slate
  /// Personal bests.
  public static let record = Palette.ochre
  /// The voice orb's moving colours.
  public static let orb = [Palette.pine, Palette.steel, Palette.sage, Palette.dusk, Palette.pine]
}

/// Every colour the app uses, for light and dark mode. Change the look here.
enum Palette {
  static let pine = pair(light: 0x24514F, dark: 0x7FC4B2)
  static let onPine = pair(light: 0xEEF7F0, dark: 0x0B1413)
  static let stone = pair(light: 0xF4F3EF, dark: 0x0B0D0C)
  static let paper = pair(light: 0xFFFFFF, dark: 0x1C1C1E)
  static let sand = pair(light: 0xEEEDE8, dark: 0x2A2D2C)
  static let pebble = pair(light: 0xE6E4DE, dark: 0x2E3332)
  static let sage = pair(light: 0x5E8C6A, dark: 0x8DBB97)
  static let clay = pair(light: 0xB86F4C, dark: 0xE09A77)
  static let wheat = pair(light: 0xC9A45C, dark: 0xE3C27E)
  static let steel = pair(light: 0x4F7FA3, dark: 0x86B2D4)
  static let dusk = pair(light: 0x6F6CA6, dark: 0x9C99D6)
  static let rose = pair(light: 0xB35C66, dark: 0xE08A93)
  static let ochre = pair(light: 0xB8873A, dark: 0xE0B060)
  static let slate = pair(light: 0x5F7478, dark: 0x9FB3B7)

  private static func pair(light: UInt32, dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
  }
}

extension UIColor {
  fileprivate convenience init(hex: UInt32) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }
}
