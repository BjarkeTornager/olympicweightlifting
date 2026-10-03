import Foundation
import SwiftUI
import Testing

@testable import LiftJournal

@Suite("Line breaks")
struct LineBreakTests {
  static let space = "\u{00A0}"
  static let soft: Character = "\u{00AD}"

  @Test("A paragraph's last two words share a line, unless they are too long to")
  func lastWords() {
    #expect(
      LineBreaks.keepLastWords("Most other nights fell between seven and eight hours.")
        == "Most other nights fell between seven and eight\(Self.space)hours.")
    #expect(
      LineBreaks.keepLastWords("Søvnkvaliteten hænger fint sammen med hvilepulsen.")
        == "Søvnkvaliteten hænger fint sammen med\(Self.space)hvilepulsen.")
    // Strong marks don't count towards the length.
    #expect(LineBreaks.keepLastWords("It was **7 h 15 min**") == "It was **7 h 15\(Self.space)min**")
    #expect(LineBreaks.keepLastWords("Call ended.") == "Call ended.")
    #expect(
      LineBreaks.keepLastWords("Lowered resting heart extraordinarily consistently")
        == "Lowered resting heart extraordinarily consistently")
    // A line break before the last word stays as it is.
    #expect(LineBreaks.keepLastWords("First line\nsecond") == "First line\nsecond")
    #expect(LineBreaks.keepLastWords("Three short words", within: 0) == "Three short words")
  }

  @Test("Figures stay with their units, and days with their months, in English and Danish")
  func figures() {
    let s = Self.space
    #expect(
      LineBreaks.keepFigures("Your longest night was 8 h 6 min on 28 September.")
        == "Your longest night was 8\(s)h\(s)6\(s)min on 28\(s)September.")
    #expect(
      LineBreaks.keepFigures("Din længste nat var 8 t 6 min den 28. september.")
        == "Din længste nat var 8\(s)t\(s)6\(s)min den 28.\(s)september.")
    #expect(LineBreaks.keepFigures("Drink 250 ml, then 1,900 kcal") == "Drink 250\(s)ml, then 1,900\(s)kcal")
    #expect(LineBreaks.keepFigures("From September 28 on") == "From September\(s)28 on")
    // Sets by reps and ranges.
    #expect(LineBreaks.keepFigures("Do 3 × 5 at 80 kg") == "Do 3\(s)×\(s)5 at 80\(s)kg")
    #expect(LineBreaks.keepFigures("then 5 x 3") == "then 5\(s)x\(s)3")
    #expect(LineBreaks.keepFigures("for 10 to 12 minutes") == "for 10\(s)to\(s)12 minutes")
    #expect(LineBreaks.keepFigures("i 10 til 12 minutter") == "i 10\(s)til\(s)12 minutter")
    #expect(LineBreaks.keepFigures("Add 1 to the bar, then go to 3") == "Add 1 to the bar, then go to 3")
    // A word that only starts like a unit is left alone.
    #expect(LineBreaks.keepFigures("Rest 2 minutes and 30 sekunder") == "Rest 2 minutes and 30 sekunder")
    #expect(LineBreaks.keepFigures("Week 40 and 3 more") == "Week 40 and 3 more")
  }

  /// Where a word set by `hyphenate` may break, in letters from its start.
  static func breaks(_ set: String) -> [Int] {
    var points: [Int] = []
    var letters = 0
    for character in set {
      if character == soft { points.append(letters) } else { letters += 1 }
    }
    return points
  }

  @Test("Long words take soft hyphens at the dictionary's breaks, away from their ends")
  func hyphens() {
    for (word, language) in [
      ("Søvnregelmæssighed", LineBreaks.Language.danish), ("styrketræningen", .danish),
      ("recommendations", .english), ("International", .english),
    ] {
      let set = LineBreaks.hyphenate(word, language: language, last: 12)
      #expect(set.filter { $0 != Self.soft } == word)
      #expect(set.contains(Self.soft), "\(word) has no break")
      for point in Self.breaks(set) {
        #expect(point >= 2 && word.count - point >= 3, "\(set) breaks too near an end")
      }
    }
    // Every break is kept, so a compound can break at its joint, and a
    // word never at its first syllable only.
    #expect(Self.breaks(LineBreaks.hyphenate("styrketræning", language: .danish, last: 12)).contains(6))
    #expect(Self.breaks(LineBreaks.hyphenate("carbohydrates", language: .english, last: 12)).contains(5))
    // Short words, links, addresses and code are left whole.
    for text in ["Søvn og puls", "https://example.com/restitution", "anna@restitution.dk", "`hydrationTarget`"] {
      #expect(LineBreaks.hyphenate("\(text) i dag", language: .danish, from: 8) == "\(text) i dag")
    }
  }

  @Test("A paragraph's last two words stay whole, unless one may not fit a line at the largest sizes")
  func lastLine() {
    let text = "Søvnkvaliteten hænger fint sammen med hvilepulsen"
    let large = LineBreaks.paragraph(text, language: .danish)
    #expect(large.hasSuffix("med\(Self.space)hvilepulsen"))
    #expect(!large.hasPrefix("Søvnkvaliteten "), "a long word earlier on is hyphenated")
    let largest = LineBreaks.paragraph(
      "Det handler om søvnregelmæssighed", language: .danish, size: .accessibility3)
    #expect(largest.hasPrefix("Det handler om "))
    #expect(largest.contains(Self.soft))
    // A pair too long to share a line at the largest sizes stays apart.
    #expect(LineBreaks.paragraph(text, language: .danish, size: .accessibility3).hasSuffix("med hvilepulsen"))
  }

  @Test("At the accessibility sizes only a word that may not fit a line is hyphenated")
  func largestSizes() {
    let meal =
      "En hurtig risskål med laks, edamamebønner og agurk holder proteinindtaget højt og hjælper restitutionen godt på vej."
    // At AX3 every word here fits a line whole: none may break.
    #expect(!LineBreaks.paragraph(meal, language: .danish, size: .accessibility3).contains(Self.soft))
    // At AX5 the widest may not fit a phone's narrowest column, while
    // "restitutionen", as long but narrower, does.
    let largest = LineBreaks.paragraph(meal, language: .danish, size: .accessibility5).split(separator: " ")
    func hyphenated(_ word: String) -> Bool {
      largest.contains { $0.contains(Self.soft) && $0.filter { $0 != Self.soft }.hasPrefix(word) }
    }
    #expect(hyphenated("edamamebønner"))
    #expect(hyphenated("proteinindtaget"))
    #expect(!hyphenated("restitutionen"))
  }

  @Test("While Coach is still writing, a paragraph's end is left to break as it comes")
  func streaming() {
    let text = "Din længste nat var 8 t 6 min, og søvnkvaliteten hænger sammen med hvilepulsen"
    let open = LineBreaks.paragraph(text, language: .danish, finished: false)
    #expect(open.hasSuffix("med hvilepulsen"))
    #expect(open.contains("8\(Self.space)t\(Self.space)6\(Self.space)min"))
    // The words before the end are set as they will be once it is finished.
    let finished = LineBreaks.paragraph(text, language: .danish)
    #expect(open.prefix(40) == finished.prefix(40))
    #expect(LineBreaks.title("Søvn og restitution", finished: false) == "Søvn og restitution")
  }

  @Test("A title keeps its words whole; a paragraph is set in full")
  func titles() {
    let title = LineBreaks.title("Søvnregelmæssighed og restitution")
    #expect(!title.contains(Self.soft))
    #expect(title == "Søvnregelmæssighed og\(Self.space)restitution")
    let paragraph = LineBreaks.paragraph("Din længste nat var 8 t 6 min. Søvnregelmæssighed er vigtig.", language: .danish)
    #expect(paragraph.contains(Self.soft))
    #expect(paragraph.hasSuffix("er\(Self.space)vigtig."))
    #expect(paragraph.contains("8\(Self.space)t\(Self.space)6\(Self.space)min"))
  }

  @Test("Coach's language is told from the reply")
  func language() {
    #expect(
      LineBreaks.language(of: "Du har registreret søvn alle syv nætter i denne uge, og søvnkvaliteten er god.")
        == .danish)
    #expect(
      LineBreaks.language(of: "You logged sleep on all seven nights this week, and the quality was good.")
        == .english)
  }
}
