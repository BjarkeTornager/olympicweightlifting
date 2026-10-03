import SwiftUI
import UIKit

/// The app's look in one place: "Folio, lifted". Paper pages and true ink,
/// one ultramarine for Coach and every action, and one pigment per area of
/// life. Screens use these roles, never the palette below, so a colour
/// changes here and everywhere at once. The app's AccentColor asset must
/// match `accent` (a test checks it), because UIKit tints with the asset.
public enum Theme {
  // MARK: Surfaces

  /// Behind every screen: a cool newsprint, not cream.
  public static let background = Palette.paper
  /// Sheets, figures, receipts, the composer and anything that floats.
  /// Today's content sits directly on the paper.
  public static let surface = Palette.sheet
  /// Chips, logged items and search fields.
  public static let fill = Palette.fill
  /// Empty meter marks and the earlier days in charts. Graphics only, always
  /// beside a printed value.
  public static let track = Palette.track

  // MARK: Ink

  public static let ink = Palette.ink
  /// Every secondary text, including 11 pt axis labels and day initials.
  public static let inkSecondary = Palette.ink2
  /// Glyphs and decoration only (chevrons, disabled marks). Never text.
  public static let inkTertiary = Palette.ink3
  /// Hairlines between rows, cells and sections.
  public static let rule = Palette.rule

  // MARK: Accent: Coach and every action

  /// Links, symbols, the selected tab and anything you can act on.
  public static let accent = Palette.ultramarine
  /// Text and symbols on the accent colour.
  public static let onAccent = Palette.onUltramarine
  /// Large filled shapes: the primary button and the check-in block. It
  /// stays deep in dark mode, so big fields never glare.
  public static let accentFill = Palette.ultramarineFill
  /// Text and symbols on `accentFill`.
  public static let onAccentFill = Palette.onUltramarineFill

  // MARK: Status, never a data colour

  /// Saved, done, connected: ink, always with a checkmark glyph.
  public static let success = Palette.ink
  /// Waiting or needs a look: ink on `fill`, always with an exclamation glyph.
  public static let attention = Palette.ink
  /// Errors, a missed lift and destructive actions.
  public static let danger = Palette.cinnabar

  // MARK: Brand mark only: icon, byline, colophon, cover and voice orb

  /// The mark's left half: Coach.
  public static let markCoach = Palette.markCoach
  /// The mark's lifted right half: you, the day. No data colour uses this hue.
  public static let markYou = Palette.vermilion

  // MARK: Data: one pigment per area

  public static let sleep = Palette.nocturne
  /// Food: energy, meals and carbs. Today draws fat as a hatch of this
  /// pigment, beside solid carbs.
  public static let calories = Palette.madder
  public static let carbs = Palette.madder
  /// Fat and HRV where a chart can tell series apart only by colour, as
  /// Coach's splits and line charts do until they learn the hatch and the
  /// dash. Today hatches fat in `carbs` and dashes HRV in `heart`.
  public static let fat = Palette.saffron
  /// Protein is set in ink, so it stands at least 3:1 from the food pigment
  /// beside it.
  public static let protein = Palette.ink
  public static let water = Palette.lagoon
  /// Movement: steps, burned energy and workouts.
  public static let activity = Palette.moss
  /// Personal bests, with the rest of movement.
  public static let record = Palette.moss
  /// Body: weight, body fat and resting heart. Today draws HRV as a dashed
  /// line of this pigment.
  public static let body = Palette.slate
  public static let bodyFat = Palette.slate
  public static let heart = Palette.slate
  /// HRV on its own pigment, for Coach's charts: see `fat`.
  public static let variability = Palette.saffron
  /// Energy as the athlete feels it, from 1 to 5.
  public static let feltEnergy = Palette.saffron
  /// Soreness should never look like a reward.
  public static let soreness = Palette.ink2

  /// The voice orb's colours. The orb is retired for the split mark
  /// (`markCoach` and `markYou`) when the voice call is set in the Folio
  /// style; remove this then.
  public static let orb = [Palette.markCoach, Palette.ultramarine, Palette.vermilion, Palette.markCoach]

