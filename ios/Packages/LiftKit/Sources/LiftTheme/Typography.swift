import SwiftUI
import UIKit

/// Two voices, both system fonts, so nothing is bundled and Dynamic Type,
/// Bold Text, the widget and the Live Activity all keep working. New York
/// (`design: .serif`) is the human voice: mastheads, section titles, display
/// numbers, Coach's letters, dish and entry titles. San Francisco is
/// everything you operate: labels, units, buttons, lists and chrome.
/// New York is never set below 15 pt, and serif numbers start at 22 pt.
public enum Folio {
  public enum Role: Sendable {
    /// The day's date on Today and the Journal: 46 pt.
    case masthead
    /// A section's title on its ink rule: 30 pt.
    case sectionTitle
    /// The one number a screen leads with: 66 pt.
    case hero
    /// A second large number, such as the body's weight: 50 pt.
    case display
    /// Protein and water beside the hero: 36 pt.
    case ledger
    /// A value in a grid cell: 34 pt.
    case tile
    /// Smaller numbers and values in a row: 22 pt.
    case inline
    /// The italic summary under a masthead: 19 pt.
    case standfirst
    /// The roman paragraph under the cover's title: 19 pt.
    case lede
    /// Coach's paragraphs: 18 pt.
    case coach
    /// Dish titles, which wrap: 18 pt.
    case entry
    /// An entry's title in Movement, Train and the Journal, which wraps: 20 pt.
    case heading
    /// Italic empty states and footnotes: 17 pt.
    case note
    /// "Lift Journal" as a name, beside the mark in a running head or a
    /// colophon: 17 pt, in the serif's own spacing.
    case wordmark
    /// The name on the cover: 66 pt, in the serif's own spacing.
    case coverWordmark

    var size: CGFloat {
      switch self {
      case .masthead: 46
      case .sectionTitle: 30
      case .hero, .coverWordmark: 66
      case .display: 50
      case .ledger: 36
      case .tile: 34
      case .inline: 22
      case .standfirst, .lede: 19
      case .heading: 20
      case .coach, .entry: 18
      case .note, .wordmark: 17
      }
    }

    var style: Font.TextStyle {
      switch self {
      case .masthead, .hero, .display, .coverWordmark: .largeTitle
      case .sectionTitle, .ledger, .tile: .title
      case .inline, .standfirst, .lede, .heading: .title3
      case .coach, .entry, .note, .wordmark: .body
      }
    }

    var italic: Bool { self == .standfirst || self == .note }

    /// Display sizes tighten; text sizes keep the default tracking.
    var tracking: CGFloat {
      switch self {
      case .hero: -2.2
      case .display: -1.5
      case .masthead: -0.8
      case .sectionTitle, .ledger, .tile: -0.4
      default: 0
      }
    }

    /// Extra space between lines of running text: 26 pt lines for Coach and
    /// the standfirst.
    var leading: CGFloat {
      switch self {
      case .coach: 4
      case .standfirst, .lede: 3
      case .heading: 1
      default: 0
      }
    }
  }
}

private struct FolioFont: ViewModifier {
  let role: Folio.Role
  @ScaledMetric private var size: CGFloat
  @ScaledMetric private var leading: CGFloat

  init(_ role: Folio.Role) {
    self.role = role
    _size = ScaledMetric(wrappedValue: role.size, relativeTo: role.style)
    _leading = ScaledMetric(wrappedValue: role.leading, relativeTo: role.style)
  }

  func body(content: Content) -> some View {
    content
      .font(.system(size: size, weight: .regular, design: .serif))
      .italic(role.italic)
      .tracking(role.tracking)
      .lineSpacing(leading)
      .monospacedDigit()
  }
}

extension View {
  /// New York in one of the Folio roles, scaled with Dynamic Type.
  public func folio(_ role: Folio.Role) -> some View { modifier(FolioFont(role)) }

  /// The small spaced capitals that label every column and section.
  public func kicker() -> some View {
    font(.caption.weight(.semibold)).textCase(.uppercase).tracking(1.2).foregroundStyle(Theme.inkSecondary)
  }

  /// The SF unit beside a serif number, as in "980 kcal".
  public func unit() -> some View {
    font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
  }
}

public enum FolioChrome {
  /// Serif navigation titles everywhere (Train, Journal, Profile, Trend),
  /// scaled with Dynamic Type. Call once, when the app starts. At the top of
  /// a page the bar is transparent, so the page runs up under it; once
  /// content scrolls under it, the bar is set on the paper with a hairline
  /// below, as a running head is, so the title never sits over a blur of
  /// what is beneath it.
  @MainActor public static func apply() {
    func serif(_ style: UIFont.TextStyle, _ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
      let base = UIFont.systemFont(ofSize: size, weight: weight).fontDescriptor
      let descriptor = base.withDesign(.serif) ?? base
      return UIFontMetrics(forTextStyle: style).scaledFont(for: UIFont(descriptor: descriptor, size: size))
    }
    let ink = UIColor(Theme.ink)
    func titled(_ appearance: UINavigationBarAppearance) -> UINavigationBarAppearance {
      appearance.largeTitleTextAttributes = [
        .font: serif(.largeTitle, 36, .regular), .kern: -0.6, .foregroundColor: ink,
      ]
      appearance.titleTextAttributes = [.font: serif(.headline, 19, .medium), .foregroundColor: ink]
      return appearance
    }
    let top = UINavigationBarAppearance()
    top.configureWithTransparentBackground()
    let scrolled = UINavigationBarAppearance()
    scrolled.configureWithOpaqueBackground()
    scrolled.backgroundColor = UIColor(Theme.background)
    scrolled.shadowColor = UIColor(Theme.rule)
    let bar = UINavigationBar.appearance()
    bar.standardAppearance = titled(scrolled)
    bar.compactAppearance = titled(scrolled.copy())
    bar.scrollEdgeAppearance = titled(top)
    bar.compactScrollEdgeAppearance = titled(top.copy())
  }
}
