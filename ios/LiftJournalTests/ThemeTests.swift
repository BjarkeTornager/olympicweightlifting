import LiftTheme
import SwiftUI
import Testing
import UIKit

@testable import LiftJournal

@Suite("Theme")
struct ThemeTests {
  static let styles: [UIUserInterfaceStyle] = [.light, .dark]

  /// WCAG 2.x contrast between two opaque colours in one appearance.
  static func contrast(_ a: Color, _ b: Color, _ style: UIUserInterfaceStyle) -> Double {
    let traits = UITraitCollection(userInterfaceStyle: style)
    func luminance(_ color: Color) -> Double {
      var rgba: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
      UIColor(color).resolvedColor(with: traits).getRed(&rgba.0, green: &rgba.1, blue: &rgba.2, alpha: &rgba.3)
      let linear = [rgba.0, rgba.1, rgba.2].map { channel -> Double in
        let c = Double(channel)
        return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    let (la, lb) = (luminance(a), luminance(b))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
  }

  @Test("Every text colour stands at least 4.5:1 on the paper, a sheet and a chip, in light and dark mode")
  func textContrast() {
    let text: [(String, Color)] = [
      ("ink", Theme.ink), ("inkSecondary", Theme.inkSecondary), ("accent", Theme.accent), ("danger", Theme.danger),
    ]
    let grounds: [(String, Color)] = [
      ("background", Theme.background), ("surface", Theme.surface), ("fill", Theme.fill),
    ]
    for style in Self.styles {
      for (name, colour) in text {
        for (groundName, ground) in grounds {
          let ratio = Self.contrast(colour, ground, style)
          #expect(ratio >= 4.5, "\(name) on \(groundName), \(style == .dark ? "dark" : "light"): \(ratio)")
        }
      }
      #expect(Self.contrast(Theme.onAccentFill, Theme.accentFill, style) >= 4.5)
      #expect(Self.contrast(Theme.onAccent, Theme.accent, style) >= 4.5)
    }
  }

  @Test("Data colours read as text on the paper, and protein stands apart from the food colour beside it")
  func dataContrast() {
    let pigments: [(String, Color)] = [
      ("sleep", Theme.sleep), ("calories", Theme.calories), ("water", Theme.water), ("activity", Theme.activity),
      ("body", Theme.body), ("feltEnergy", Theme.feltEnergy),
    ]
    for style in Self.styles {
      for (name, colour) in pigments {
        let ratio = Self.contrast(colour, Theme.background, style)
        #expect(ratio >= 4.5, "\(name), \(style == .dark ? "dark" : "light"): \(ratio)")
        #expect(Self.contrast(colour, Theme.surface, style) >= 3, "\(name) on a sheet")
      }
      // Protein's ink sits beside carbs and fat in the macro bar.
      #expect(Self.contrast(Theme.protein, Theme.calories, style) >= 3)
    }
  }

  @Test("A meter has one mark per amount, fills the partial mark, and draws the target line only when passed")
  func meterMarks() throws {
    let energy = try #require(MeterLayout(value: 980, target: 1900, unit: 100))
    #expect(energy.marks == 19 && energy.targetMarks == 19)
    #expect(abs(energy.filled - 9.8) < 0.0001)
    #expect(energy.lead == 9)
    #expect(abs(energy.fill(9) - 0.8) < 0.0001 && energy.fill(8) == 1 && energy.fill(10) == 0)
    #expect(energy.targetLine == nil)

    let over = try #require(MeterLayout(value: 2150, target: 1900, unit: 100))
    #expect(over.marks == 22)
    #expect(over.targetLine == 19)

    let protein = try #require(MeterLayout(value: 52, target: 130, unit: 10))
    #expect(protein.marks == 13)
    let water = try #require(MeterLayout(value: 500, target: 2450, unit: 250))
    #expect(water.marks == 10 && water.filled == 2)

    let empty = try #require(MeterLayout(value: 0, target: 1900, unit: 100))
    #expect(empty.lead == nil && empty.fill(0) == 0)

    #expect(MeterLayout(value: 980, target: nil, unit: 100) == nil)
    #expect(MeterLayout(value: 980, target: 0, unit: 100) == nil)
  }

  @Test("A target between marks draws its line where it falls, not at the nearest mark")
  func meterFractionalTarget() throws {
    // 1,950 kcal is 19 and a half marks: 20 marks, the line halfway across the 20th.
    let half = try #require(MeterLayout(value: 2000, target: 1950, unit: 100))
    #expect(half.targetMarks == 20 && half.marks == 20)
    #expect(half.targetLine == 19.5)
    // Not reached yet: no line.
    #expect(try #require(MeterLayout(value: 1940, target: 1950, unit: 100)).targetLine == nil)
    // 1,940 kcal no longer rounds down to 19 marks, leaving its last 40 out.
    #expect(try #require(MeterLayout(value: 0, target: 1940, unit: 100)).targetMarks == 20)
    // A whole mark's line sits in the gap after it; a share of one across it.
    #expect(MeterLayout.lineX(19, pitch: 10, width: 6) == 18 * 10 + 8)
    #expect(MeterLayout.lineX(19.5, pitch: 10, width: 6) == 19 * 10 + 3)
    #expect(MeterLayout.lineX(1, pitch: 10, width: 6) == 8)
  }

  @Test("VoiceOver reads a Ledger column as one sentence")
  func ledgerSpoken() {
    let energy = LedgerLine(
      title: "Energy", tint: Theme.calories, value: 980, target: 1900, perMark: 100, number: "980", unit: "kcal",
      targetText: "1,900", scale: "One mark = 100 kcal", spokenUnit: "kilocalories")
    #expect(energy.spoken == "980 of 1,900 kilocalories")
    let untargeted = LedgerLine(
      title: "Protein", tint: Theme.protein, value: 52, target: nil, perMark: 10, number: "52", unit: "g",
      targetText: nil, scale: "10 g a mark", spokenUnit: "grams")
    #expect(untargeted.spoken == "52 grams logged today")
  }

  @Test("A line that hides what passes its target fills its meter to the target, and says where the day stands")
  func ledgerHideOver() {
    var line = LedgerLine(
      title: "Energy", tint: Theme.calories, value: 1500, target: 1300, perMark: 100, number: "~1,500", unit: "kcal",
      targetText: "about 1,300", scale: "One mark = 100 kcal", spokenUnit: "kilocalories")
    #expect(line.shown == 1500)
    line.hideOver = true
    #expect(line.shown == 1300)
    #expect(line.spoken == "1,500 of 1,300 kilocalories")
    let under = LedgerLine(
      title: "Energy", tint: Theme.calories, value: 900, target: 1300, perMark: 100, number: "900", unit: "kcal",
      targetText: "about 1,300", scale: "One mark = 100 kcal", spokenUnit: "kilocalories",
      status: "About 400 kcal remaining", hideOver: true)
    #expect(under.shown == 900)
    #expect(under.spoken == "900 of 1,300 kilocalories, About 400 kcal remaining")
  }

  @Test("A value's numbers are set in the serif and its units beside them")
  func measureParts() {
    #expect(Measure.parts("7 h 15 min", nil).map(\.number) == [true, false, true, false])
    #expect(Measure.parts("54", "bpm").map(\.text) == ["54", "bpm"])
    #expect(Measure.parts("~205", "kcal").map(\.number) == [true, false])
  }
}