  // MARK: Tokens

  /// Spacing: 20 is the screen's side gutter, 40 the gap between sections.
  public enum Space {
    public static let xxs: CGFloat = 4
    public static let xs: CGFloat = 8
    public static let s: CGFloat = 12
    public static let m: CGFloat = 16
    public static let gutter: CGFloat = 20
    public static let l: CGFloat = 24
    public static let section: CGFloat = 40
  }

  /// Corner radii. Buttons and chips are capsules, and glass chrome keeps the
  /// system's shapes.
  public enum Radius {
    /// Chart bars and meter marks.
    public static let mark: CGFloat = 1.5
    /// Pigment keys.
    public static let key: CGFloat = 2
    /// Icon badges in lists.
    public static let badge: CGFloat = 8
    /// Sheets, figures, receipts and photos.
    public static let sheet: CGFloat = 16
    /// The check-in block.
    public static let block: CGFloat = 24
  }

  public enum Motion {
    /// Meter fills, the mark's lift and toasts. Instant with Reduce Motion.
    public static func spring(reduceMotion: Bool) -> Animation {
      reduceMotion ? .linear(duration: 0) : .spring(response: 0.35, dampingFraction: 0.85)
    }
  }
}

/// Every colour the app uses, for light and dark mode, and for Increase
/// Contrast where it differs. Change the look here.
enum Palette {
  static let paper = pair(light: 0xEFEEEA, dark: 0x121214)
  static let sheet = pair(light: 0xF9F8F5, dark: 0x1C1C1F)
  static let fill = pair(light: 0xE4E2DB, dark: 0x27272B)
  static let track = pair(light: 0xD6D3CA, dark: 0x36363B, lightHigh: 0xC4C0B5)
  static let ink = pair(light: 0x17171A, dark: 0xEEEDE8)
  static let ink2 = pair(light: 0x5D5A54, dark: 0xA4A29C, lightHigh: 0x4A4741)
  static let ink3 = pair(light: 0x8C887F, dark: 0x77756F)
  static let rule = pair(light: 0x17171A, dark: 0xEEEDE8, lightAlpha: 0.14, darkAlpha: 0.16, highAlpha: 0.28)
  static let ultramarine = pair(light: 0x1E3CAA, dark: 0x9DB0FF)
  static let onUltramarine = pair(light: 0xF9F8F5, dark: 0x0B1430)
  static let ultramarineFill = pair(light: 0x1E3CAA, dark: 0x3653CF)
  static let onUltramarineFill = pair(light: 0xF9F8F5, dark: 0xF5F6FF)
  static let cinnabar = pair(light: 0xB3261E, dark: 0xFF8A80)
  static let markCoach = pair(light: 0x1E3CAA, dark: 0x5C76FF)
  static let vermilion = pair(light: 0xEF5B2C, dark: 0xFF6B3D)
  static let nocturne = pair(light: 0x5B3F94, dark: 0xC2A8F0)
  static let madder = pair(light: 0xB03A62, dark: 0xD2577F)
  static let lagoon = pair(light: 0x1E7381, dark: 0x6CCAD3)
  static let moss = pair(light: 0x4C7230, dark: 0xA7CF84)
  static let slate = pair(light: 0x4D6476, dark: 0xA3B9CA)
  static let saffron = pair(light: 0x8C5F08, dark: 0xF2C255)

  private static func pair(
    light: UInt32, dark: UInt32, lightHigh: UInt32? = nil,
    lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1, highAlpha: CGFloat? = nil
  ) -> Color {
    Color(
      UIColor { traits in
        let high = traits.accessibilityContrast == .high
        if traits.userInterfaceStyle == .dark {
          return UIColor(hex: dark, alpha: high ? highAlpha ?? darkAlpha : darkAlpha)
        }
        return UIColor(hex: high ? lightHigh ?? light : light, alpha: high ? highAlpha ?? lightAlpha : lightAlpha)
      })
  }
}

extension UIColor {
  fileprivate convenience init(hex: UInt32, alpha: CGFloat = 1) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
  }
}
